import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { serverEnv } from "@/lib/env";
import { candidateDedupeKeys, fingerprintValues, RunDeduplicator } from "@/lib/leads/deduplication";
import { validateCandidateBasics, type Candidate } from "@/lib/leads/eligibility";
import { normalizeText } from "@/lib/leads/normalization";
import { verifyWebsiteCandidate, type WebsiteVerificationResult } from "@/lib/leads/website-verification";
import { enabledSourceAdapters } from "@/lib/sources/openstreetmap";
import { acquireJobLock } from "./lock";

type Stats = {
  found: number; checked: number; withoutWebsite: number; duplicates: number; rejected: number; stored: number;
  manualReview: number;
  websitesChecked: number; permanentlyClosed: number; temporarilyClosed: number; noWebsite: number;
  outdatedWebsite: number; improvableWebsite: number; sourceFailures: number;
};

const initialStats = (): Stats => ({ found: 0, checked: 0, withoutWebsite: 0, duplicates: 0, rejected: 0, stored: 0, manualReview: 0,
  websitesChecked: 0, permanentlyClosed: 0, temporarilyClosed: 0, noWebsite: 0, outdatedWebsite: 0,
  improvableWebsite: 0, sourceFailures: 0 });
const errorMessage = (error: unknown) => error instanceof Error ? error.message.slice(0, 300) : "Onbekende bronfout";

function runData(stats: Stats, places: Set<string>, errors: string[], warnings: string[]): Prisma.GenerationRunUpdateInput {
  return {
    candidatesFound: stats.found, candidatesChecked: stats.checked, withoutWebsite: stats.withoutWebsite,
    duplicates: stats.duplicates, rejected: stats.rejected, stored: stats.stored, manualReview: stats.manualReview, websitesChecked: stats.websitesChecked,
    permanentlyClosed: stats.permanentlyClosed, temporarilyClosed: stats.temporarilyClosed, noWebsite: stats.noWebsite,
    outdatedWebsite: stats.outdatedWebsite, improvableWebsite: stats.improvableWebsite, sourceFailures: stats.sourceFailures,
    estimatedCostCents: 0, placesUsed: [...places], branchesUsed: [], apiErrors: errors, warnings,
  };
}

export async function createGenerationRun() {
  const target = Number(process.env.LEAD_GENERATION_TARGET || 50);
  return prisma.generationRun.create({ data: { targetCount: Math.min(50, Math.max(1, target)), currentPhase: "Bronnen voorbereiden" } });
}

async function cancelled(runId: string) {
  return Boolean((await prisma.generationRun.findUnique({ where: { id: runId }, select: { cancelRequested: true } }))?.cancelRequested);
}

async function logSource(runId: string, source: string, level: string, message: string, city?: string) {
  await prisma.sourceLog.create({ data: { runId, source, level, message: message.slice(0, 500), city } });
}

async function sourceRecord(candidate: Candidate) {
  return prisma.sourceRecord.upsert({
    where: { source_sourceRecordId: { source: candidate.source ?? "OPENSTREETMAP", sourceRecordId: candidate.externalPlaceId } },
    create: {
      source: candidate.source ?? "OPENSTREETMAP", sourceRecordId: candidate.externalPlaceId, sourceUrl: candidate.sourceUrl ?? candidate.googleMapsUrl,
      fetchedAt: candidate.fetchedAt ? new Date(candidate.fetchedAt) : new Date(), rawName: candidate.companyName,
      rawAddress: candidate.streetAddress, rawPhone: candidate.internationalPhoneNumber || candidate.phoneNumber,
      rawWebsite: candidate.website, rawBusinessStatus: candidate.businessStatus, payload: JSON.parse(JSON.stringify(candidate)),
    },
    update: {
      sourceUrl: candidate.sourceUrl ?? candidate.googleMapsUrl, fetchedAt: candidate.fetchedAt ? new Date(candidate.fetchedAt) : new Date(),
      rawName: candidate.companyName, rawAddress: candidate.streetAddress, rawPhone: candidate.internationalPhoneNumber || candidate.phoneNumber,
      rawWebsite: candidate.website, rawBusinessStatus: candidate.businessStatus, payload: JSON.parse(JSON.stringify(candidate)),
    },
  });
}

async function isKnownCandidate(candidate: Candidate) {
  const keys = candidateDedupeKeys(candidate);
  const fingerprints = fingerprintValues(keys).map(({ fingerprint }) => fingerprint);
  const [lead, legacyExclusion, exclusion] = await Promise.all([
    prisma.lead.findFirst({ where: { OR: [
      { externalPlaceId: candidate.externalPlaceId },
      ...(keys.phone ? [{ normalizedPhoneNumber: keys.phone }] : []),
      { normalizedCompanyName: normalizeText(candidate.companyName), normalizedAddress: normalizeText(candidate.streetAddress) },
    ] }, select: { id: true } }),
    prisma.suppressedLead.findFirst({ where: { fingerprint: { in: fingerprints } }, select: { id: true } }),
    prisma.leadExclusion.findFirst({ where: { identityKey: { in: fingerprints }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { id: true } }),
  ]);
  return Boolean(lead || legacyExclusion || exclusion);
}

async function excludeCandidate(candidate: Candidate, verification: WebsiteVerificationResult) {
  const keys = candidateDedupeKeys(candidate);
  const identityKey = fingerprintValues(keys)[0]?.fingerprint ?? `external:${candidate.externalPlaceId}`;
  await prisma.leadExclusion.upsert({ where: { identityKey }, create: {
    identityKey, source: candidate.source, sourceRecordId: candidate.externalPlaceId, phoneNormalized: keys.phone,
    domainNormalized: verification.website ? new URL(verification.website).hostname.replace(/^www\./, "") : undefined,
    nameNormalized: keys.nameCityCategory.split("|")[0], postalCode: candidate.postalCode,
    reason: verification.status === "WEBSITE_FOUND" ? "Eigen website gevonden" : verification.reason,
  }, update: { reason: verification.reason, expiresAt: null } });
}

async function storeLead(candidate: Candidate, verification: WebsiteVerificationResult) {
  const basic = validateCandidateBasics(candidate);
  if (!basic.ok) return { stored: false, reviewOnly: false, reason: basic.reason };
  const reviewOnly = verification.status !== "NO_WEBSITE_CONFIRMED";
  const leadType = verification.status === "WEBSITE_OUTDATED" ? "OUTDATED_WEBSITE" : "NO_WEBSITE";
  const opportunityScore = reviewOnly ? 55 : 90;
  const lead = await prisma.lead.create({ data: {
    externalPlaceId: basic.lead.externalPlaceId, companyName: basic.lead.companyName, normalizedCompanyName: basic.lead.normalizedCompanyName,
    phoneNumber: basic.lead.phoneNumber || basic.lead.normalizedPhoneNumber, normalizedPhoneNumber: basic.lead.normalizedPhoneNumber,
    internationalPhoneNumber: basic.lead.internationalPhoneNumber || basic.lead.normalizedPhoneNumber, email: basic.lead.email,
    category: basic.lead.category, subCategory: basic.lead.subCategory, country: basic.lead.country, province: basic.lead.province,
    municipality: basic.lead.municipality, city: basic.lead.city, postalCode: basic.lead.postalCode, streetAddress: basic.lead.streetAddress,
    houseNumber: basic.lead.houseNumber, normalizedAddress: basic.lead.normalizedAddress, latitude: new Prisma.Decimal(basic.lead.latitude),
    longitude: new Prisma.Decimal(basic.lead.longitude), googleMapsUrl: basic.lead.googleMapsUrl, website: verification.website,
    websiteUrl: verification.website, normalizedDomain: verification.website ? new URL(verification.website).hostname.replace(/^www\./, "") : null,
    websiteStatus: verification.status, websiteStatusReason: verification.reason, websiteConfidence: verification.confidence,
    websiteSource: "local_verification", sourceUrl: basic.lead.sourceUrl ?? basic.lead.googleMapsUrl,
    sourceFetchedAt: basic.lead.fetchedAt ? new Date(basic.lead.fetchedAt) : new Date(), leadType, opportunityScore,
    conversionQualityScore: 0, businessStatus: basic.lead.businessStatus, source: "OPENSTREETMAP",
    confidenceScore: basic.lead.confidenceScore, confidenceLevel: basic.lead.confidenceLevel,
    status: reviewOnly ? "NEEDS_REVIEW" : "NEW", isActive: !reviewOnly, isFiltered: reviewOnly,
    filterReason: reviewOnly ? "Nog niet handmatig bevestigd via het actuele Google-bedrijfsprofiel." : null,
    evidence: { create: verification.evidence },
    activities: { create: { type: "LEAD_GENERATED", summary: verification.reason, details: { source: candidate.source, websiteStatus: verification.status } } },
    history: { create: { event: "LEAD_GENERATED", details: { source: candidate.source, websiteStatus: verification.status } } },
  } });
  await prisma.sourceRecord.update({ where: { source_sourceRecordId: { source: candidate.source ?? "OPENSTREETMAP", sourceRecordId: candidate.externalPlaceId } }, data: { leadId: lead.id } });
  for (const item of fingerprintValues(candidateDedupeKeys(candidate))) {
    await prisma.duplicateFingerprint.upsert({ where: { fingerprint: item.fingerprint }, create: { ...item, leadId: lead.id }, update: { leadId: lead.id } });
  }
  return { stored: true, reviewOnly, reason: verification.reason };
}

function runCapacity(stats: Stats) { return stats.stored + stats.manualReview; }

export async function runLeadGeneration(runId: string) {
  const env = serverEnv();
  const lock = await acquireJobLock("manual-lead-generation", (env.GENERATION_MAX_DURATION_SECONDS + 30) * 1000);
  if (!lock) {
    await prisma.generationRun.update({ where: { id: runId }, data: { status: "CANCELLED", stopReason: "Er draait al een leadgeneratie.", finishedAt: new Date() } });
    return;
  }
  const stats = initialStats(); const errors: string[] = []; const warnings: string[] = []; const places = new Set<string>(); const dedupe = new RunDeduplicator();
  const startedAt = Date.now(); const deadline = startedAt + env.GENERATION_MAX_DURATION_SECONDS * 1000;
  let sourceCalls = 0; let stopReason = "De beschikbare zoekgebieden zijn gecontroleerd.";
  try {
    const run = await prisma.generationRun.update({ where: { id: runId }, data: { status: "RUNNING", startedAt: new Date(), currentPhase: "Zoekgebieden laden" } });
    const adapters = enabledSourceAdapters();
    if (!adapters.length) throw new Error("Er is geen gratis databron ingeschakeld.");
    const rows = await prisma.coverageArea.findMany({ where: { status: { not: "PAUSED" } }, orderBy: [{ lastScannedAt: "asc" }, { priority: "asc" }] });
    const areas = [...new Map(rows.map((area) => [`${area.country}:${area.city}`, area])).values()];
    for (const area of areas) {
      if (runCapacity(stats) >= run.targetCount) { stopReason = stats.stored >= run.targetCount ? `Doel van ${run.targetCount} bevestigde leads bereikt.` : `${stats.manualReview} kandidaten wachten op handmatige Google-controle.`; break; }
      if (Date.now() >= deadline) { stopReason = "De veilige maximale looptijd is bereikt."; break; }
      if (sourceCalls >= env.GENERATION_MAX_SOURCE_CALLS) { stopReason = "De ingestelde bronlimiet is bereikt."; break; }
      if (await cancelled(runId)) { stopReason = "De zoekrun is door de gebruiker geannuleerd."; break; }
      for (const adapter of adapters) {
        if (runCapacity(stats) >= run.targetCount || Date.now() >= deadline || sourceCalls >= env.GENERATION_MAX_SOURCE_CALLS) break;
        sourceCalls += 1; const region = `${area.city}, ${area.country}`; places.add(region);
        await prisma.generationRun.update({ where: { id: runId }, data: { currentPhase: "Openbare bedrijfsvermeldingen ophalen", currentSource: adapter.id, currentRegion: region, ...runData(stats, places, errors, warnings) } });
        try {
          const result = await adapter.searchBusinesses({ country: area.country, city: area.city, latitude: Number(area.latitude), longitude: Number(area.longitude), radius: area.radius, category: area.category });
          stats.found += result.candidates.length; warnings.push(...result.warnings);
          for (const candidate of result.candidates) {
            if (runCapacity(stats) >= run.targetCount || Date.now() >= deadline || await cancelled(runId)) break;
            stats.checked += 1; await sourceRecord(candidate);
            const keys = candidateDedupeKeys(candidate);
            if (dedupe.hasOrAdd(keys) || await isKnownCandidate(candidate)) { stats.duplicates += 1; continue; }
            const basic = validateCandidateBasics(candidate);
            if (!basic.ok) {
              if (basic.reason === "niet_operationeel") stats.permanentlyClosed += 1;
              else stats.rejected += 1;
              continue;
            }
            await prisma.generationRun.update({ where: { id: runId }, data: { currentPhase: "Websitebewijs lokaal controleren" } });
            stats.websitesChecked += 1;
            const verification = await verifyWebsiteCandidate(candidate);
            if (verification.status === "WEBSITE_FOUND") { await excludeCandidate(candidate, verification); stats.rejected += 1; continue; }
            if (!["NO_WEBSITE_CONFIRMED", "SOCIAL_ONLY", "MANUAL_REVIEW_REQUIRED"].includes(verification.status)) {
              stats.rejected += 1; continue;
            }
            try {
              const saved = await storeLead(candidate, verification);
              if (saved.stored && saved.reviewOnly) stats.manualReview += 1;
              else if (saved.stored) { stats.stored += 1; stats.withoutWebsite += 1; stats.noWebsite += 1; }
              else stats.rejected += 1;
            } catch (error) {
              if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") stats.duplicates += 1;
              else { stats.rejected += 1; errors.push(`${candidate.companyName}: ${errorMessage(error)}`); }
            }
            if (stats.checked % 5 === 0) await prisma.generationRun.update({ where: { id: runId }, data: runData(stats, places, errors, warnings) });
          }
          await prisma.coverageArea.updateMany({ where: { country: area.country, city: area.city }, data: { lastScannedAt: new Date(), resultsFound: { increment: result.candidates.length } } });
        } catch (error) {
          const message = errorMessage(error); stats.sourceFailures += 1; errors.push(`${adapter.id} / ${region}: ${message}`);
          await logSource(runId, adapter.id, "ERROR", message, area.city);
        }
      }
    }
    const wasCancelled = await cancelled(runId);
    const exhausted = stats.stored < run.targetCount;
    await prisma.generationRun.update({ where: { id: runId }, data: {
      ...runData(stats, places, errors, warnings), status: wasCancelled ? "CANCELLED" : "COMPLETE", exhausted,
      currentPhase: wasCancelled ? "Geannuleerd" : "Voltooid", stopReason, finishedAt: new Date(),
    } });
  } catch (error) {
    errors.push(errorMessage(error));
    await prisma.generationRun.update({ where: { id: runId }, data: { ...runData(stats, places, errors, warnings), status: "FAILED", currentPhase: "Mislukt", stopReason: errorMessage(error), finishedAt: new Date() } });
  } finally { await lock.release(); }
}
