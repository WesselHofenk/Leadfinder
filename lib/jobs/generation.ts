import { Prisma, type Lead } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { serverEnv } from "@/lib/env";
import { searchPlaces } from "@/lib/google/places";
import { searchOverpass } from "@/lib/openstreetmap/overpass";
import { qualifyCandidate, type Candidate } from "@/lib/leads/eligibility";
import { candidateDedupeKeys, RunDeduplicator, type DedupeKeys } from "@/lib/leads/deduplication";
import { normalizeText } from "@/lib/leads/normalization";
import { shouldContinueGeneration } from "@/lib/leads/search-loop";
import { acquireJobLock } from "./lock";
import { reserveApiCall } from "./quota";

type ExistingLead = Pick<Lead, "externalPlaceId" | "normalizedPhoneNumber" | "normalizedCompanyName" | "postalCode" | "city" | "streetAddress">;

class ExistingLeadIndex {
  private values = new Set<string>();
  constructor(leads: ExistingLead[]) { leads.forEach((lead) => this.add({ externalId: lead.externalPlaceId, phone: lead.normalizedPhoneNumber, namePostal: lead.postalCode ? `${lead.normalizedCompanyName}|${normalizeText(lead.postalCode)}` : undefined, nameCityAddress: `${lead.normalizedCompanyName}|${normalizeText(lead.city)}|${normalizeText(lead.streetAddress)}` })); }
  has(keys: DedupeKeys) { return [keys.externalId, keys.phone && `phone:${keys.phone}`, keys.namePostal && `postal:${keys.namePostal}`, `address:${keys.nameCityAddress}`].filter(Boolean).some((key) => this.values.has(key as string)); }
  add(keys: DedupeKeys) { this.values.add(keys.externalId); if (keys.phone) this.values.add(`phone:${keys.phone}`); if (keys.namePostal) this.values.add(`postal:${keys.namePostal}`); this.values.add(`address:${keys.nameCityAddress}`); }
}

const aliases: Record<string, string[]> = {
  kapper: ["kapper", "kapsalon"], schoonheidssalon: ["schoonheidssalon", "beautysalon"], nagelstudio: ["nagelstudio", "nagelsalon"],
  schilder: ["schilder", "schildersbedrijf"], stukadoor: ["stukadoor", "stucadoorsbedrijf"], loodgieter: ["loodgieter", "installatiebedrijf"],
  elektricien: ["elektricien", "elektrotechnisch bedrijf"], timmerman: ["timmerman", "timmerbedrijf"], aannemer: ["aannemer", "bouwbedrijf"],
  garage: ["garage", "autogarage"], autobedrijf: ["autobedrijf", "auto service"], fietsenmaker: ["fietsenmaker", "fietsenwinkel"],
  snackbar: ["snackbar", "frituur"], cafe: ["café", "eetcafé"], fysiotherapeut: ["fysiotherapeut", "fysiotherapiepraktijk"],
};

function searchTerms(branch: string) { return aliases[branch.toLowerCase()] || [branch, `${branch} bedrijf`]; }
function message(error: unknown) { return error instanceof Error ? error.message.slice(0, 300) : "Onbekende API-fout"; }

function mergeCandidate(pool: Candidate[], candidate: Candidate) {
  const keys = candidateDedupeKeys(candidate);
  const found = pool.findIndex((item) => { const other = candidateDedupeKeys(item); return Boolean(keys.phone && keys.phone === other.phone) || Boolean(keys.namePostal && keys.namePostal === other.namePostal) || keys.nameCityAddress === other.nameCityAddress; });
  if (found < 0) { pool.push(candidate); return; }
  const current = pool[found];
  const websiteFields = [...(current.websiteFields ?? []), current.website, ...(candidate.websiteFields ?? []), candidate.website];
  pool[found] = current.source === "GOOGLE_PLACES" ? { ...current, websiteFields } : { ...candidate, websiteFields };
}

async function updateRun(runId: string, data: Prisma.GenerationRunUpdateInput) { await prisma.generationRun.update({ where: { id: runId }, data }); }

export async function createGenerationRun() {
  const target = Number(process.env.LEAD_GENERATION_TARGET || 50);
  return prisma.generationRun.create({ data: { targetCount: Math.min(100, Math.max(1, target)) } });
}

export async function runLeadGeneration(runId: string) {
  const lock = await acquireJobLock("manual-lead-generation", 15 * 60_000);
  if (!lock) { await updateRun(runId, { status: "CANCELLED", finishedAt: new Date(), apiErrors: ["Er draait al een leadgeneratie"] }); return; }
  const env = serverEnv(); const run = await prisma.generationRun.findUniqueOrThrow({ where: { id: runId } });
  const placesApiKey = env.GOOGLE_PLACES_API_KEY;
  const stats = { found: 0, checked: 0, withoutWebsite: 0, duplicates: 0, rejected: 0, stored: 0 };
  const errors: string[] = []; const places = new Set<string>(); const branches = new Set<string>(); const pending: Candidate[] = [];
  try {
    await updateRun(runId, { status: "RUNNING", startedAt: new Date() });
    if (!placesApiKey) errors.push("Google Places overgeslagen: GOOGLE_PLACES_API_KEY ontbreekt; Overpass blijft actief");
    const [areasRaw, categories, existingLeads] = await Promise.all([
      prisma.coverageArea.findMany({ where: { status: { not: "PAUSED" } }, orderBy: [{ lastScannedAt: "asc" }, { priority: "asc" }] }),
      prisma.category.findMany({ where: { isActive: true }, orderBy: [{ priority: "asc" }, { name: "asc" }] }),
      prisma.lead.findMany({ select: { externalPlaceId: true, normalizedPhoneNumber: true, normalizedCompanyName: true, postalCode: true, city: true, streetAddress: true } }),
    ]);
    const countries = ["NL", "BE"];
    const areas = areasRaw.sort((a, b) => countries.indexOf(a.country) - countries.indexOf(b.country));
    const byCountry = countries.map((country) => areas.filter((area) => area.country === country));
    const interleaved = Array.from({ length: Math.max(...byCountry.map((items) => items.length)) }, (_, index) => byCountry.flatMap((items) => items[index] ? [items[index]] : [])).flat();
    const enabled = new Set(categories.map((category) => category.name));
    const tasks = interleaved.filter((area) => enabled.has(area.category)).flatMap((area) => searchTerms(area.category).map((term) => ({ area, branch: area.category, term })));
    const existing = new ExistingLeadIndex(existingLeads); const runDedupe = new RunDeduplicator(); const overpassAreas = new Set<string>();

    const processPending = async () => {
      while (pending.length && stats.stored < run.targetCount) {
        const candidate = pending.shift()!; stats.checked += 1; const keys = candidateDedupeKeys(candidate);
        if (runDedupe.hasOrAdd(keys) || existing.has(keys)) { stats.duplicates += 1; continue; }
        const qualified = qualifyCandidate(candidate);
        if (!qualified.ok) { stats.rejected += 1; continue; }
        stats.withoutWebsite += 1; const lead = qualified.lead;
        try {
          await prisma.$transaction(async (tx) => {
            const saved = await tx.lead.create({ data: { externalPlaceId: lead.externalPlaceId, companyName: lead.companyName, normalizedCompanyName: lead.normalizedCompanyName, phoneNumber: lead.phoneNumber || lead.normalizedPhoneNumber, normalizedPhoneNumber: lead.normalizedPhoneNumber, internationalPhoneNumber: lead.internationalPhoneNumber || lead.normalizedPhoneNumber, category: lead.category, subCategory: lead.subCategory, country: lead.country, province: lead.province, municipality: lead.municipality, city: lead.city, postalCode: lead.postalCode, streetAddress: lead.streetAddress, houseNumber: lead.houseNumber, normalizedAddress: lead.normalizedAddress, latitude: new Prisma.Decimal(lead.latitude), longitude: new Prisma.Decimal(lead.longitude), googleMapsUrl: lead.googleMapsUrl, website: null, websiteUrl: null, websiteStatus: "NO_OWN_WEBSITE", leadType: "NO_WEBSITE", opportunityScore: 95, businessStatus: "OPERATIONAL", source: lead.source || "GOOGLE_PLACES", status: "NEW" } });
            await tx.websiteAnalysis.create({ data: { leadId: saved.id, websiteUrl: "", opportunityScore: 95, conversionQualityScore: 0, isReachable: false, reasons: [{ code: "NO_WEBSITE", label: "Geen eigen website gevonden", weight: 95 }] } });
          });
          existing.add(keys); stats.stored += 1;
        } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") stats.duplicates += 1; else { stats.rejected += 1; errors.push(`Opslaan ${lead.companyName}: ${message(error)}`); } }
      }
      await updateRun(runId, { candidatesFound: stats.found, candidatesChecked: stats.checked, withoutWebsite: stats.withoutWebsite, duplicates: stats.duplicates, rejected: stats.rejected, stored: stats.stored, placesUsed: [...places], branchesUsed: [...branches], apiErrors: errors });
    };

    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex += 1) {
      if (!shouldContinueGeneration({ stored: stats.stored, target: run.targetCount, candidatesFound: stats.found, buffer: env.LEAD_CANDIDATE_BUFFER, tasksRemain: taskIndex < tasks.length })) break;
      const { area, branch, term } = tasks[taskIndex];
      places.add(`${area.city}, ${area.country}`); branches.add(branch); let pageToken: string | undefined;
      if (placesApiKey) {
        for (let page = 0; page < env.GOOGLE_PLACES_MAX_PAGES_PER_JOB; page += 1) {
          try { await reserveApiCall(env.GOOGLE_PLACES_DAILY_LIMIT); const result = await searchPlaces({ apiKey: placesApiKey, query: term, city: area.city, country: area.country, latitude: Number(area.latitude), longitude: Number(area.longitude), radius: area.radius, pageToken }); result.candidates.forEach((candidate) => mergeCandidate(pending, candidate)); stats.found += result.candidates.length; pageToken = result.nextPageToken; } catch (error) { errors.push(`Google ${term} / ${area.city}: ${message(error)}`); break; }
          if (!pageToken) break;
        }
      }
      const areaKey = `${area.country}:${area.city}`;
      if (!overpassAreas.has(areaKey)) {
        overpassAreas.add(areaKey);
        try { const osm = await searchOverpass({ endpoint: env.OVERPASS_API_URL, country: area.country, latitude: Number(area.latitude), longitude: Number(area.longitude), radius: area.radius }); osm.forEach((candidate) => mergeCandidate(pending, candidate)); stats.found += osm.length; } catch (error) { errors.push(`Overpass ${area.city}: ${message(error)}`); }
      }
      if (pending.length >= env.LEAD_CANDIDATE_BUFFER || stats.found >= env.LEAD_CANDIDATE_BUFFER) await processPending();
      else await updateRun(runId, { candidatesFound: stats.found, placesUsed: [...places], branchesUsed: [...branches], apiErrors: errors });
    }
    await processPending();
    await updateRun(runId, { status: "COMPLETE", exhausted: stats.stored < run.targetCount, finishedAt: new Date(), candidatesFound: stats.found, candidatesChecked: stats.checked, withoutWebsite: stats.withoutWebsite, duplicates: stats.duplicates, rejected: stats.rejected, stored: stats.stored, placesUsed: [...places], branchesUsed: [...branches], apiErrors: errors });
  } catch (error) {
    errors.push(message(error)); await updateRun(runId, { status: "FAILED", finishedAt: new Date(), candidatesFound: stats.found, candidatesChecked: stats.checked, withoutWebsite: stats.withoutWebsite, duplicates: stats.duplicates, rejected: stats.rejected, stored: stats.stored, placesUsed: [...places], branchesUsed: [...branches], apiErrors: errors });
  } finally { await lock.release(); }
}
