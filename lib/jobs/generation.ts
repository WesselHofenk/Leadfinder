import { Prisma, type Lead } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { serverEnv } from "@/lib/env";
import { searchPlaces } from "@/lib/google/places";
import { searchOverpass } from "@/lib/openstreetmap/overpass";
import { qualifyCandidate, validateCandidateBasics, type Candidate, type EligibleBase } from "@/lib/leads/eligibility";
import { candidateDedupeKeys, fingerprintValues, RunDeduplicator, type DedupeKeys } from "@/lib/leads/deduplication";
import { normalizeText } from "@/lib/leads/normalization";
import { determineWebsiteStatus, logWebsiteStatusDecision, type WebsiteStatusDecision } from "@/lib/leads/website";
import { searchTerms } from "@/lib/leads/config";
import { analyzeWebsite, type WebsiteAnalysisResult } from "@/lib/website/analyze";
import { acquireJobLock } from "./lock";
import { reserveBudgetedApiCall } from "./quota";

type ExistingLead = Pick<Lead, "externalPlaceId" | "normalizedPhoneNumber" | "normalizedCompanyName" | "postalCode" | "city" | "streetAddress" | "category" | "normalizedDomain" | "email">;

class ExistingLeadIndex {
  private values = new Set<string>();
  constructor(leads: ExistingLead[]) {
    leads.forEach((lead) => this.add({
      externalId: lead.externalPlaceId, phone: lead.normalizedPhoneNumber, email: lead.email ?? undefined,
      domain: lead.normalizedDomain ?? undefined,
      namePostal: lead.postalCode ? `${lead.normalizedCompanyName}|${normalizeText(lead.postalCode)}` : undefined,
      nameCityAddress: `${lead.normalizedCompanyName}|${normalizeText(lead.city)}|${normalizeText(lead.streetAddress)}`,
      nameCityCategory: `${lead.normalizedCompanyName}|${normalizeText(lead.city)}|${normalizeText(lead.category)}`,
    }));
  }
  has(keys: DedupeKeys) { return fingerprintValues(keys).some(({ fingerprint }) => this.values.has(fingerprint)); }
  add(keys: DedupeKeys) { fingerprintValues(keys).forEach(({ fingerprint }) => this.values.add(fingerprint)); }
}

type Stats = {
  found: number; checked: number; withoutWebsite: number; duplicates: number; rejected: number; stored: number;
  websitesChecked: number; permanentlyClosed: number; temporarilyClosed: number; noWebsite: number;
  outdatedWebsite: number; improvableWebsite: number; sourceFailures: number; estimatedCostCents: number;
};

function message(error: unknown) { return error instanceof Error ? error.message.slice(0, 300) : "Onbekende bronfout"; }

function mergeCandidate(pool: Candidate[], candidate: Candidate) {
  const fingerprints = new Set(fingerprintValues(candidateDedupeKeys(candidate)).map((item) => item.fingerprint));
  const found = pool.findIndex((item) => fingerprintValues(candidateDedupeKeys(item)).some(({ fingerprint }) => fingerprints.has(fingerprint)));
  if (found < 0) { pool.push(candidate); return; }
  const current = pool[found];
  const websiteFields = [...(current.websiteFields ?? []), current.website, ...(candidate.websiteFields ?? []), candidate.website];
  const preferred = current.source === "GOOGLE_PLACES" ? current : candidate;
  pool[found] = { ...preferred, email: preferred.email || current.email || candidate.email, websiteFields };
}

function updateData(stats: Stats, places: Set<string>, branches: Set<string>, errors: string[]): Prisma.GenerationRunUpdateInput {
  return {
    candidatesFound: stats.found, candidatesChecked: stats.checked, withoutWebsite: stats.withoutWebsite,
    duplicates: stats.duplicates, rejected: stats.rejected, stored: stats.stored, websitesChecked: stats.websitesChecked,
    permanentlyClosed: stats.permanentlyClosed, temporarilyClosed: stats.temporarilyClosed, noWebsite: stats.noWebsite,
    outdatedWebsite: stats.outdatedWebsite, improvableWebsite: stats.improvableWebsite, sourceFailures: stats.sourceFailures,
    estimatedCostCents: stats.estimatedCostCents, placesUsed: [...places], branchesUsed: [...branches], apiErrors: errors,
  };
}

async function updateRun(runId: string, data: Prisma.GenerationRunUpdateInput) { await prisma.generationRun.update({ where: { id: runId }, data }); }
async function logSource(runId: string, source: string, level: string, text: string, city?: string, category?: string) {
  await prisma.sourceLog.create({ data: { runId, source, level, message: text.slice(0, 500), city, category } });
}

export async function createGenerationRun() {
  const target = Number(process.env.LEAD_GENERATION_TARGET || 50);
  return prisma.generationRun.create({ data: { targetCount: Math.min(100, Math.max(1, target)) } });
}

async function recordCombination(input: { country: string; city: string; category: string; source: string; found: number; valid?: number; error?: string }) {
  await prisma.searchCombination.upsert({
    where: { country_city_category_source: { country: input.country, city: input.city, category: input.category, source: input.source } },
    create: { country: input.country, city: input.city, category: input.category, source: input.source, useCount: 1, candidatesFound: input.found, validLeads: input.valid ?? 0, lastUsedAt: new Date(), lastError: input.error },
    update: { useCount: { increment: 1 }, candidatesFound: { increment: input.found }, validLeads: { increment: input.valid ?? 0 }, lastUsedAt: new Date(), lastError: input.error ?? null },
  });
}

export async function runLeadGeneration(runId: string) {
  const env = serverEnv();
  const lock = await acquireJobLock("manual-lead-generation", (env.GENERATION_MAX_DURATION_SECONDS + 30) * 1000);
  if (!lock) { await updateRun(runId, { status: "CANCELLED", finishedAt: new Date(), apiErrors: ["Er draait al een leadgeneratie"] }); return; }
  const run = await prisma.generationRun.findUniqueOrThrow({ where: { id: runId } });
  const deadline = Date.now() + env.GENERATION_MAX_DURATION_SECONDS * 1000;
  const stats: Stats = { found: 0, checked: 0, withoutWebsite: 0, duplicates: 0, rejected: 0, stored: 0, websitesChecked: 0, permanentlyClosed: 0, temporarilyClosed: 0, noWebsite: 0, outdatedWebsite: 0, improvableWebsite: 0, sourceFailures: 0, estimatedCostCents: 0 };
  const errors: string[] = []; const places = new Set<string>(); const branches = new Set<string>(); const pending: Candidate[] = [];
  let sourceCalls = 0;
  try {
    await updateRun(runId, { status: "RUNNING", startedAt: new Date() });
    const [areasRaw, categories, excluded, existingLeads, suppressedRows] = await Promise.all([
      prisma.coverageArea.findMany({ where: { status: { not: "PAUSED" } }, orderBy: [{ lastScannedAt: "asc" }, { priority: "asc" }] }),
      prisma.category.findMany({ where: { isActive: true }, orderBy: [{ priority: "asc" }, { name: "asc" }] }),
      prisma.excludedCategory.findMany({ where: { isActive: true }, select: { slug: true } }),
      prisma.lead.findMany({ select: { externalPlaceId: true, normalizedPhoneNumber: true, normalizedCompanyName: true, postalCode: true, city: true, streetAddress: true, category: true, normalizedDomain: true, email: true } }),
      prisma.suppressedLead.findMany({ select: { fingerprint: true } }),
    ]);
    const excludedValues = new Set(excluded.map((item) => item.slug.replaceAll("_", "-").toLowerCase()));
    const existing = new ExistingLeadIndex(existingLeads); const runDedupe = new RunDeduplicator();
    const suppressed = new Set(suppressedRows.map((row) => row.fingerprint));

    const saveLead = async (base: EligibleBase, keys: DedupeKeys, websiteDecision: WebsiteStatusDecision, analysis?: WebsiteAnalysisResult) => {
      const noWebsite = websiteDecision.status === "no_website";
      const leadType = noWebsite ? "NO_WEBSITE" : analysis!.classification === "OUTDATED" ? "OUTDATED_WEBSITE" : "IMPROVABLE_WEBSITE";
      const websiteStatus = noWebsite ? "NO_OWN_WEBSITE" : analysis!.classification === "OUTDATED" ? "OUTDATED" : "IMPROVABLE";
      const siteUrl = noWebsite ? null : websiteDecision.normalizedUrl;
      const score = noWebsite ? Math.max(70, analysis?.opportunityScore ?? base.confidenceScore) : analysis!.opportunityScore;
      const saved = await prisma.$transaction(async (tx) => {
        const lead = await tx.lead.create({ data: {
          externalPlaceId: base.externalPlaceId, companyName: base.companyName, normalizedCompanyName: base.normalizedCompanyName,
          phoneNumber: base.phoneNumber || base.normalizedPhoneNumber, normalizedPhoneNumber: base.normalizedPhoneNumber,
          internationalPhoneNumber: base.internationalPhoneNumber || base.normalizedPhoneNumber, email: base.email,
          category: base.category, subCategory: base.subCategory, country: base.country, province: base.province,
          municipality: base.municipality, city: base.city, postalCode: base.postalCode, streetAddress: base.streetAddress,
          houseNumber: base.houseNumber, normalizedAddress: base.normalizedAddress, latitude: new Prisma.Decimal(base.latitude),
          longitude: new Prisma.Decimal(base.longitude), googleMapsUrl: base.googleMapsUrl, website: siteUrl, websiteUrl: siteUrl,
          normalizedDomain: noWebsite ? null : base.normalizedDomain, websiteStatus, websiteStatusReason: websiteDecision.reason,
          websiteSource: websiteDecision.source, leadType, opportunityScore: score,
          conversionQualityScore: analysis?.conversionQualityScore ?? 0, businessStatus: base.businessStatus,
          source: base.source || "OPENSTREETMAP", confidenceScore: base.confidenceScore, confidenceLevel: base.confidenceLevel, status: "NEW",
          filterReason: analysis?.reasons[0]?.label,
        } });
        await tx.websiteAnalysis.create({ data: analysis ? {
          leadId: lead.id, websiteUrl: analysis.websiteUrl, opportunityScore: analysis.opportunityScore, mobileScore: analysis.mobileScore,
          desktopScore: analysis.desktopScore, conversionQualityScore: analysis.conversionQualityScore, isReachable: analysis.isReachable,
          isMobileFriendly: analysis.isMobileFriendly, hasContactForm: analysis.hasContactForm, hasClearCta: analysis.hasClearCta,
          hasBrokenLinks: analysis.hasBrokenLinks, brokenLinkCount: analysis.brokenLinkCount, hasViewportMeta: analysis.hasViewportMeta,
          hasOutdatedCopyright: analysis.hasOutdatedCopyright, hasPlaceholderContent: analysis.hasPlaceholderContent,
          hasHttps: analysis.hasHttps, hasInvalidSsl: analysis.hasInvalidSsl, hasBrokenImages: analysis.hasBrokenImages,
          brokenImageCount: analysis.brokenImageCount, hasLegacyTechnology: analysis.hasLegacyTechnology, hasTinyText: analysis.hasTinyText,
          loadTimeMs: analysis.loadTimeMs, reasons: analysis.reasons, rawSignals: analysis.rawSignals as Prisma.InputJsonValue,
        } : { leadId: lead.id, websiteUrl: "", opportunityScore: score, conversionQualityScore: 0, isReachable: false, reasons: [{ code: "NO_WEBSITE", label: "Geen eigen website in de toegestane brongegevens", weight: score }], rawSignals: { confidenceScore: base.confidenceScore, source: base.source } } });
        await tx.duplicateFingerprint.createMany({ data: fingerprintValues(keys).map((item) => ({ ...item, leadId: lead.id })), skipDuplicates: true });
        return lead;
      });
      existing.add(keys); stats.stored += 1;
      if (noWebsite) { stats.withoutWebsite += 1; stats.noWebsite += 1; }
      else if (analysis?.classification === "OUTDATED") stats.outdatedWebsite += 1;
      else stats.improvableWebsite += 1;
      return saved;
    };

    const processPending = async () => {
      while (pending.length && stats.stored < run.targetCount && Date.now() < deadline) {
        const candidate = pending.shift()!; stats.checked += 1;
        if (excludedValues.has(candidate.category.toLowerCase().replaceAll("_", "-"))) { stats.rejected += 1; continue; }
        if (["CLOSED_PERMANENTLY", "PERMANENTLY_CLOSED"].includes(candidate.businessStatus ?? "")) { stats.permanentlyClosed += 1; stats.rejected += 1; continue; }
        if (["CLOSED_TEMPORARILY", "TEMPORARILY_CLOSED"].includes(candidate.businessStatus ?? "")) { stats.temporarilyClosed += 1; stats.rejected += 1; continue; }
        const keys = candidateDedupeKeys(candidate); const prints = fingerprintValues(keys);
        if (prints.some(({ fingerprint }) => suppressed.has(fingerprint)) || runDedupe.hasOrAdd(keys) || existing.has(keys)) { stats.duplicates += 1; continue; }
        const basic = validateCandidateBasics(candidate);
        if (!basic.ok) { stats.rejected += 1; continue; }
        const initialWebsiteDecision = determineWebsiteStatus(candidate);
        logWebsiteStatusDecision(candidate.companyName, initialWebsiteDecision);
        try {
          if (initialWebsiteDecision.status === "no_website") {
            const qualified = qualifyCandidate(candidate);
            if (!qualified.ok) { stats.rejected += 1; continue; }
            await saveLead(qualified.lead, keys, initialWebsiteDecision);
          } else if (initialWebsiteDecision.status === "unknown" || !initialWebsiteDecision.normalizedUrl) {
            stats.rejected += 1; continue;
          } else {
            if (stats.websitesChecked >= 12 || deadline - Date.now() < 12_000) { stats.rejected += 1; continue; }
            stats.websitesChecked += 1;
            const analysis = await analyzeWebsite(initialWebsiteDecision.normalizedUrl, { quick: true });
            const finalWebsiteDecision = determineWebsiteStatus(candidate, { reachable: analysis.isReachable, httpStatus: analysis.httpStatus, failureKind: analysis.failureKind, auditClassification: analysis.classification });
            logWebsiteStatusDecision(candidate.companyName, finalWebsiteDecision);
            if (finalWebsiteDecision.status === "unknown" || finalWebsiteDecision.status === "has_website") { stats.rejected += 1; continue; }
            await saveLead({ ...basic.lead, website: finalWebsiteDecision.normalizedUrl ?? undefined, normalizedDomain: finalWebsiteDecision.normalizedUrl ? new URL(finalWebsiteDecision.normalizedUrl).hostname.replace(/^www\./, "") : null }, keys, finalWebsiteDecision, analysis);
          }
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") stats.duplicates += 1;
          else { stats.rejected += 1; errors.push(`Validatie ${candidate.companyName}: ${message(error)}`); }
        }
        if (stats.checked % 5 === 0 || stats.stored === run.targetCount) await updateRun(runId, updateData(stats, places, branches, errors));
      }
    };

    const uniqueAreas = [...new Map(areasRaw.map((area) => [`${area.country}:${area.city}`, area])).values()];
    const byCountry = ["NL", "BE"].map((country) => uniqueAreas.filter((area) => area.country === country));
    const areas = Array.from({ length: Math.max(0, ...byCountry.map((items) => items.length)) }, (_, index) => byCountry.flatMap((items) => items[index] ? [items[index]] : [])).flat();
    const endpoints = env.OVERPASS_API_URLS.split(",").map((value) => value.trim()).filter(Boolean);

    for (const area of areas) {
      if ((stats.stored >= run.targetCount && stats.found >= env.LEAD_CANDIDATE_BUFFER) || Date.now() >= deadline || sourceCalls >= env.GENERATION_MAX_SOURCE_CALLS) break;
      sourceCalls += 1; places.add(`${area.city}, ${area.country}`); branches.add("OpenStreetMap-bedrijven");
      const before = stats.stored;
      try {
        const result = await searchOverpass({ endpoints, country: area.country, latitude: Number(area.latitude), longitude: Number(area.longitude), radius: area.radius, timeoutMs: env.OVERPASS_TIMEOUT_MS });
        result.candidates.forEach((candidate) => mergeCandidate(pending, candidate)); stats.found += result.candidates.length;
        await processPending();
        await recordCombination({ country: area.country, city: area.city, category: "*", source: "OPENSTREETMAP", found: result.candidates.length, valid: stats.stored - before });
        await prisma.coverageArea.updateMany({ where: { country: area.country, city: area.city }, data: { lastScannedAt: new Date(), resultsFound: { increment: result.candidates.length }, status: "COMPLETE", errorMessage: null } });
      } catch (error) {
        const text = message(error); stats.sourceFailures += 1; errors.push(`Overpass ${area.city}: ${text}`);
        await Promise.all([recordCombination({ country: area.country, city: area.city, category: "*", source: "OPENSTREETMAP", found: 0, error: text }), logSource(runId, "OPENSTREETMAP", "ERROR", text, area.city)]);
      }
      await updateRun(runId, updateData(stats, places, branches, errors));
    }

    const placesEnabled = Boolean(env.PAID_PROVIDERS_ENABLED && env.GOOGLE_PLACES_API_KEY);
    if (stats.stored < run.targetCount && placesEnabled && Date.now() < deadline) {
      const tasks = areas.flatMap((area) => categories.flatMap((category) => searchTerms(category.name).map((term) => ({ area, branch: category.name, term }))));
      for (const { area, branch, term } of tasks) {
        if ((stats.stored >= run.targetCount && stats.found >= env.LEAD_CANDIDATE_BUFFER) || Date.now() >= deadline || sourceCalls >= env.GENERATION_MAX_SOURCE_CALLS) break;
        sourceCalls += 1; places.add(`${area.city}, ${area.country}`); branches.add(branch); let pageToken: string | undefined; const before = stats.stored; let found = 0;
        for (let page = 0; page < env.GOOGLE_PLACES_MAX_PAGES_PER_JOB && Date.now() < deadline; page += 1) {
          try {
            await reserveBudgetedApiCall({ provider: "GOOGLE_PLACES", dailyLimit: env.GOOGLE_PLACES_DAILY_LIMIT, monthlyLimit: env.GOOGLE_PLACES_MONTHLY_LIMIT, estimatedCostCents: env.GOOGLE_PLACES_ESTIMATED_COST_CENTS });
            stats.estimatedCostCents += env.GOOGLE_PLACES_ESTIMATED_COST_CENTS;
            const result = await searchPlaces({ apiKey: env.GOOGLE_PLACES_API_KEY!, query: term, city: area.city, country: area.country, latitude: Number(area.latitude), longitude: Number(area.longitude), radius: area.radius, pageToken });
            result.candidates.forEach((candidate) => mergeCandidate(pending, candidate)); found += result.candidates.length; stats.found += result.candidates.length; pageToken = result.nextPageToken;
            await processPending(); if (!pageToken) break;
          } catch (error) { const text = message(error); stats.sourceFailures += 1; errors.push(`Google ${term} / ${area.city}: ${text}`); await logSource(runId, "GOOGLE_PLACES", "ERROR", text, area.city, branch); break; }
        }
        await recordCombination({ country: area.country, city: area.city, category: branch, source: "GOOGLE_PLACES", found, valid: stats.stored - before });
      }
    } else if (!placesEnabled) {
      await logSource(runId, "GOOGLE_PLACES", "INFO", "Betaalde provider uitgeschakeld; gratis bronnen blijven actief");
    }

    await processPending();
    await updateRun(runId, { ...updateData(stats, places, branches, errors), status: "COMPLETE", exhausted: stats.stored < run.targetCount, finishedAt: new Date() });
  } catch (error) {
    errors.push(message(error));
    await updateRun(runId, { ...updateData(stats, places, branches, errors), status: "FAILED", finishedAt: new Date() });
  } finally { await lock.release(); }
}
