import { CandidateQueueStatus, JobStatus, Prisma, type GenerationCandidate, type GenerationRun } from "@prisma/client";

import { serverEnv } from "@/lib/env";
import { candidateDedupeKeys, fingerprintValues, RunDeduplicator, strongIdentityFingerprintValues } from "@/lib/leads/deduplication";
import { isPermanentlyClosed, isTemporarilyClosed } from "@/lib/leads/company-status";
import { validateCandidateBasics, type Candidate } from "@/lib/leads/eligibility";
import { enrichCandidateAddress } from "@/lib/leads/address-enrichment";
import { hasReadableAddress, isStatusVerificationRetry, validateStrictLead, validateStrictLeadBeforeContactEnrichment, validateStrictLeadBeforeLocation, type StrictLeadReason } from "@/lib/leads/strict-validation";
import { validatePublicBusinessEmail } from "@/lib/leads/business-email";
import { detectBlockedLocation } from "@/lib/leads/blocked-location";
import { evaluateNewLeadGate } from "@/lib/leads/intake-gate";
import { qualifyWebsiteCandidate } from "@/lib/leads/digital-qualification";
import { normalizePhones, normalizeText } from "@/lib/leads/normalization";
import { candidateQualityScore } from "@/lib/leads/candidate-score";
import { applySingleLocationDecision, assessSingleLocation, directSingleLocationSignal, organizationNameKey, type SingleLocationDecision, type SingleLocationReason } from "@/lib/leads/single-location";
import { NEW_PIPELINE_STAGE_ID } from "@/lib/leads/pipeline";
import { importDueValidationRetries, importInterruptedGenerationCandidates, markValidationRejected, queueValidationRetry } from "@/lib/leads/retry-queue";
import { extractCompanyWebsite } from "@/lib/leads/website";
import type { WebsiteVerificationResult } from "@/lib/leads/website-verification";
import { initialOverpassSearchCursor, nextOverpassTileCursor, OSM_SEARCH_CURSOR_COUNT, overpassSearchPlan, type OverpassEvent } from "@/lib/openstreetmap/overpass";
import { prisma } from "@/lib/prisma";
import { enabledSourceAdapters } from "@/lib/sources/openstreetmap";
import { acquireJobLock } from "./lock";
import { MAX_CANDIDATES_PER_BATCH, MAX_CANDIDATES_PER_RUN, RUN_DRAIN_WINDOW_MS } from "./generation-config";
import { exhaustedSearchAreasReason } from "./generation-summary";
import { candidateReservationLimit, candidateRetryStatus, generationCompletionStatus, generationProgress, generationRetryImportLimit, isBatchDeadlineNear, isGenerationRunExpired, nextConsecutiveSourceFailures, phaseProgress, shouldStopForSourceOutage, sourceAttemptDelta, sourceFailureWarningDue, terminalGenerationStatuses } from "./generation-state";
import { nextUnattemptedCursor, searchSpaceProgress, searchStrategySegment } from "./run-search-state";
import { lowYieldCooldownMs, preferUnusedCities, selectAdaptiveSearchArea } from "./search-selection";
import { qualifiedBatchState } from "@/lib/leads/qualified-batch";

type Stats = {
  found: number;
  checked: number;
  cheapRejected: number;
  externallyValidated: number;
  cacheHits: number;
  withoutWebsite: number;
  duplicates: number;
  existing: number;
  rejected: number;
  stored: number;
  manualReview: number;
  websitesChecked: number;
  websitesFound: number;
  permanentlyClosed: number;
  temporarilyClosed: number;
  noWebsite: number;
  outdatedWebsite: number;
  improvableWebsite: number;
  sourceFailures: number;
  wrongLocationRejected: number;
  insufficientDataRejected: number;
  validCandidates: number;
  databaseInsertAttempts: number;
  databaseInsertFailures: number;
  blockedBrussels: number;
  blockedGhent: number;
  invalidPhone: number;
  emailsFound: number;
  emailsMissing: number;
  emailsInvalid: number;
  emailRetries: number;
  emailsExternallyVerified: number;
  languageRejected: number;
  multipleLocationsRejected: number;
  chainRejected: number;
  franchiseRejected: number;
  sameNameMultipleAddresses: number;
  samePhoneMultipleAddresses: number;
  locationCountUncertain: number;
  duplicateListingsMerged: number;
};

const terminalStatuses = new Set<JobStatus>(terminalGenerationStatuses as readonly JobStatus[]);
const errorMessage = (error: unknown) => error instanceof Error ? error.message.slice(0, 300) : "Onbekende bronfout";
const stringArray = (value: Prisma.JsonValue): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export class DuplicateIdentityError extends Error {
  constructor(readonly fingerprint: string, readonly existingLeadId: string) {
    super(`Identiteitsvingerafdruk ${fingerprint} hoort al bij lead ${existingLeadId}.`);
    this.name = "DuplicateIdentityError";
  }
}

export function databaseErrorEvidence(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = error.meta && typeof error.meta === "object" ? error.meta as Record<string, unknown> : {};
    return {
      code: error.code,
      model: typeof meta.modelName === "string" ? meta.modelName : undefined,
      constraint: typeof meta.constraint === "string" ? meta.constraint : undefined,
      target: Array.isArray(meta.target) ? meta.target.map(String) : typeof meta.target === "string" ? [meta.target] : undefined,
      field: typeof meta.field_name === "string" ? meta.field_name : undefined,
      message: errorMessage(error),
    };
  }
  return { code: error instanceof DuplicateIdentityError ? "DUPLICATE_IDENTITY" : "DATABASE_ERROR", message: errorMessage(error) };
}

function candidateCheckResults(candidate: Candidate, extra?: Record<string, unknown>) {
  const phones = normalizePhones(
    [candidate.internationalPhoneNumber, candidate.phoneNumber, ...(candidate.phoneNumbers ?? [])],
    candidate.country,
  );
  const officialSourceWebsite = extractCompanyWebsite(candidate);
  return {
    businessStatus: isPermanentlyClosed(candidate)
      ? "closed"
      : isTemporarilyClosed(candidate) ? "temporarily_closed" : candidate.businessStatus?.toLowerCase() || "unknown",
    address: hasReadableAddress(candidate) ? "readable" : "missing_or_unreadable",
    phone: phones.length ? "valid_and_normalized" : "missing_or_invalid",
    publicBusinessEmail: !candidate.email
      ? "missing"
      : candidate.emailMxVerified ? "public_and_mx_verified" : "present_not_yet_mx_verified",
    sourceWebsite: officialSourceWebsite ? "official_website_found" : "no_official_website_in_source",
    language: candidate.language || "unknown",
    locationCount: candidate.singleLocationStatus || "not_yet_checked",
    duplicateMatch: Array.isArray(extra?.matchedFields) ? extra.matchedFields : [],
  };
}

function decisionEvidence(candidate: Candidate, extra?: Record<string, unknown>): Prisma.InputJsonValue {
  const blocked = detectBlockedLocation(candidate as Candidate & Record<string, unknown>);
  return JSON.parse(JSON.stringify({
    sourceRecordId: candidate.externalPlaceId,
    sourceUrl: candidate.sourceUrl ?? candidate.googleMapsUrl,
    country: candidate.country,
    province: candidate.province,
    municipality: candidate.municipality,
    city: candidate.city,
    postalCode: candidate.postalCode,
    streetAddress: candidate.streetAddress,
    normalizedPhones: normalizePhones([candidate.internationalPhoneNumber, candidate.phoneNumber, ...(candidate.phoneNumbers ?? [])], candidate.country),
    email: candidate.email,
    emailSource: candidate.emailSource,
    emailSourceUrl: candidate.emailSourceUrl,
    emailMxVerified: candidate.emailMxVerified,
    emailVerifiedAt: candidate.emailVerifiedAt,
    businessStatus: candidate.businessStatus,
    language: candidate.language,
    languageConfidence: candidate.languageConfidence,
    sourceUpdatedAt: candidate.sourceUpdatedAt,
    blockedArea: blocked.area,
    blockedField: blocked.matchedField,
    singleLocationStatus: candidate.singleLocationStatus,
    singleLocationReason: candidate.singleLocationReason,
    locationEvidence: candidate.locationEvidence,
    checkResults: candidateCheckResults(candidate, extra),
    ...extra,
  }));
}

function statsFromRun(run: GenerationRun): Stats {
  return {
    found: run.candidatesFound,
    checked: run.candidatesChecked,
    cheapRejected: run.cheapRejected,
    externallyValidated: run.externallyValidated,
    cacheHits: run.cacheHits,
    withoutWebsite: run.withoutWebsite,
    duplicates: run.duplicates,
    existing: run.existingLeads,
    rejected: run.rejected,
    stored: run.stored,
    manualReview: run.manualReview,
    websitesChecked: run.websitesChecked,
    websitesFound: run.websitesFound,
    permanentlyClosed: run.permanentlyClosed,
    temporarilyClosed: run.temporarilyClosed,
    noWebsite: run.noWebsite,
    outdatedWebsite: run.outdatedWebsite,
    improvableWebsite: run.improvableWebsite,
    sourceFailures: run.sourceFailures,
    wrongLocationRejected: run.wrongLocationRejected,
    insufficientDataRejected: run.insufficientDataRejected,
    validCandidates: run.validCandidates,
    databaseInsertAttempts: run.databaseInsertAttempts,
    databaseInsertFailures: run.databaseInsertFailures,
    blockedBrussels: run.blockedBrussels,
    blockedGhent: run.blockedGhent,
    invalidPhone: run.invalidPhone,
    emailsFound: run.emailsFound,
    emailsMissing: run.emailsMissing,
    emailsInvalid: run.emailsInvalid,
    emailRetries: run.emailRetries,
    emailsExternallyVerified: run.emailsExternallyVerified,
    languageRejected: run.languageRejected,
    multipleLocationsRejected: run.multipleLocationsRejected,
    chainRejected: run.chainRejected,
    franchiseRejected: run.franchiseRejected,
    sameNameMultipleAddresses: run.sameNameMultipleAddresses,
    samePhoneMultipleAddresses: run.samePhoneMultipleAddresses,
    locationCountUncertain: run.locationCountUncertain,
    duplicateListingsMerged: run.duplicateListingsMerged,
  };
}

function runData(stats: Stats, places: string[], errors: string[], warnings: string[]): Prisma.GenerationRunUpdateInput {
  const branches = [...new Set(places.map((segment) => segment.split(":")[2]).filter(Boolean))];
  return {
    candidatesFound: stats.found,
    candidatesChecked: stats.checked,
    cheapRejected: stats.cheapRejected,
    externallyValidated: stats.externallyValidated,
    cacheHits: stats.cacheHits,
    withoutWebsite: stats.withoutWebsite,
    duplicates: stats.duplicates,
    existingLeads: stats.existing,
    rejected: stats.rejected,
    stored: stats.stored,
    manualReview: stats.manualReview,
    websitesChecked: stats.websitesChecked,
    websitesFound: stats.websitesFound,
    permanentlyClosed: stats.permanentlyClosed,
    temporarilyClosed: stats.temporarilyClosed,
    noWebsite: stats.noWebsite,
    outdatedWebsite: stats.outdatedWebsite,
    improvableWebsite: stats.improvableWebsite,
    sourceFailures: stats.sourceFailures,
    wrongLocationRejected: stats.wrongLocationRejected,
    insufficientDataRejected: stats.insufficientDataRejected,
    validCandidates: stats.validCandidates,
    databaseInsertAttempts: stats.databaseInsertAttempts,
    databaseInsertFailures: stats.databaseInsertFailures,
    blockedBrussels: stats.blockedBrussels,
    blockedGhent: stats.blockedGhent,
    invalidPhone: stats.invalidPhone,
    emailsFound: stats.emailsFound,
    emailsMissing: stats.emailsMissing,
    emailsInvalid: stats.emailsInvalid,
    emailRetries: stats.emailRetries,
    emailsExternallyVerified: stats.emailsExternallyVerified,
    languageRejected: stats.languageRejected,
    multipleLocationsRejected: stats.multipleLocationsRejected,
    chainRejected: stats.chainRejected,
    franchiseRejected: stats.franchiseRejected,
    sameNameMultipleAddresses: stats.sameNameMultipleAddresses,
    samePhoneMultipleAddresses: stats.samePhoneMultipleAddresses,
    locationCountUncertain: stats.locationCountUncertain,
    duplicateListingsMerged: stats.duplicateListingsMerged,
    estimatedCostCents: 0,
    placesUsed: places,
    branchesUsed: branches,
    apiErrors: errors.slice(-50),
    warnings: warnings.slice(-50),
    heartbeatAt: new Date(),
  };
}

function capacity(stats: Pick<Stats, "stored">) { return stats.stored; }

function preservedCandidateCount(stats: Pick<Stats, "manualReview">, pendingCandidates: number) {
  return Math.max(stats.manualReview, pendingCandidates);
}

function timeLimitReason(stats: Stats, pendingCandidates: number, maxMinutes: number, consecutiveSourceFailures: number) {
  const preserved = preservedCandidateCount(stats, pendingCandidates);
  if (stats.stored > 0) {
    return `De maximale zoektijd van ${maxMinutes} minuten is bereikt. ${stats.stored} gekwalificeerde concepten blijven veilig bewaard en worden in een vervolgrun aangevuld tot de volledige batch. ${stats.checked} kandidaten zijn gecontroleerd${preserved ? ` en ${preserved} kandidaten blijven bewaard voor hercontrole` : ""}.`;
  }
  if (consecutiveSourceFailures > 0 && stats.checked === 0) {
    return `De gratis bedrijfsbronnen waren tijdelijk niet bereikbaar. Er zijn geen kandidaten gecontroleerd of leads opgeslagen; de zoekruimte is niet als uitgeput gemarkeerd.`;
  }
  return `De maximale verwerkingstijd van ${maxMinutes} minuten is bereikt. ${stats.checked} kandidaten zijn gecontroleerd, maar nog geen bedrijf voldeed aan alle ingestelde criteria${preserved ? `; ${preserved} kandidaten blijven bewaard voor een volgende run` : ""}.`;
}

function candidateBudgetReason(stats: Stats, pendingCandidates: number, maxCandidates: number) {
  const preserved = preservedCandidateCount(stats, pendingCandidates);
  if (stats.stored > 0) {
    return `De kandidaatslimiet van ${maxCandidates} is bereikt. ${stats.checked} kandidaten zijn gecontroleerd en ${stats.stored} gekwalificeerde concepten blijven veilig bewaard${preserved ? `; ${preserved} kandidaten blijven bewaard voor een volgende run` : ""}.`;
  }
  return `Er zijn ${stats.checked} unieke kandidaten onderzocht, maar geen nieuwe bedrijven voldeden aan alle ingestelde criteria${preserved ? `; ${preserved} kandidaten met een tijdelijke fout blijven bewaard voor een volgende run` : ""}.`;
}

export async function createGenerationRun() {
  const env = serverEnv();
  const target = env.LEAD_GENERATION_TARGET;
  const run = await prisma.$transaction(async (tx) => {
    const reusable = await tx.qualifiedLeadDraft.findMany({
      orderBy: { createdAt: "asc" },
      take: target,
      select: { id: true },
    });
    const created = await tx.generationRun.create({
      data: {
        targetCount: target,
        stored: reusable.length,
        maxCandidates: MAX_CANDIDATES_PER_RUN,
        currentPhase: "Zoekopdracht klaarzetten",
        progress: phaseProgress("queued"),
        message: reusable.length
          ? `${reusable.length} eerder gekwalificeerde concepten worden opnieuw gevalideerd en aangevuld tot ${target}.`
          : "De zoekopdracht is gevalideerd en staat klaar.",
        heartbeatAt: new Date(),
      },
    });
    if (reusable.length) {
      await tx.qualifiedLeadDraft.updateMany({
        where: { id: { in: reusable.map(({ id }) => id) } },
        data: { runId: created.id },
      });
    }
    return created;
  });
  const event = { jobId: run.id, step: "job_started", startedAt: run.createdAt.toISOString(), targetCount: run.targetCount, sources: ["OPENSTREETMAP"] };
  console.info(JSON.stringify(event));
  await logSource(run.id, "GENERATION", "INFO", JSON.stringify(event)).catch((error) => {
    console.warn(JSON.stringify({ jobId: run.id, step: "job_start_log_failed", message: errorMessage(error) }));
  });
  return run;
}

export async function markStaleGenerationRuns(now = new Date()) {
  const env = serverEnv();
  const staleBefore = new Date(now.getTime() - env.GENERATION_WATCHDOG_SECONDS * 1000);
  await prisma.generationCandidate.updateMany({
    where: { status: "PROCESSING", OR: [{ leaseExpiresAt: { lt: now } }, { leaseExpiresAt: null, claimedAt: { lt: staleBefore } }] },
    data: { status: "PENDING", claimedAt: null, leaseOwner: null, leaseExpiresAt: null, lastError: "Onderbroken batch automatisch vrijgegeven." },
  });
  return prisma.generationRun.updateMany({
    where: { status: JobStatus.RUNNING, updatedAt: { lt: staleBefore } },
    data: {
      status: JobStatus.PENDING,
      currentPhase: "Batch wordt hervat",
      message: "Een onderbroken batch is veilig vrijgegeven en wordt vanaf de opgeslagen cursor hervat.",
      stopReason: null,
      heartbeatAt: now,
    },
  });
}

export async function latestGenerationRun() {
  await markStaleGenerationRuns();
  return prisma.generationRun.findFirst({ orderBy: { createdAt: "desc" } });
}

export async function cancelGenerationRun(runId?: string) {
  const active = runId
    ? await prisma.generationRun.findFirst({ where: { id: runId, status: { in: [JobStatus.PENDING, JobStatus.RUNNING] } } })
    : await prisma.generationRun.findFirst({ where: { status: { in: [JobStatus.PENDING, JobStatus.RUNNING] } }, orderBy: { createdAt: "desc" } });
  if (!active) return null;
  return prisma.generationRun.update({
    where: { id: active.id },
    data: {
      cancelRequested: true,
      status: JobStatus.CANCELLED,
      progress: 100,
      currentPhase: "Geannuleerd",
      message: "De zoekrun is geannuleerd. Er worden geen nieuwe kandidaten meer opgeslagen.",
      stopReason: "De zoekrun is door de gebruiker geannuleerd.",
      finishedAt: new Date(),
      heartbeatAt: new Date(),
    },
  });
}

async function logSource(runId: string, source: string, level: string, message: string, city?: string, category?: string) {
  await prisma.sourceLog.create({ data: { runId, source, level, message: message.slice(0, 500), city, category } });
}

async function logOverpassEvent(runId: string, city: string, category: string, event: OverpassEvent) {
  const entry = { jobId: runId, step: "source_fetch", ...event };
  const level = event.errorType ? "ERROR" : "INFO";
  console.info(JSON.stringify(entry));
  await prisma.$transaction([
    prisma.sourceLog.create({ data: {
      runId, source: "OPENSTREETMAP", level, message: JSON.stringify(entry).slice(0, 500), city, category,
    } }),
    prisma.generationRun.update({
      where: { id: runId },
      data: {
        sourceRequests: { increment: event.errorType === "cancelled" ? 0 : 1 },
        sourceSuccesses: { increment: !event.errorType && typeof event.resultCount === "number" ? 1 : 0 },
      },
    }),
  ]);
}

async function recordBlockedCandidates(runId: string, candidates: Candidate[]) {
  if (!candidates.length) return;
  const rows = candidates.map((candidate) => ({
    candidate,
    detected: detectBlockedLocation(candidate as Candidate & Record<string, unknown>),
  }));
  await prisma.sourceLog.createMany({ data: rows.map(({ candidate, detected }) => ({
    runId, source: candidate.source ?? "OPENSTREETMAP", level: "INFO", city: candidate.city, category: candidate.category,
    message: JSON.stringify({ jobId: runId, step: "blocked_location_rejected", sourceRecordId: candidate.externalPlaceId,
      area: detected.area, reason: detected.reason, matchedField: detected.matchedField }).slice(0, 500),
  })) });
  await Promise.allSettled(rows.map(({ candidate, detected }) => prisma.sourceRecord.upsert({
    where: { source_sourceRecordId: { source: candidate.source ?? "OPENSTREETMAP", sourceRecordId: candidate.externalPlaceId } },
    create: {
      source: candidate.source ?? "OPENSTREETMAP", sourceRecordId: candidate.externalPlaceId,
      sourceUrl: candidate.sourceUrl ?? candidate.googleMapsUrl, rawName: candidate.companyName,
      rawAddress: candidate.formattedAddress ?? candidate.streetAddress,
      rawPhone: candidate.internationalPhoneNumber || candidate.phoneNumber,
      rawEmail: candidate.email, rawEmailSource: candidate.emailSource,
      rawWebsite: candidate.website, rawBusinessStatus: candidate.businessStatus,
      decision: "rejected", reasonCode: detected.area === "BRUSSELS" ? "BLOCKED_BRUSSELS" : "BLOCKED_GHENT",
      processedAt: new Date(), decisionEvidence: decisionEvidence(candidate, { blockedReason: detected.reason }), payload: JSON.parse(JSON.stringify(candidate)),
    },
    update: {
      decision: "rejected", reasonCode: detected.area === "BRUSSELS" ? "BLOCKED_BRUSSELS" : "BLOCKED_GHENT",
      processedAt: new Date(), decisionEvidence: decisionEvidence(candidate, { blockedReason: detected.reason }), payload: JSON.parse(JSON.stringify(candidate)),
    },
  })));
}

async function sourceRecord(candidate: Candidate) {
  return prisma.sourceRecord.upsert({
    where: { source_sourceRecordId: { source: candidate.source ?? "OPENSTREETMAP", sourceRecordId: candidate.externalPlaceId } },
    create: {
      source: candidate.source ?? "OPENSTREETMAP",
      sourceRecordId: candidate.externalPlaceId,
      sourceUrl: candidate.sourceUrl ?? candidate.googleMapsUrl,
      fetchedAt: candidate.fetchedAt ? new Date(candidate.fetchedAt) : new Date(),
      rawName: candidate.companyName,
      rawAddress: candidate.streetAddress,
      rawPhone: candidate.internationalPhoneNumber || candidate.phoneNumber,
      rawEmail: candidate.email,
      rawEmailSource: candidate.emailSource,
      rawWebsite: candidate.website,
      rawBusinessStatus: candidate.businessStatus,
      payload: JSON.parse(JSON.stringify(candidate)),
    },
    update: {
      sourceUrl: candidate.sourceUrl ?? candidate.googleMapsUrl,
      fetchedAt: candidate.fetchedAt ? new Date(candidate.fetchedAt) : new Date(),
      rawName: candidate.companyName,
      rawAddress: candidate.streetAddress,
      rawPhone: candidate.internationalPhoneNumber || candidate.phoneNumber,
      rawEmail: candidate.email,
      rawEmailSource: candidate.emailSource,
      rawWebsite: candidate.website,
      rawBusinessStatus: candidate.businessStatus,
      payload: JSON.parse(JSON.stringify(candidate)),
    },
  });
}

async function markDecision(candidate: Candidate, decision: string, reasonCode: string, leadId?: string, extraEvidence?: Record<string, unknown>) {
  const evidence = decisionEvidence(candidate, extraEvidence);
  await prisma.sourceRecord.update({
    where: { source_sourceRecordId: { source: candidate.source ?? "OPENSTREETMAP", sourceRecordId: candidate.externalPlaceId } },
    data: { decision, reasonCode, decisionEvidence: evidence, processedAt: new Date(), leadId },
  });
  await prisma.searchCombination.updateMany({
    where: {
      country: candidate.country.toUpperCase(),
      city: candidate.city,
      category: candidate.category,
      source: candidate.source ?? "OPENSTREETMAP",
    },
    data: {
      candidatesChecked: { increment: 1 },
      ...(decision === "retry" ? { retryCandidates: { increment: 1 } } : {}),
      ...(["rejected", "skipped", "duplicate"].includes(decision) ? { rejectedCandidates: { increment: 1 } } : {}),
      ...(decision === "stored" ? { lastSuccessAt: new Date() } : {}),
    },
  });
  console.info(JSON.stringify({
    step: "candidate_decision",
    source: candidate.source ?? "OPENSTREETMAP",
    sourceRecordId: candidate.externalPlaceId,
    companyName: candidate.companyName,
    decision,
    reasonCode,
    leadId,
    databaseWriteConfirmed: decision === "stored" && Boolean(leadId),
    checkResults: candidateCheckResults(candidate, extraEvidence),
  }));
}

type KnownCandidateMatch = {
  reason: string;
  disposition: "duplicate" | "rejected";
  leadId?: string;
  matchedFields: string[];
};

async function knownCandidateReasons(candidates: Candidate[]) {
  const entries = candidates.map((candidate) => ({ candidate, keys: candidateDedupeKeys(candidate) }));
  const fingerprints = [...new Set(entries.flatMap(({ keys }) => fingerprintValues(keys).map(({ fingerprint }) => fingerprint)))];
  const [sourceRecords, leads, suppressed, exclusions] = await Promise.all([
    prisma.sourceRecord.findMany({
      where: { OR: entries.map(({ candidate }) => ({ source: candidate.source ?? "OPENSTREETMAP", sourceRecordId: candidate.externalPlaceId })) },
      select: { source: true, sourceRecordId: true, decision: true, reasonCode: true, leadId: true },
    }),
    prisma.lead.findMany({
      where: { OR: [
        { externalPlaceId: { in: entries.map(({ candidate }) => candidate.externalPlaceId) } },
        { googlePlaceId: { in: entries.flatMap(({ keys }) => keys.googlePlaceId ? [keys.googlePlaceId] : []) } },
        { normalizedPhoneNumber: { in: entries.flatMap(({ keys }) => keys.phone ? [keys.phone] : []) } },
        { email: { in: entries.flatMap(({ keys }) => keys.email ? [keys.email] : []), mode: "insensitive" } },
        { normalizedDomain: { in: entries.flatMap(({ keys }) => keys.domain ? [keys.domain] : []) } },
        ...entries.map(({ candidate }) => ({ normalizedCompanyName: normalizeText(candidate.companyName), normalizedAddress: normalizeText(candidate.streetAddress) })),
      ] },
      select: { id: true, externalPlaceId: true, googlePlaceId: true, normalizedPhoneNumber: true, email: true, normalizedDomain: true, normalizedCompanyName: true, normalizedAddress: true },
    }),
    prisma.suppressedLead.findMany({ where: { fingerprint: { in: fingerprints } }, select: { fingerprint: true } }),
    prisma.leadExclusion.findMany({ where: { identityKey: { in: fingerprints }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { identityKey: true } }),
  ]);
  const blocked = new Set([...suppressed.map(({ fingerprint }) => fingerprint), ...exclusions.map(({ identityKey }) => identityKey)]);
  return new Map<string, KnownCandidateMatch | null>(entries.map(({ candidate, keys }) => {
    let match: KnownCandidateMatch | null = null;
    const priorSource = sourceRecords.find(({ source, sourceRecordId }) => source === (candidate.source ?? "OPENSTREETMAP") && sourceRecordId === candidate.externalPlaceId);
    const sourceLead = leads.find((lead) => lead.externalPlaceId === candidate.externalPlaceId);
    const googlePlaceLead = keys.googlePlaceId ? leads.find((lead) => lead.googlePlaceId === keys.googlePlaceId) : undefined;
    const emailLead = keys.email ? leads.find((lead) => lead.email?.trim().toLowerCase() === keys.email) : undefined;
    const domainLead = keys.domain ? leads.find((lead) => lead.normalizedDomain === keys.domain) : undefined;
    const phoneLead = keys.phone ? leads.find((lead) => lead.normalizedPhoneNumber === keys.phone) : undefined;
    const addressLead = leads.find((lead) => lead.normalizedCompanyName === normalizeText(candidate.companyName) && lead.normalizedAddress === normalizeText(candidate.streetAddress));
    if (sourceLead || googlePlaceLead || priorSource?.leadId || ["stored", "duplicate"].includes(priorSource?.decision ?? "")) {
      match = {
        reason: googlePlaceLead ? "duplicate_google_place_id" : "duplicate_source_id",
        disposition: "duplicate",
        leadId: sourceLead?.id ?? googlePlaceLead?.id ?? priorSource?.leadId ?? undefined,
        matchedFields: [googlePlaceLead ? "google_place_id" : "source_id"],
      };
    } else if (emailLead) match = { reason: "duplicate_email", disposition: "duplicate", leadId: emailLead.id, matchedFields: ["email"] };
    else if (domainLead) match = { reason: "duplicate_domain", disposition: "duplicate", leadId: domainLead.id, matchedFields: ["domain"] };
    else if (phoneLead) match = { reason: "duplicate_phone", disposition: "duplicate", leadId: phoneLead.id, matchedFields: ["phone"] };
    else if (addressLead) match = { reason: "duplicate_name_address", disposition: "duplicate", leadId: addressLead.id, matchedFields: ["name", "address"] };
    else if (["skipped", "rejected"].includes(priorSource?.decision ?? "") && [
      "SKIPPED_PERMANENTLY_CLOSED",
      "SKIPPED_HAS_WEBSITE",
      "BUSINESS_CLOSED",
      "REGION_NOT_ALLOWED",
      "OWN_WEBSITE_FOUND",
      "EXCLUDED_CATEGORY",
      "BLOCKED_BRUSSELS",
      "BLOCKED_GHENT",
      "meerdere_vestigingen",
      "vermoedelijke_keten",
      "franchise",
      "merk_of_netwerk",
      "zelfde_naam_meerdere_adressen",
      "zelfde_telefoon_meerdere_adressen",
    ].includes(priorSource?.reasonCode ?? "")) {
      match = { reason: priorSource?.reasonCode ?? "previously_rejected", disposition: "rejected", matchedFields: ["source_id"] };
    } else if (strongIdentityFingerprintValues(keys).some(({ fingerprint }) => blocked.has(fingerprint))) {
      match = { reason: "previously_rejected", disposition: "rejected", matchedFields: ["strong_identity"] };
    }
    return [candidate.externalPlaceId, match] as const;
  }));
}

function countSingleLocationDecision(stats: Stats, decision: SingleLocationDecision) {
  if (decision.status === "MULTIPLE") stats.multipleLocationsRejected += 1;
  if (["vermoedelijke_keten", "merk_of_netwerk"].includes(decision.reason)) stats.chainRejected += 1;
  if (decision.reason === "franchise") stats.franchiseRejected += 1;
  if (decision.reason === "zelfde_naam_meerdere_adressen") stats.sameNameMultipleAddresses += 1;
  if (decision.reason === "zelfde_telefoon_meerdere_adressen") stats.samePhoneMultipleAddresses += 1;
  if (decision.status === "UNCERTAIN") stats.locationCountUncertain += 1;
  if (decision.reason === "dubbele_vermelding_zelfde_vestiging") stats.duplicateListingsMerged += Math.max(1, decision.duplicateExternalIds.length);
}

async function excludeSingleLocation(candidate: Candidate, reason: SingleLocationReason) {
  const keys = candidateDedupeKeys(candidate);
  await Promise.all(strongIdentityFingerprintValues(keys).map(({ fingerprint: identityKey }) => prisma.leadExclusion.upsert({
    where: { identityKey },
    create: {
      identityKey,
      source: candidate.source,
      sourceRecordId: candidate.externalPlaceId,
      phoneNormalized: keys.phone,
      nameNormalized: organizationNameKey(candidate.companyName, candidate.city),
      postalCode: candidate.postalCode,
      reason,
    },
    update: { reason, expiresAt: null },
  })));
}

function candidateFromLead(lead: {
  externalPlaceId: string; companyName: string; phoneNumber: string; internationalPhoneNumber: string | null;
  email: string | null; category: string; country: string; province: string | null; municipality: string | null;
  city: string; postalCode: string | null; streetAddress: string; formattedAddress: string | null;
  latitude: Prisma.Decimal; longitude: Prisma.Decimal; googleMapsUrl: string; sourceUrl: string | null;
}) : Candidate {
  return {
    externalPlaceId: lead.externalPlaceId,
    companyName: lead.companyName,
    phoneNumber: lead.phoneNumber,
    internationalPhoneNumber: lead.internationalPhoneNumber ?? undefined,
    email: lead.email ?? undefined,
    category: lead.category,
    country: lead.country,
    province: lead.province ?? undefined,
    municipality: lead.municipality ?? undefined,
    city: lead.city,
    postalCode: lead.postalCode ?? undefined,
    streetAddress: lead.streetAddress,
    formattedAddress: lead.formattedAddress ?? undefined,
    latitude: Number(lead.latitude),
    longitude: Number(lead.longitude),
    googleMapsUrl: lead.googleMapsUrl,
    sourceUrl: lead.sourceUrl ?? undefined,
  };
}

async function databaseLocationEvidence(candidate: Candidate) {
  const phones = [candidate.phoneNumber, candidate.internationalPhoneNumber, ...(candidate.phoneNumbers ?? [])]
    .filter((value): value is string => Boolean(value?.trim()));
  const normalizedPhones = normalizePhones(phones, candidate.country);
  const [records, leads] = await Promise.all([
    prisma.sourceRecord.findMany({
      where: { OR: [
        { rawName: { equals: candidate.companyName, mode: "insensitive" } },
        ...(phones.length ? [{ rawPhone: { in: phones } }] : []),
      ] },
      select: { sourceRecordId: true, payload: true },
      take: 100,
    }),
    prisma.lead.findMany({
      where: { OR: [
        { normalizedCompanyName: normalizeText(candidate.companyName) },
        ...(normalizedPhones.length ? [{ normalizedPhoneNumber: { in: normalizedPhones } }] : []),
      ] },
      select: {
        externalPlaceId: true, companyName: true, phoneNumber: true, internationalPhoneNumber: true, email: true,
        category: true, country: true, province: true, municipality: true, city: true, postalCode: true,
        streetAddress: true, formattedAddress: true, latitude: true, longitude: true, googleMapsUrl: true, sourceUrl: true,
      },
      take: 100,
    }),
  ]);
  const sourceCandidates = records.flatMap((record): Candidate[] => {
    const payload = record.payload as unknown as Candidate | null;
    return payload?.externalPlaceId && payload.companyName ? [payload] : [];
  });
  return [...sourceCandidates, ...leads.map(candidateFromLead)];
}

async function verifySingleLocationForRun(runId: string, candidate: Candidate) {
  const direct = directSingleLocationSignal(candidate);
  if (direct) return { candidate: applySingleLocationDecision(candidate, direct), decision: direct, externallyValidated: false };
  try {
    const database = await databaseLocationEvidence(candidate);
    const adapter = enabledSourceAdapters().find((source) => source.id === candidate.source && source.findIdentityMatches);
    if (!adapter?.findIdentityMatches) {
      const decision = assessSingleLocation(candidate, database, false);
      return { candidate: applySingleLocationDecision(candidate, decision), decision, externallyValidated: false };
    }
    const sourceMatches = await adapter.findIdentityMatches(candidate, (event) => logOverpassEvent(runId, candidate.city, candidate.category, event));
    const related = [...new Map([...database, ...sourceMatches].map((item) => [item.externalPlaceId, item])).values()];
    const decision = assessSingleLocation(candidate, related, true);
    return { candidate: applySingleLocationDecision(candidate, decision), decision, externallyValidated: true };
  } catch (error) {
    const decision = assessSingleLocation(candidate, [], false);
    decision.evidence.push(`Identiteitscontrole mislukt: ${errorMessage(error)}`);
    return { candidate: applySingleLocationDecision(candidate, decision), decision, externallyValidated: true };
  }
}

async function logDuplicateMatch(runId: string, candidate: Candidate, match: KnownCandidateMatch | { reason: string; matchedExternalId?: string; matchedFields: string[] }) {
  const event = {
    jobId: runId,
    step: "candidate_duplicate",
    candidateId: candidate.externalPlaceId,
    matchedLeadId: "leadId" in match ? match.leadId : undefined,
    matchedCandidateId: "matchedExternalId" in match ? match.matchedExternalId : undefined,
    matchedFields: match.matchedFields,
    reason: match.reason,
  };
  console.info(JSON.stringify(event));
  await logSource(runId, candidate.source ?? "OPENSTREETMAP", "INFO", JSON.stringify(event), candidate.city, candidate.category);
}

async function excludeCandidate(candidate: Candidate, verification: WebsiteVerificationResult) {
  const keys = candidateDedupeKeys(candidate);
  await Promise.all(fingerprintValues(keys).map(({ fingerprint: identityKey }) => prisma.leadExclusion.upsert({
    where: { identityKey },
    create: {
      identityKey,
      source: candidate.source,
      sourceRecordId: candidate.externalPlaceId,
      phoneNormalized: keys.phone,
      domainNormalized: verification.website ? new URL(verification.website).hostname.replace(/^www\./, "") : undefined,
      nameNormalized: keys.nameCityCategory.split("|")[0],
      postalCode: candidate.postalCode,
      reason: verification.status === "WEBSITE_FOUND" ? "Eigen website gevonden" : verification.reason,
    },
    update: { reason: verification.reason, expiresAt: null },
  })));
}

type LeadWriteClient = Prisma.TransactionClient;

async function insertValidatedLead(
  tx: LeadWriteClient,
  candidate: Candidate,
  verification: WebsiteVerificationResult,
  batchId?: string,
) {
  // Existing leads must remain untouched.
  // Validation applies only to newly generated candidates.
  if (candidate.singleLocationStatus !== "CONFIRMED") return {
    stored: false,
    reviewOnly: candidate.singleLocationStatus !== "MULTIPLE",
    reason: candidate.singleLocationReason || "onzeker_aantal_vestigingen",
    leadId: undefined,
  };
  const strict = validateStrictLead(candidate, verification);
  if (!strict.valid) return { stored: false, reviewOnly: false, reason: strict.reasons[0], leadId: undefined };
  const gate = evaluateNewLeadGate(candidate, verification);
  if (!gate.allowed) return { stored: false, reviewOnly: false, reason: gate.reason, leadId: undefined };
  const basic = validateCandidateBasics(candidate);
  if (!basic.ok) return { stored: false, reviewOnly: false, reason: basic.reason, leadId: undefined };
  const verifiedEmail = Boolean(candidate.email?.trim() && candidate.emailMxVerified && candidate.emailSourceUrl?.trim());
  const finalLocation = detectBlockedLocation(candidate as Candidate & Record<string, unknown>);
  if (finalLocation.blocked) return {
    stored: false, reviewOnly: false,
    reason: finalLocation.area === "BRUSSELS" ? "BLOCKED_BRUSSELS" : "BLOCKED_GHENT",
    leadId: undefined,
  };
  const identityFingerprints = strongIdentityFingerprintValues(candidateDedupeKeys(candidate));
  const dedupeFingerprint = identityFingerprints.find(({ kind }) => kind === "phone")?.fingerprint
    ?? identityFingerprints.find(({ kind }) => kind === "google_place_id")?.fingerprint
    ?? identityFingerprints[0]?.fingerprint;
    const lead = await tx.lead.create({ data: {
      externalPlaceId: basic.lead.externalPlaceId,
      companyName: basic.lead.companyName,
      normalizedCompanyName: basic.lead.normalizedCompanyName,
      phoneNumber: basic.lead.normalizedPhoneNumber!,
      normalizedPhoneNumber: basic.lead.normalizedPhoneNumber,
      internationalPhoneNumber: basic.lead.internationalPhoneNumber || basic.lead.normalizedPhoneNumber || null,
      phoneValidationStatus: "VALID",
      phoneValidationSource: candidate.sourceUrl || candidate.googleMapsUrl,
      phoneValidatedAt: new Date(),
      email: verifiedEmail ? basic.lead.email : null,
      emailSource: verifiedEmail ? candidate.emailSource : null,
      emailSourceUrl: verifiedEmail ? candidate.emailSourceUrl : null,
      emailMxVerified: verifiedEmail,
      emailVerifiedAt: verifiedEmail ? (candidate.emailVerifiedAt ? new Date(candidate.emailVerifiedAt) : new Date()) : null,
      emailValidationStatus: verifiedEmail ? "DELIVERABLE" : "INVALID",
      emailValidationSource: verifiedEmail ? candidate.emailSourceUrl : null,
      emailValidatedAt: verifiedEmail ? (candidate.emailVerifiedAt ? new Date(candidate.emailVerifiedAt) : new Date()) : null,
      category: basic.lead.category,
      subCategory: basic.lead.subCategory,
      country: basic.lead.country,
      province: basic.lead.province,
      municipality: basic.lead.municipality,
      city: basic.lead.city,
      postalCode: basic.lead.postalCode,
      streetAddress: basic.lead.streetAddress,
      formattedAddress: candidate.formattedAddress || basic.lead.streetAddress,
      houseNumber: basic.lead.houseNumber,
      normalizedAddress: basic.lead.normalizedAddress,
      latitude: new Prisma.Decimal(basic.lead.latitude),
      longitude: new Prisma.Decimal(basic.lead.longitude),
      googleMapsUrl: candidate.googleBusinessProfileUrl || basic.lead.googleMapsUrl,
      googlePlaceId: candidate.googlePlaceId,
      googleBusinessProfileUrl: candidate.googleBusinessProfileUrl,
      googleBusinessProfileVerified: Boolean(candidate.googleBusinessProfileVerified),
      googleBusinessVerifiedAt: candidate.googleBusinessProfileVerified ? new Date() : null,
      website: verification.website,
      websiteUrl: verification.website,
      normalizedDomain: verification.website ? new URL(verification.website).hostname.replace(/^www\./, "") : null,
      websiteStatus: verification.status,
      websiteStatusReason: verification.reason,
      websiteConfidence: verification.confidence,
      websiteSource: "local_verification",
      sourceUrl: basic.lead.sourceUrl ?? basic.lead.googleMapsUrl,
      sourceFetchedAt: basic.lead.fetchedAt ? new Date(basic.lead.fetchedAt) : new Date(),
      leadType: verification.status === "NO_WEBSITE_CONFIRMED"
        ? "NO_WEBSITE"
        : verification.status === "IMPROVABLE_WEBSITE" ? "IMPROVABLE_WEBSITE" : "OUTDATED_WEBSITE",
      opportunityScore: verification.status === "NO_WEBSITE_CONFIRMED" ? 90 : verification.status === "WEBSITE_BROKEN" ? 95 : 80,
      conversionQualityScore: 0,
      qualificationReason: verification.reason,
      batchId,
      dedupeFingerprint,
      businessStatus: "OPERATIONAL",
      statusConfidence: strict.active.confidence,
      language: "nl",
      languageConfidence: strict.language.confidence,
      regionLanguage: candidate.regionLanguage || "Nederlands",
      verificationSource: candidate.source ?? "OPENSTREETMAP",
      singleLocationVerified: true,
      singleLocationReason: candidate.singleLocationReason || "enkele_vestiging_bevestigd",
      singleLocationVerifiedAt: new Date(),
      socialUrls: (candidate.socialUrls ?? []) as Prisma.InputJsonValue,
      source: candidate.source ?? "OPENSTREETMAP",
      confidenceScore: basic.lead.confidenceScore,
      confidenceLevel: basic.lead.confidenceLevel,
      pipelineStageId: NEW_PIPELINE_STAGE_ID,
      isActive: true,
      isFiltered: false,
      filterReason: null,
      evidence: { create: [
        ...verification.evidence,
        ...(verifiedEmail ? [{
          checkType: "BUSINESS_EMAIL",
          result: "PUBLIC_MX_VERIFIED",
          confidence: 95,
          evidenceUrl: candidate.emailSourceUrl,
          shortExplanation: `Openbaar zakelijk e-mailadres via ${candidate.emailSource || candidate.source || "openbare bron"}; MX-record bevestigd.`,
        }] : []),
      ] },
      activities: { create: { type: "LEAD_GENERATED", summary: verification.reason, details: {
        source: candidate.source, websiteStatus: verification.status, emailSource: verifiedEmail ? candidate.emailSource : null, emailMxVerified: verifiedEmail,
      } } },
      history: { create: { event: "LEAD_GENERATED", details: {
        source: candidate.source, websiteStatus: verification.status, emailSource: verifiedEmail ? candidate.emailSource : null, emailMxVerified: verifiedEmail,
      } } },
    } });
    await tx.sourceRecord.upsert({
      where: { source_sourceRecordId: { source: candidate.source ?? "OPENSTREETMAP", sourceRecordId: candidate.externalPlaceId } },
      create: {
        source: candidate.source ?? "OPENSTREETMAP",
        sourceRecordId: candidate.externalPlaceId,
        sourceUrl: candidate.sourceUrl ?? candidate.googleMapsUrl,
        fetchedAt: candidate.fetchedAt ? new Date(candidate.fetchedAt) : new Date(),
        rawName: candidate.companyName,
        rawAddress: candidate.streetAddress,
        rawPhone: candidate.internationalPhoneNumber || candidate.phoneNumber,
        rawEmail: candidate.email,
        rawEmailSource: candidate.emailSource,
        rawWebsite: candidate.website,
        rawBusinessStatus: candidate.businessStatus,
        decision: "stored",
        reasonCode: verification.status.toLowerCase(),
        processedAt: new Date(),
        leadId: lead.id,
        payload: JSON.parse(JSON.stringify(candidate)) as Prisma.InputJsonValue,
      },
      update: {
        leadId: lead.id, decision: "stored", reasonCode: verification.status.toLowerCase(), processedAt: new Date(),
        rawEmail: candidate.email, rawEmailSource: candidate.emailSource,
      },
    });
    await tx.validationCandidate.updateMany({
      where: { source: candidate.source ?? "OPENSTREETMAP", sourceRecordId: candidate.externalPlaceId },
      data: {
        status: "PROMOTED_TO_LEAD",
        promotedLeadId: lead.id,
        failureReason: "Kandidaat transactioneel gepromoveerd naar pipelinefase Nieuw.",
        websiteStatus: verification.status,
        websiteConfidence: verification.confidence,
        verificationEvidence: JSON.parse(JSON.stringify(verification.evidence)) as Prisma.InputJsonValue,
        validatedAt: new Date(),
        rejectedAt: null,
      },
    });
    await tx.searchCombination.updateMany({
      where: {
        country: candidate.country.toUpperCase(), city: candidate.city,
        category: candidate.category, source: candidate.source ?? "OPENSTREETMAP",
      },
      data: { validLeads: { increment: 1 } },
    });
    const candidateFingerprints = fingerprintValues(candidateDedupeKeys(candidate));
    await tx.duplicateFingerprint.createMany({
      data: candidateFingerprints.map((item) => ({ ...item, leadId: lead.id })),
      skipDuplicates: true,
    });
    const conflictingIdentity = await tx.duplicateFingerprint.findFirst({
      where: { fingerprint: { in: identityFingerprints.map(({ fingerprint }) => fingerprint) }, NOT: { leadId: lead.id } },
      select: { fingerprint: true, leadId: true },
    });
    if (conflictingIdentity?.leadId) throw new DuplicateIdentityError(conflictingIdentity.fingerprint, conflictingIdentity.leadId);
    const storedLead = await tx.lead.findUnique({
      where: { id: lead.id },
      select: {
        id: true,
        pipelineStageId: true,
        isActive: true,
        phoneNumber: true,
        email: true,
      },
    });
    if (
      !storedLead
      || storedLead.pipelineStageId !== NEW_PIPELINE_STAGE_ID
      || !storedLead.isActive
      || !storedLead.phoneNumber
      || !storedLead.email
    ) {
      throw new Error("LEAD_DATABASE_READBACK_FAILED");
    }
    return { stored: true, reviewOnly: false, reason: verification.reason, leadId: lead.id };
}

export async function saveValidatedLead(candidate: Candidate, verification: WebsiteVerificationResult, batchId?: string) {
  return prisma.$transaction(
    (tx) => insertValidatedLead(tx, candidate, verification, batchId),
    { maxWait: 5_000, timeout: 20_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export const storeNewLead = saveValidatedLead;

type QualifiedDraftPayload = {
  candidate: Candidate;
  verification: WebsiteVerificationResult;
};

export async function stageQualifiedLead(runId: string, candidate: Candidate, verification: WebsiteVerificationResult) {
  const strict = validateStrictLead(candidate, verification);
  if (!strict.valid) return { staged: false, reviewOnly: false, reason: strict.reasons[0] };
  const gate = evaluateNewLeadGate(candidate, verification);
  if (!gate.allowed) return { staged: false, reviewOnly: gate.reason === "SKIPPED_WEBSITE_UNKNOWN", reason: gate.reason };
  const basic = validateCandidateBasics(candidate);
  if (!basic.ok) return { staged: false, reviewOnly: false, reason: basic.reason };
  const identityFingerprints = strongIdentityFingerprintValues(candidateDedupeKeys(candidate));
  const fingerprint = identityFingerprints.find(({ kind }) => kind === "phone")?.fingerprint
    ?? identityFingerprints.find(({ kind }) => kind === "google_place_id")?.fingerprint
    ?? identityFingerprints[0]?.fingerprint
    ?? fingerprintValues(candidateDedupeKeys(candidate))[0]?.fingerprint;
  if (!fingerprint) return { staged: false, reviewOnly: false, reason: "MISSING_IDENTITY_FINGERPRINT" };
  try {
    await prisma.qualifiedLeadDraft.create({
      data: {
        runId,
        fingerprint,
        payload: JSON.parse(JSON.stringify({ candidate, verification } satisfies QualifiedDraftPayload)) as Prisma.InputJsonValue,
      },
    });
    return { staged: true, reviewOnly: false, reason: verification.reason };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { staged: false, reviewOnly: false, reason: "DUPLICATE_QUALIFIED_DRAFT" };
    }
    throw error;
  }
}

function draftPayload(value: Prisma.JsonValue): QualifiedDraftPayload {
  const payload = value as unknown as QualifiedDraftPayload;
  if (!payload?.candidate?.externalPlaceId || !payload.verification?.status) throw new Error("INVALID_QUALIFIED_DRAFT");
  return payload;
}

export async function finalizeQualifiedBatch(runId: string) {
  const env = serverEnv();
  const run = await prisma.generationRun.findUniqueOrThrow({ where: { id: runId }, select: { targetCount: true } });
  const drafts = await prisma.qualifiedLeadDraft.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" },
    take: run.targetCount + 1,
  });
  if (qualifiedBatchState(drafts.length, run.targetCount) !== "READY") return 0;

  const staleBefore = Date.now() - env.QUALIFIED_DRAFT_MAX_AGE_HOURS * 60 * 60_000;
  const invalidDraftIds: string[] = [];
  const validated: QualifiedDraftPayload[] = [];
  const batchIdentityFingerprints = new Set<string>();
  for (const draft of drafts) {
    const payload = draftPayload(draft.payload);
    if (draft.createdAt.getTime() < staleBefore) {
      invalidDraftIds.push(draft.id);
      await queueValidationRetry({ runId, candidate: payload.candidate, verification: payload.verification, reason: "QUALIFIED_DRAFT_EXPIRED" });
      continue;
    }
    const email = await validatePublicBusinessEmail(payload.candidate);
    if (email.status !== "VALID") {
      invalidDraftIds.push(draft.id);
      if (email.status === "MISSING" || email.status === "RETRY") {
        await queueValidationRetry({ runId, candidate: payload.candidate, verification: payload.verification, reason: email.reason });
      } else {
        await markValidationRejected(payload.candidate, email.reason, payload.verification);
      }
      continue;
    }
    const candidate = {
      ...payload.candidate,
      email: email.email,
      emailAddresses: [email.email],
      emailSource: email.source,
      emailSourceUrl: email.sourceUrl,
      emailPubliclyListed: true,
      emailMxVerified: true,
      emailVerifiedAt: email.checkedAt,
    };
    const identities = strongIdentityFingerprintValues(candidateDedupeKeys(candidate)).map(({ fingerprint }) => fingerprint);
    const duplicateInBatch = identities.some((fingerprint) => batchIdentityFingerprints.has(fingerprint));
    const duplicateInDatabase = duplicateInBatch ? null : await prisma.duplicateFingerprint.findFirst({
      where: { fingerprint: { in: identities }, leadId: { not: null } },
      select: { leadId: true },
    });
    if (duplicateInBatch || duplicateInDatabase?.leadId) {
      invalidDraftIds.push(draft.id);
      await markValidationRejected(candidate, duplicateInBatch ? "duplicate_qualified_batch" : "duplicate_existing_lead", payload.verification);
      continue;
    }
    if (!validateStrictLead(candidate, payload.verification).valid || !evaluateNewLeadGate(candidate, payload.verification).allowed) {
      invalidDraftIds.push(draft.id);
      continue;
    }
    identities.forEach((fingerprint) => batchIdentityFingerprints.add(fingerprint));
    validated.push({ candidate, verification: payload.verification });
  }
  if (invalidDraftIds.length) {
    await prisma.qualifiedLeadDraft.deleteMany({ where: { id: { in: invalidDraftIds } } });
    return 0;
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.lead.count({ where: { batchId: runId } });
    if (existing === run.targetCount) return existing;
    if (existing !== 0) throw new Error(`ATOMIC_BATCH_INVARIANT: ${existing}/${run.targetCount} definitieve leads.`);
    const currentDrafts = await tx.qualifiedLeadDraft.findMany({ where: { runId }, orderBy: { createdAt: "asc" }, take: run.targetCount + 1 });
    if (currentDrafts.length !== run.targetCount) throw new Error(`ATOMIC_BATCH_INCOMPLETE: ${currentDrafts.length}/${run.targetCount} concepten.`);
    for (const payload of validated) {
      const inserted = await insertValidatedLead(tx, payload.candidate, payload.verification, runId);
      if (!inserted.stored) throw new Error(`ATOMIC_BATCH_REVALIDATION_FAILED: ${inserted.reason}`);
    }
    await tx.qualifiedLeadDraft.deleteMany({ where: { runId } });
    return run.targetCount;
  }, { maxWait: 10_000, timeout: 120_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function rejectionCode(reason: string) {
  return ({
    niet_operationeel: "BUSINESS_CLOSED",
    keten_of_uitgesloten: "EXCLUDED_CATEGORY",
    onbetrouwbare_status: "BUSINESS_NOT_CONFIRMED_ACTIVE",
  } as Record<string, string>)[reason] ?? (reason || "INVALID_BUSINESS");
}

function strictReasonMessage(reason: StrictLeadReason) {
  return ({
    BLOCKED_BRUSSELS: "Bedrijf ligt in Brussel of het Brussels Hoofdstedelijk Gewest",
    BLOCKED_GHENT: "Bedrijf ligt in Gent of een Gentse deelgemeente",
    PHONE_REQUIRED: "Geen geldig openbaar telefoonnummer",
    EMAIL_REQUIRED: "Geen geldig openbaar zakelijk e-mailadres",
    NO_PUBLIC_BUSINESS_PROFILE: "Geen aantoonbare openbare bedrijfsvermelding",
    REGION_NOT_ALLOWED: "Buiten Nederland en België",
    LANGUAGE_NOT_DUTCH: "Niet aantoonbaar Nederlandstalig",
    BUSINESS_NOT_CONFIRMED_ACTIVE: "Status onbekend of niet positief actief bevestigd",
    BUSINESS_CLOSED: "Bedrijf is gesloten",
    ADDRESS_NOT_USABLE: "Geen volledig normaal adres beschikbaar",
    WEBSITE_NOT_QUALIFIED: "Website is niet aantoonbaar afwezig, verouderd, kapot of duidelijk verbeterbaar",
    OWN_WEBSITE_FOUND: "Heeft een eigen website",
    SINGLE_LOCATION_NOT_CONFIRMED: "Aantal fysieke vestigingen is niet als precies één bevestigd",
  } satisfies Record<StrictLeadReason, string>)[reason];
}

async function nextSearchArea(attemptedSegments: ReadonlySet<string>) {
  const now = new Date();
  const usedCityKeys = new Set([...attemptedSegments].map((segment) => segment.split(":").slice(0, 2).join(":")));
  const activeCategories = await prisma.category.findMany({
    where: { isActive: true },
    select: { name: true, priority: true },
    orderBy: [{ priority: "asc" }, { name: "asc" }],
  });
  if (!activeCategories.length) return { selected: null, totalStrategies: 0, attemptedStrategies: 0, remainingSegments: 0 };
  const coverageWhere = {
    status: { not: "PAUSED" as const },
    category: { in: activeCategories.map(({ name }) => name) },
    country: { in: ["NL", "BE"] },
  };
  // Cooldowns prioritize polite source use but are not durable exhaustion.
  // Load the complete active NL search space so a later run can continue with
  // another page/tag/element strategy even when every area was recently used.
  const candidates = await prisma.coverageArea.findMany({
    where: coverageWhere,
    orderBy: [{ priority: "asc" }, { lastScannedAt: { sort: "asc", nulls: "first" } }, { city: "asc" }, { category: "asc" }],
  });
  const blockedAreaIds = candidates.filter((area) => detectBlockedLocation(area as typeof area & Record<string, unknown>).blocked).map(({ id }) => id);
  if (blockedAreaIds.length) await prisma.coverageArea.updateMany({
    where: { id: { in: blockedAreaIds } },
    data: { status: "PAUSED", errorMessage: "Uitgesloten door harde locatieblokkade: Brussel/Gent" },
  });
  const areas = candidates.filter(({ id }) => !blockedAreaIds.includes(id));
  const space = searchSpaceProgress(areas, attemptedSegments, OSM_SEARCH_CURSOR_COUNT);
  if (!areas.length) return { selected: null, totalStrategies: 0, attemptedStrategies: 0, remainingSegments: 0 };
  const combinations = await prisma.searchCombination.findMany({
    where: { OR: areas.map((candidate) => ({ country: candidate.country, city: candidate.city, category: candidate.category, source: "OPENSTREETMAP" })) },
    select: {
      id: true, tileCursor: true,
      country: true, city: true, category: true, useCount: true, candidatesFound: true,
      validLeads: true, errorCount: true, lastUsedAt: true, nextEligibleAt: true,
    },
  });
  const combinationByArea = new Map(combinations.map((item) => [`${item.country}:${item.city}:${item.category}`, item]));
  const availableAreas = areas.filter((area) => nextUnattemptedCursor({
    area,
    currentCursor: combinationByArea.get(`${area.country}:${area.city}:${area.category}`)?.tileCursor
      ?? initialOverpassSearchCursor(area.country, area.city, area.category),
    cursorCount: OSM_SEARCH_CURSOR_COUNT,
    attemptedSegments,
    cursorLabel: (cursor) => overpassSearchPlan(cursor).id,
  }) !== null);
  if (!availableAreas.length) return {
    selected: null,
    totalStrategies: space.total,
    attemptedStrategies: space.attempted,
    remainingSegments: space.remaining,
  };
  const sequence = combinations.reduce((sum, item) => sum + item.useCount, 0);
  const unusedCities = preferUnusedCities(availableAreas, usedCityKeys);
  const select = (candidateAreas: typeof areas, ignoreCooldowns = false) => selectAdaptiveSearchArea({
    areas: candidateAreas, categories: activeCategories, combinations, sequence, now, ignoreCooldowns,
  });
  const area = select(unusedCities)
    ?? (unusedCities.length === availableAreas.length ? null : select(availableAreas))
    ?? select(unusedCities, true)
    ?? (unusedCities.length === availableAreas.length ? null : select(availableAreas, true));
  if (!area) throw new Error("Er resteert zoekruimte, maar er kon geen zoeksegment worden geselecteerd.");
  const combination = await prisma.searchCombination.upsert({
    where: { country_city_category_source: { country: area.country, city: area.city, category: area.category, source: "OPENSTREETMAP" } },
    create: {
      country: area.country, city: area.city, category: area.category, source: "OPENSTREETMAP",
      region: area.region, searchTerm: area.category, provider: "OPENSTREETMAP", nextEligibleAt: now,
      tileCursor: initialOverpassSearchCursor(area.country, area.city, area.category),
    },
    update: { region: area.region, searchTerm: area.category },
  });
  const tileCursor = nextUnattemptedCursor({
    area,
    currentCursor: combination.tileCursor,
    cursorCount: OSM_SEARCH_CURSOR_COUNT,
    attemptedSegments,
    cursorLabel: (cursor) => overpassSearchPlan(cursor).id,
  });
  if (tileCursor === null) return {
    selected: null,
    totalStrategies: space.total,
    attemptedStrategies: space.total,
    remainingSegments: 0,
  };
  return {
    selected: { area, combination, tileCursor },
    totalStrategies: space.total,
    attemptedStrategies: space.attempted,
    remainingSegments: Math.max(0, space.remaining - 1),
  };
}

async function terminalRun(runId: string, status: JobStatus, stats: Stats, places: string[], errors: string[], warnings: string[], reason: string, exhausted = false) {
  const current = await prisma.generationRun.findUniqueOrThrow({ where: { id: runId }, select: { targetCount: true, maxCandidates: true, candidatesReserved: true, sourceRequests: true, sourceSuccesses: true, startedAt: true, createdAt: true } });
  const summary = `Resultaten: bronverzoeken ${current.sourceRequests}; succesvol ${current.sourceSuccesses}; mislukt ${Math.max(0, current.sourceRequests - current.sourceSuccesses)}; ruw gevonden ${stats.found}; uniek gereserveerd ${current.candidatesReserved}/${current.maxCandidates}; gecontroleerd ${stats.checked}; verkeerde locatie ${stats.wrongLocationRejected}; onvoldoende gegevens ${stats.insufficientDataRejected}; geldig vóór opslag ${stats.validCandidates}; databasepogingen ${stats.databaseInsertAttempts}; databasefouten ${stats.databaseInsertFailures}; met website ${stats.websitesFound}; gesloten ${stats.permanentlyClosed + stats.temporarilyClosed}; zonder geldig telefoonnummer ${stats.invalidPhone}; meerdere vestigingen ${stats.multipleLocationsRejected}; ketens/franchises ${stats.chainRejected + stats.franchiseRejected}; duplicaten ${stats.duplicates}; onzeker ${stats.manualReview}; opgeslagen ${stats.stored}/${current.targetCount}.`;
  const finalReason = status === JobStatus.CANCELLED ? reason : `${reason} ${summary}`;
  const durationMs = Date.now() - (current.startedAt ?? current.createdAt).getTime();
  const event = { jobId: runId, step: "job_completed", status, durationMs, ...stats, sources: ["OPENSTREETMAP"], searchAreas: places };
  console.info(JSON.stringify(event));
  await logSource(runId, "GENERATION", status === JobStatus.FAILED ? "ERROR" : "INFO", JSON.stringify(event)).catch((error) => {
    console.warn(JSON.stringify({ jobId: runId, step: "job_end_log_failed", message: errorMessage(error) }));
  });
  return prisma.generationRun.update({
    where: { id: runId },
    data: {
      ...runData(stats, places, errors, warnings),
      status,
      progress: 100,
      exhausted,
      currentPhase: status === JobStatus.CANCELLED ? "Geannuleerd" : status === JobStatus.TIMED_OUT ? "Tijdslimiet bereikt" : status === JobStatus.FAILED ? "Mislukt" : status === JobStatus.PARTIALLY_COMPLETED ? "Gedeeltelijk afgerond" : "Voltooid",
      message: finalReason,
      stopReason: finalReason,
      totalDurationMs: durationMs,
      finishedAt: new Date(),
    },
  });
}

function candidateFromQueue(row: GenerationCandidate): Candidate {
  const candidate = row.payload as unknown as Candidate;
  if (!candidate || candidate.externalPlaceId !== row.sourceRecordId) throw new Error("Ongeldige kandidaatpayload in de persistente queue.");
  return candidate;
}

async function finishQueueItem(id: string, status: CandidateQueueStatus, lastError?: string) {
  await prisma.generationCandidate.update({
    where: { id },
    data: {
      status,
      lastError: lastError?.slice(0, 300) ?? null,
      claimedAt: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      nextEligibleAt: status === CandidateQueueStatus.PENDING ? new Date(Date.now() + 15 * 60_000) : new Date(),
      processedAt: status === CandidateQueueStatus.PROCESSED || status === CandidateQueueStatus.FAILED ? new Date() : null,
    },
  });
}

async function releaseQueueItems(ids: string[], reason: string) {
  if (!ids.length) return;
  await prisma.generationCandidate.updateMany({ where: { id: { in: ids }, status: CandidateQueueStatus.PROCESSING }, data: { status: CandidateQueueStatus.PENDING, claimedAt: null, leaseOwner: null, leaseExpiresAt: null, lastError: reason } });
}

async function pendingQueueItems(runId: string, take: number) {
  if (take <= 0) return [];
  return prisma.generationCandidate.findMany({
    where: { runId, status: CandidateQueueStatus.PENDING, nextEligibleAt: { lte: new Date() } },
    orderBy: [{ qualityScore: "desc" }, { createdAt: "asc" }],
    take,
  });
}

export async function processGenerationBatch(runId: string) {
  const env = serverEnv();
  await markStaleGenerationRuns();
  let run = await prisma.generationRun.findUniqueOrThrow({ where: { id: runId } });
  if (terminalStatuses.has(run.status)) return run;
  const batchStartedAt = Date.now();
  let deadline = batchStartedAt + env.GENERATION_BATCH_DURATION_SECONDS * 1000;
  const lock = await acquireJobLock(`lead-generation:${runId}`, (env.GENERATION_BATCH_DURATION_SECONDS + 10) * 1000);
  if (!lock) return run;

  if (run.maxCandidates > MAX_CANDIDATES_PER_RUN) {
    run = await prisma.generationRun.update({ where: { id: runId }, data: { maxCandidates: MAX_CANDIDATES_PER_RUN } });
  }
  const stats = statsFromRun(run);
  const errors = stringArray(run.apiErrors);
  const warnings = stringArray(run.warnings);
  const places = stringArray(run.placesUsed);
  const dedupe = new RunDeduplicator();
  let retriedThisBatch = 0;
  let validationDurationMs = 0;
  let databaseDurationMs = 0;
  let batchMessage: string | null = null;
  let consecutiveSourceFailures = run.consecutiveSourceFailures;

  try {
    const [draftCount, finalizedCount] = await Promise.all([
      prisma.qualifiedLeadDraft.count({ where: { runId } }),
      prisma.lead.count({ where: { batchId: runId } }),
    ]);
    stats.stored = Math.max(stats.stored, draftCount, finalizedCount);
    run = await prisma.generationRun.update({
      where: { id: runId },
      data: {
        status: JobStatus.RUNNING,
        startedAt: run.startedAt ?? new Date(),
        batchNumber: { increment: 1 },
        currentPhase: "Zoekopdracht valideren",
        progress: Math.max(run.progress, phaseProgress("validate")),
        message: "De volgende begrensde batch wordt vanaf de opgeslagen cursor voorbereid.",
        heartbeatAt: new Date(),
      },
    });
    if (finalizedCount === run.targetCount) {
      return terminalRun(runId, JobStatus.COMPLETE, stats, places, errors, warnings, `Doelbatch hersteld: exact ${finalizedCount} volledig gekwalificeerde leads zijn atomair opgeslagen.`);
    }
    if (finalizedCount !== 0) throw new Error(`ATOMIC_BATCH_INVARIANT: ${finalizedCount}/${run.targetCount} definitieve leads.`);
    if (draftCount >= run.targetCount) {
      const finalized = await finalizeQualifiedBatch(runId);
      if (finalized === run.targetCount) {
        return terminalRun(runId, JobStatus.COMPLETE, stats, places, errors, warnings, `Doelbatch hersteld: exact ${finalized} volledig gekwalificeerde leads zijn na hercontrole atomair opgeslagen.`);
      }
      stats.stored = await prisma.qualifiedLeadDraft.count({ where: { runId } });
    }
    const runDeadline = (run.startedAt ?? new Date()).getTime() + env.GENERATION_MAX_RUN_MINUTES * 60_000;
    deadline = Math.min(deadline, runDeadline - 30_000);
    if (run.cancelRequested) return terminalRun(runId, JobStatus.CANCELLED, stats, places, errors, warnings, "De zoekrun is geannuleerd.");
    if (isGenerationRunExpired(run.startedAt, env.GENERATION_MAX_RUN_MINUTES)) {
      const pendingCandidates = await prisma.generationCandidate.count({ where: { runId, status: CandidateQueueStatus.PENDING } });
      return terminalRun(
        runId,
        JobStatus.TIMED_OUT,
        stats,
        places,
        errors,
        warnings,
        timeLimitReason(stats, pendingCandidates, env.GENERATION_MAX_RUN_MINUTES, consecutiveSourceFailures),
      );
    }

    const queueTake = () => Math.min(
      env.GENERATION_BATCH_CANDIDATES,
      MAX_CANDIDATES_PER_BATCH,
      Math.max(0, run.maxCandidates - stats.checked),
    );
    let queued = await pendingQueueItems(runId, queueTake());

    let retryQuotaRemaining = generationRetryImportLimit(env.GENERATION_BATCH_CANDIDATES, run.retriedCandidates, Math.min(2, Math.max(0, run.maxCandidates - run.candidatesReserved)));

    if (!queued.length && retryQuotaRemaining > 0) {
      const carriedCandidates = await importInterruptedGenerationCandidates(runId, retryQuotaRemaining);
      if (carriedCandidates) {
        stats.found += carriedCandidates;
        retriedThisBatch += carriedCandidates;
        run.candidatesReserved += carriedCandidates;
        await prisma.generationRun.update({ where: { id: runId }, data: { candidatesReserved: { increment: carriedCandidates } } });
        queued = await pendingQueueItems(runId, queueTake());
        batchMessage = `${carriedCandidates} nog niet gecontroleerde kandidaten uit een onderbroken run zijn veilig hervat.`;
        retryQuotaRemaining -= carriedCandidates;
      }
    }

    if (!queued.length && retryQuotaRemaining > 0) {
      const importedRetries = await importDueValidationRetries(runId, retryQuotaRemaining);
      if (importedRetries) {
        retriedThisBatch += importedRetries;
        run.candidatesReserved += importedRetries;
        await prisma.generationRun.update({ where: { id: runId }, data: { candidatesReserved: { increment: importedRetries } } });
        queued = await pendingQueueItems(runId, queueTake());
        batchMessage = `${importedRetries} onzekere kandidaten zijn uit de duurzame retryqueue opnieuw ingepland.`;
      }
    }

    if (!queued.length) {
      const pendingCandidates = await prisma.generationCandidate.count({ where: { runId, status: CandidateQueueStatus.PENDING } });
      if (stats.checked >= run.maxCandidates) {
        const status = pendingCandidates > 0 || stats.stored > 0 ? JobStatus.PARTIALLY_COMPLETED : JobStatus.COMPLETE;
        return terminalRun(runId, status, stats, places, errors, warnings, candidateBudgetReason(stats, pendingCandidates, run.maxCandidates));
      }
      if (run.candidatesReserved >= run.maxCandidates) {
        const status = pendingCandidates > 0 || stats.stored > 0 ? JobStatus.PARTIALLY_COMPLETED : JobStatus.COMPLETE;
        return terminalRun(runId, status, stats, places, errors, warnings, candidateBudgetReason(stats, pendingCandidates, run.maxCandidates));
      }
      if (shouldStopForSourceOutage(consecutiveSourceFailures, env.GENERATION_MAX_SOURCE_FAILURES)) {
        const status = capacity(stats) ? JobStatus.PARTIALLY_COMPLETED : JobStatus.FAILED;
        return terminalRun(runId, status, stats, places, errors, warnings, `De gratis bedrijfsbronnen zijn na ${consecutiveSourceFailures} opeenvolgende mislukte zoekbatches tijdelijk niet betrouwbaar bereikbaar. ${stats.checked} kandidaten zijn gecontroleerd en ${stats.stored} gekwalificeerde concepten zijn veilig bewaard; bestaande gegevens en retrykandidaten zijn behouden.`);
      }
      if (run.processedSegments + stats.sourceFailures >= env.GENERATION_MAX_SOURCE_CALLS) {
        const status = capacity(stats) ? JobStatus.PARTIALLY_COMPLETED : JobStatus.COMPLETE;
        return terminalRun(runId, status, stats, places, errors, warnings, `${run.processedSegments + stats.sourceFailures} begrensde zoekbatches zijn uitgevoerd. ${stats.checked} kandidaten zijn gecontroleerd en ${stats.stored} gekwalificeerde concepten zijn veilig bewaard; er worden in deze run geen nieuwe bronverzoeken gestart.`);
      }
      if (Date.now() >= runDeadline - RUN_DRAIN_WINDOW_MS) {
        return terminalRun(runId, JobStatus.TIMED_OUT, stats, places, errors, warnings, timeLimitReason(stats, pendingCandidates, env.GENERATION_MAX_RUN_MINUTES, consecutiveSourceFailures));
      }
      const adapters = enabledSourceAdapters();
      if (!adapters.length) throw new Error("Er is geen gratis databron ingeschakeld.");
      const searchPlan = await nextSearchArea(new Set(places));
      if (!searchPlan.selected) {
        const reason = searchPlan.totalStrategies === 0
          ? "Er zijn geen actieve Nederlandse openbare zoekgebieden en branches geconfigureerd; er zijn geen bronverzoeken uitgevoerd."
          : stats.sourceFailures > 0
            ? `Er zijn in deze run geen onbeproefde zoekstrategieën meer, maar ${stats.sourceFailures} mislukte bronbatches zijn niet als succesvol verwerkt gemarkeerd en blijven beschikbaar voor een vervolgrun.`
            : `${exhaustedSearchAreasReason({ candidatesChecked: stats.checked, stored: stats.stored, rejected: stats.rejected, manualReview: stats.manualReview })} ${searchPlan.attemptedStrategies}/${searchPlan.totalStrategies} unieke zoekstrategieën zijn in deze run succesvol uitgevoerd.`;
        return terminalRun(
          runId,
          stats.stored ? JobStatus.PARTIALLY_COMPLETED : JobStatus.FAILED,
          stats,
          places,
          errors,
          warnings,
          reason,
          stats.sourceFailures === 0,
        );
      }
      const { area, combination, tileCursor } = searchPlan.selected;
      const { remainingSegments } = searchPlan;
      const adapter = adapters[0];
      const region = `${area.city}, ${area.country}`;
      const tileLabel = overpassSearchPlan(tileCursor).id;
      const segment = searchStrategySegment(area, tileCursor, (cursor) => overpassSearchPlan(cursor).id);
      // Record the attempt before the external request. Failed public-source
      // calls must also rotate the run to another city instead of repeatedly
      // consuming the time budget on the same temporarily unhealthy area.
      if (!places.includes(segment)) places.push(segment);
      const sourceStartedAt = Date.now();

      run.progress = Math.max(run.progress, phaseProgress("source"));
      await prisma.generationRun.update({ where: { id: runId }, data: {
        currentPhase: "Openbare bedrijfsvermeldingen ophalen", currentSource: adapter.id, currentRegion: region,
        currentCategory: area.category, currentTile: tileLabel, continuationCursor: segment,
        remainingSegments, placesUsed: places,
        progress: run.progress,
        message: `Nieuwe zoekstrategie ${searchPlan.attemptedStrategies + 1}/${searchPlan.totalStrategies} voor deze run: ${tileLabel}, ${area.category} in ${region}.`, heartbeatAt: new Date(),
      } });
      await logSource(runId, adapter.id, "INFO", JSON.stringify({
        jobId: runId,
        step: "search_segment_reserved",
        segment,
        attemptedStrategies: searchPlan.attemptedStrategies + 1,
        totalStrategies: searchPlan.totalStrategies,
        remainingSegments,
      }), area.city, area.category);

      try {
        const result = await adapter.searchBusinesses({
          country: area.country, city: area.city, latitude: Number(area.latitude), longitude: Number(area.longitude),
          radius: area.radius, category: area.category, tileCursor,
          onEvent: (event) => logOverpassEvent(runId, area.city, area.category, event),
        });
        const attemptDelta = sourceAttemptDelta(true);
        const sourceDurationMs = Date.now() - sourceStartedAt;
        warnings.push(...result.warnings);
        const normalizedCandidates = result.candidates.map((candidate) => ({
          ...candidate,
          province: candidate.province || area.region,
          municipality: candidate.municipality || area.municipality || undefined,
          regionLanguage: candidate.regionLanguage || (area.country === "BE" ? "Vlaanderen" : "Nederland"),
        }));
        const blockedCandidates = normalizedCandidates.filter((candidate) => detectBlockedLocation(candidate as Candidate & Record<string, unknown>).blocked);
        const allowedCandidates = normalizedCandidates.filter((candidate) => !detectBlockedLocation(candidate as Candidate & Record<string, unknown>).blocked);
        stats.blockedBrussels += blockedCandidates.filter((candidate) => detectBlockedLocation(candidate as Candidate & Record<string, unknown>).area === "BRUSSELS").length;
        stats.blockedGhent += blockedCandidates.filter((candidate) => detectBlockedLocation(candidate as Candidate & Record<string, unknown>).area === "GHENT").length;
        stats.rejected += blockedCandidates.length;
        await recordBlockedCandidates(runId, blockedCandidates);
        const bufferedCandidates = allowedCandidates
          .sort((left, right) => candidateQualityScore(right) - candidateQualityScore(left))
          .slice(0, env.LEAD_CANDIDATE_BUFFER);
        const knownAtSource = bufferedCandidates.length ? await knownCandidateReasons(bufferedCandidates) : new Map<string, KnownCandidateMatch | null>();
        const novelCandidatesBeforeCap = bufferedCandidates.filter((candidate) => {
          const known = knownAtSource.get(candidate.externalPlaceId);
          if (!known) return true;
          if (known.disposition === "rejected") stats.rejected += 1;
          else { stats.duplicates += 1; stats.existing += 1; }
          return false;
        });
        stats.cacheHits += bufferedCandidates.length - novelCandidatesBeforeCap.length;
        stats.cheapRejected += bufferedCandidates.length - novelCandidatesBeforeCap.length;
        const novelCandidates = novelCandidatesBeforeCap.slice(0, candidateReservationLimit(run.maxCandidates, run.candidatesReserved, novelCandidatesBeforeCap.length));
        const queuedResult = await prisma.$transaction(async (tx) => {
          const inserted = await tx.generationCandidate.createMany({
            data: novelCandidates.map((candidate) => ({
              runId, source: candidate.source ?? adapter.id, sourceRecordId: candidate.externalPlaceId, segment,
              payload: JSON.parse(JSON.stringify(candidate)) as Prisma.InputJsonValue,
              qualityScore: candidateQualityScore(candidate),
            })),
            skipDuplicates: true,
          });
          const nextEligibleAt = new Date(Date.now() + lowYieldCooldownMs(combination.useCount + 1, combination.validLeads));
          await tx.coverageArea.update({ where: { id: area.id }, data: {
            lastScannedAt: new Date(), nextScanAt: nextEligibleAt, resultsFound: { increment: result.candidates.length }, errorMessage: null,
          } });
          await tx.searchCombination.update({ where: { id: combination.id }, data: {
            useCount: { increment: 1 }, candidatesFound: { increment: result.candidates.length }, lastUsedAt: new Date(),
            region: area.region, searchTerm: area.category, provider: result.sourceUrl ?? adapter.id,
            totalDurationMs: { increment: BigInt(sourceDurationMs) },
            averageDurationMs: Math.round((Number(combination.totalDurationMs) + sourceDurationMs) / (combination.useCount + 1)),
            tileCursor: nextOverpassTileCursor(tileCursor),
            lastTile: result.tile, lastError: null, nextEligibleAt,
          } });
          await tx.generationRun.update({ where: { id: runId }, data: {
            processedSegments: { increment: attemptDelta.processedSegments },
            candidatesReserved: { increment: inserted.count },
            consecutiveSourceFailures: 0,
            lastError: null,
          } });
          return inserted;
        });
        const queueDuplicates = Math.max(0, novelCandidates.length - queuedResult.count);
        stats.duplicates += queueDuplicates;
        stats.existing += queueDuplicates;
        stats.found += result.candidates.length;
        run.processedSegments += attemptDelta.processedSegments;
        run.candidatesReserved += queuedResult.count;
        consecutiveSourceFailures = nextConsecutiveSourceFailures(consecutiveSourceFailures, true);
        batchMessage = `${result.candidates.length} kandidaten gevonden; ${blockedCandidates.length} uit Brussel/Gent afgewezen, ${queueDuplicates} reeds in deze run aanwezig en ${queuedResult.count} nog onbekende kandidaten duurzaam in de controlequeue gezet.`;
      } catch (error) {
        const message = errorMessage(error);
        const sourceDurationMs = Date.now() - sourceStartedAt;
        const attemptDelta = sourceAttemptDelta(false);
        stats.sourceFailures += attemptDelta.sourceFailures;
        consecutiveSourceFailures = nextConsecutiveSourceFailures(consecutiveSourceFailures, false);
        errors.push(`${adapter.id} / ${region} / ${area.category}: ${message}`);
        batchMessage = `Deze bronbatch mislukte zonder eerdere resultaten te verliezen. De volgende zoekcombinatie wordt geprobeerd.`;
        await Promise.all([
          logSource(runId, adapter.id, "ERROR", JSON.stringify({ jobId: runId, batchNumber: run.batchNumber, step: "source_failed", region, category: area.category, tile: tileLabel, errorCode: "SOURCE_ERROR", message }), area.city, area.category),
          prisma.coverageArea.update({ where: { id: area.id }, data: {
            nextScanAt: new Date(Date.now() + 5 * 60_000), errorMessage: `Tijdelijke bronfout: ${message}`,
          } }),
          prisma.searchCombination.update({ where: { id: combination.id }, data: {
            errorCount: { increment: 1 }, lastUsedAt: new Date(),
            region: area.region, searchTerm: area.category, provider: adapter.id,
            totalDurationMs: { increment: BigInt(sourceDurationMs) },
            averageDurationMs: Math.round((Number(combination.totalDurationMs) + sourceDurationMs) / (combination.useCount + 1)),
            lastTile: tileLabel, lastError: message,
            nextEligibleAt: new Date(Date.now() + 5 * 60_000),
          } }),
          prisma.generationRun.update({ where: { id: runId }, data: {
            consecutiveSourceFailures: { increment: 1 },
            lastError: message,
          } }),
        ]);
        if (sourceFailureWarningDue(consecutiveSourceFailures, env.GENERATION_MAX_SOURCE_FAILURES)) {
          warnings.push(`${consecutiveSourceFailures} openbare bronbatches reageerden achter elkaar niet; de run gaat door met andere plaatsen, branches, tegels en hosts.`);
        }
      }

      queued = await pendingQueueItems(runId, queueTake());
    }

    if (queued.length) {
      await prisma.generationRun.update({ where: { id: runId }, data: {
        currentPhase: "Kandidaten valideren", progress: run.progress,
        message: `${queued.length} kandidaten worden gecontroleerd op status, contactgegevens en duplicaten.`, heartbeatAt: new Date(),
      } });
      await prisma.generationCandidate.updateMany({
        where: { id: { in: queued.map(({ id }) => id) }, status: CandidateQueueStatus.PENDING },
        data: { status: CandidateQueueStatus.PROCESSING, claimedAt: new Date(), leaseOwner: `${runId}:${run.batchNumber}`, leaseExpiresAt: new Date(deadline + 10_000) },
      });
    }

    const priorCandidates = await prisma.generationCandidate.findMany({
      where: { runId, status: { in: [CandidateQueueStatus.PROCESSED, CandidateQueueStatus.FAILED] } },
      select: { payload: true }, take: 1_000,
    });
    for (const prior of priorCandidates) {
      const candidate = prior.payload as unknown as Candidate;
      if (candidate?.externalPlaceId) dedupe.hasOrAdd(candidateDedupeKeys(candidate));
    }

    const verificationWork: Array<{ row: GenerationCandidate; candidate: Candidate }> = [];
    const locationWork: Array<{ row: GenerationCandidate; candidate: Candidate }> = [];
    const releaseIds: string[] = [];
    const knownReasons = queued.length ? await knownCandidateReasons(queued.map(candidateFromQueue)) : new Map<string, KnownCandidateMatch | null>();
    for (const row of queued) {
      if (stats.checked >= run.maxCandidates || isBatchDeadlineNear(deadline) || locationWork.length >= env.GENERATION_BATCH_WEBSITE_CHECKS || capacity(stats) + locationWork.length >= run.targetCount) {
        releaseIds.push(row.id);
        continue;
      }
      await prisma.generationCandidate.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
      let candidate = candidateFromQueue(row);
      if (row.attempts === 0) stats.checked += 1;
      await sourceRecord(candidate);
      if (isPermanentlyClosed(candidate)) {
        stats.permanentlyClosed += 1;
        stats.cheapRejected += 1;
        await markDecision(candidate, "skipped", "SKIPPED_PERMANENTLY_CLOSED");
        await markValidationRejected(candidate, "SKIPPED_PERMANENTLY_CLOSED");
        await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
        continue;
      }
      if (isTemporarilyClosed(candidate)) {
        stats.temporarilyClosed += 1;
        stats.rejected += 1;
        stats.cheapRejected += 1;
        await markDecision(candidate, "rejected", "BUSINESS_CLOSED");
        await markValidationRejected(candidate, "BUSINESS_CLOSED");
        await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
        continue;
      }
      if (!hasReadableAddress(candidate)) {
        candidate = await enrichCandidateAddress(candidate);
        await sourceRecord(candidate);
      }
      // Reject deterministic failures and known identities before spending a
      // remote request on contact enrichment or the nationwide location lookup.
      const preliminary = validateStrictLeadBeforeContactEnrichment(candidate);
      if (!preliminary.valid) {
        if (isStatusVerificationRetry(preliminary.reasons)) {
          if (row.attempts === 0) stats.manualReview += 1;
          retriedThisBatch += 1;
          await markDecision(candidate, "retry", "STATUS_VERIFICATION_REQUIRED", undefined, {
            activeStatus: preliminary.active.status,
            activeConfidence: preliminary.active.confidence,
            retryAttempt: row.attempts + 1,
          });
          await queueValidationRetry({ runId, candidate, reason: "STATUS_VERIFICATION_REQUIRED" });
          await finishQueueItem(
            row.id,
            candidateRetryStatus(row.attempts + 1) === "FAILED" ? CandidateQueueStatus.FAILED : CandidateQueueStatus.PENDING,
            "STATUS_VERIFICATION_REQUIRED",
          );
          continue;
        }
        const reason = preliminary.reasons[0];
        if (preliminary.reasons.includes("BLOCKED_BRUSSELS")) stats.blockedBrussels += 1;
        if (preliminary.reasons.includes("BLOCKED_GHENT")) stats.blockedGhent += 1;
        if (preliminary.reasons.includes("PHONE_REQUIRED")) stats.invalidPhone += 1;
        if (preliminary.reasons.includes("LANGUAGE_NOT_DUTCH")) stats.languageRejected += 1;
        if (preliminary.reasons.includes("REGION_NOT_ALLOWED")) stats.wrongLocationRejected += 1;
        if (preliminary.reasons.some((item) => ["NO_PUBLIC_BUSINESS_PROFILE", "ADDRESS_NOT_USABLE", "BUSINESS_NOT_CONFIRMED_ACTIVE"].includes(item))) {
          stats.insufficientDataRejected += 1;
        }
        stats.rejected += 1;
        stats.cheapRejected += 1;
        const evidence = {
          reasons: preliminary.reasons,
          language: preliminary.language.language,
          languageConfidence: preliminary.language.confidence,
          activeStatus: preliminary.active.status,
          activeConfidence: preliminary.active.confidence,
          blockedArea: preliminary.blocked.area,
          blockedField: preliminary.blocked.matchedField,
        };
        await logSource(runId, candidate.source ?? "OPENSTREETMAP", "INFO", JSON.stringify({
          jobId: runId, step: "strict_quality_rejected", sourceRecordId: candidate.externalPlaceId,
          reasons: preliminary.reasons, message: strictReasonMessage(reason), evidence,
        }), candidate.city, candidate.category);
        await markDecision(candidate, "rejected", reason, undefined, evidence);
        await markValidationRejected(candidate, reason);
        await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
        continue;
      }
      const publicPhones = normalizePhones(
        [candidate.internationalPhoneNumber, candidate.phoneNumber, ...(candidate.phoneNumbers ?? [])],
        candidate.country,
      );
      if (!publicPhones.length) {
        stats.invalidPhone += 1;
        if (row.attempts === 0) stats.manualReview += 1;
        retriedThisBatch += 1;
        await markDecision(candidate, "retry", "PHONE_ENRICHMENT_REQUIRED", undefined, {
          contactRequirement: "Een geldig openbaar telefoonnummer is verplicht voordat de kandidaat een lead kan worden.",
        });
        await queueValidationRetry({ runId, candidate, reason: "PHONE_ENRICHMENT_REQUIRED" });
        await finishQueueItem(
          row.id,
          candidateRetryStatus(row.attempts + 1) === "FAILED" ? CandidateQueueStatus.FAILED : CandidateQueueStatus.PENDING,
          "PHONE_ENRICHMENT_REQUIRED",
        );
        continue;
      }
      const emailValidation = await validatePublicBusinessEmail(candidate);
      if (emailValidation.status === "MISSING" || emailValidation.status === "RETRY") {
        if (emailValidation.status === "MISSING") stats.emailsMissing += 1;
        else stats.emailRetries += 1;
        if (row.attempts === 0) stats.manualReview += 1;
        retriedThisBatch += 1;
        const retryReason = emailValidation.status === "MISSING" ? "BUSINESS_EMAIL_REQUIRED" : emailValidation.reason;
        await markDecision(candidate, "retry", retryReason, undefined, {
          contactRequirement: "Een traceerbaar openbaar zakelijk e-mailadres met een geldig MX-record is verplicht.",
        });
        await queueValidationRetry({ runId, candidate, reason: retryReason });
        await finishQueueItem(
          row.id,
          candidateRetryStatus(row.attempts + 1) === "FAILED" ? CandidateQueueStatus.FAILED : CandidateQueueStatus.PENDING,
          retryReason,
        );
        continue;
      } else if (emailValidation.status === "INVALID") {
        stats.emailsInvalid += 1;
        stats.rejected += 1;
        stats.cheapRejected += 1;
        await markDecision(candidate, "rejected", emailValidation.reason);
        await markValidationRejected(candidate, emailValidation.reason);
        await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED, emailValidation.reason);
        continue;
      } else {
        candidate = {
          ...candidate,
          email: emailValidation.email,
          emailAddresses: [emailValidation.email],
          emailSource: emailValidation.source,
          emailSourceUrl: emailValidation.sourceUrl,
          emailPubliclyListed: true,
          emailMxVerified: true,
          emailVerifiedAt: emailValidation.checkedAt,
        };
        stats.emailsFound += 1;
        stats.emailsExternallyVerified += 1;
        await sourceRecord(candidate);
      }
      const contactComplete = validateStrictLeadBeforeLocation(candidate);
      if (!contactComplete.valid) {
        const reason = contactComplete.reasons[0];
        stats.rejected += 1;
        stats.cheapRejected += 1;
        await markDecision(candidate, "rejected", reason, undefined, { reasons: contactComplete.reasons });
        await markValidationRejected(candidate, reason);
        await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
        continue;
      }
      const basic = validateCandidateBasics(candidate);
      if (!basic.ok) {
        stats.rejected += 1;
        stats.cheapRejected += 1;
        if (basic.reason === "buiten_gebied") stats.wrongLocationRejected += 1;
        if (["onvolledig", "onvolledige_locatie", "verouderde_bron"].includes(basic.reason)) stats.insufficientDataRejected += 1;
        await markDecision(candidate, "rejected", rejectionCode(basic.reason), undefined, { basicReason: basic.reason });
        await markValidationRejected(candidate, rejectionCode(basic.reason));
        await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
        continue;
      }
      const keys = candidateDedupeKeys(candidate);
      const batchMatch = dedupe.matchOrAdd(keys);
      const knownMatch = knownReasons.get(candidate.externalPlaceId);
      if (batchMatch.duplicate || knownMatch) {
        const match = batchMatch.duplicate
          ? { reason: "duplicate_batch_strong_identity", matchedExternalId: batchMatch.matchedExternalId, matchedFields: batchMatch.matchedFields }
          : knownMatch!;
        if (!batchMatch.duplicate && knownMatch?.disposition === "rejected") stats.rejected += 1;
        else { stats.duplicates += 1; stats.existing += 1; }
        stats.cheapRejected += 1;
        if (knownMatch) stats.cacheHits += 1;
        await logDuplicateMatch(runId, candidate, match);
        await markDecision(candidate, knownMatch?.disposition === "rejected" ? "rejected" : "duplicate", match.reason, undefined, {
          matchedFields: match.matchedFields,
          matchedLeadId: "leadId" in match ? match.leadId : undefined,
          matchedCandidateId: "matchedExternalId" in match ? match.matchedExternalId : undefined,
        });
        await markValidationRejected(candidate, match.reason);
        await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
        continue;
      }
      locationWork.push({ row, candidate });
    }

    // Location-count lookups are the slowest pre-website step. Run only the
    // bounded high-score work set concurrently; endpoint-level locks and
    // circuit breakers still protect every public provider independently.
    const locationStarted = Date.now();
    const locationResults = await Promise.allSettled(locationWork.map(({ candidate }) => verifySingleLocationForRun(runId, candidate)));
    validationDurationMs += Date.now() - locationStarted;
    for (let index = 0; index < locationWork.length; index += 1) {
      const { row } = locationWork[index];
      const locationResult = locationResults[index];
      if (locationResult.status === "rejected") {
        const message = errorMessage(locationResult.reason);
        retriedThisBatch += 1;
        await queueValidationRetry({ runId, candidate: locationWork[index].candidate, reason: `LOCATION_CHECK_FAILED: ${message}` });
        await finishQueueItem(row.id, candidateRetryStatus(row.attempts + 1) === "FAILED" ? CandidateQueueStatus.FAILED : CandidateQueueStatus.PENDING, message);
        continue;
      }
      const singleLocation = locationResult.value;
      if (singleLocation.externallyValidated && row.attempts === 0) stats.externallyValidated += 1;
      const candidate = singleLocation.candidate;
      await sourceRecord(candidate);
      if (row.attempts === 0) countSingleLocationDecision(stats, singleLocation.decision);
      if (singleLocation.decision.status === "MULTIPLE") {
        stats.rejected += 1;
        await logSource(runId, candidate.source ?? "OPENSTREETMAP", "INFO", JSON.stringify({
          jobId: runId,
          step: "multiple_locations_rejected",
          sourceRecordId: candidate.externalPlaceId,
          reason: singleLocation.decision.reason,
          evidence: singleLocation.decision.evidence,
        }), candidate.city, candidate.category);
        await excludeSingleLocation(candidate, singleLocation.decision.reason);
        await markDecision(candidate, "rejected", singleLocation.decision.reason, undefined, { locationEvidence: singleLocation.decision.evidence, duplicateExternalIds: singleLocation.decision.duplicateExternalIds });
        await markValidationRejected(candidate, singleLocation.decision.reason);
        await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
        continue;
      }
      if (singleLocation.decision.status === "UNCERTAIN") {
        if (row.attempts === 0) stats.manualReview += 1;
        retriedThisBatch += 1;
        await markDecision(candidate, "retry", "onzeker_aantal_vestigingen", undefined, { locationEvidence: singleLocation.decision.evidence, retryAttempt: row.attempts + 1 });
        await queueValidationRetry({ runId, candidate, reason: `onzeker_aantal_vestigingen: ${singleLocation.decision.evidence.join(" ")}` });
        await finishQueueItem(row.id, candidateRetryStatus(row.attempts + 1) === "FAILED" ? CandidateQueueStatus.FAILED : CandidateQueueStatus.PENDING, "onzeker_aantal_vestigingen");
        continue;
      }
      verificationWork.push({ row, candidate });
    }
    await releaseQueueItems(releaseIds, "Doorgeschoven naar de volgende kleine batch.");

    if (verificationWork.length) {
      stats.websitesChecked += verificationWork.length;
      await prisma.generationRun.update({ where: { id: runId }, data: {
        ...runData(stats, places, errors, warnings), currentPhase: "Websitebewijs controleren",
        progress: run.progress, message: `${verificationWork.length} websitecontroles draaien gelimiteerd en onafhankelijk van elkaar.`, heartbeatAt: new Date(),
      } });
      const validationStarted = Date.now();
      const verificationResults = await Promise.allSettled(verificationWork.map(({ candidate }) => qualifyWebsiteCandidate(candidate)));
      validationDurationMs += Date.now() - validationStarted;

      for (let index = 0; index < verificationWork.length; index += 1) {
        const { row, candidate } = verificationWork[index];
        const result = verificationResults[index];
        if (result.status === "rejected") {
          const message = errorMessage(result.reason);
          retriedThisBatch += 1;
          errors.push(`${candidate.companyName}: WEBSITE_CHECK_FAILED: ${message}`);
          await markDecision(candidate, "retry", "website_check_failed");
          await queueValidationRetry({ runId, candidate, reason: `WEBSITE_CHECK_FAILED: ${message}` });
          await finishQueueItem(row.id, candidateRetryStatus(row.attempts + 1) === "FAILED" ? CandidateQueueStatus.FAILED : CandidateQueueStatus.PENDING, message);
          continue;
        }
        const verification = result.value;
        const gate = evaluateNewLeadGate(candidate, verification);
        if (!gate.allowed) {
          if (gate.reason === "SKIPPED_HAS_WEBSITE") {
            stats.websitesFound += 1; stats.rejected += 1;
            await excludeCandidate(candidate, verification);
            await markDecision(candidate, "skipped", gate.reason);
            await markValidationRejected(candidate, gate.reason, verification);
          } else if (gate.reason === "SKIPPED_PERMANENTLY_CLOSED") {
            stats.permanentlyClosed += 1;
            await markDecision(candidate, "skipped", gate.reason);
            await markValidationRejected(candidate, gate.reason, verification);
          } else if (gate.reason === "SKIPPED_WEBSITE_UNKNOWN") {
            if (row.attempts === 0) stats.manualReview += 1;
            retriedThisBatch += 1;
            await markDecision(candidate, "retry", gate.reason);
            await queueValidationRetry({ runId, candidate, verification, reason: `${gate.reason}: ${gate.detail}` });
            await finishQueueItem(row.id, candidateRetryStatus(row.attempts + 1) === "FAILED" ? CandidateQueueStatus.FAILED : CandidateQueueStatus.PENDING, gate.detail);
            continue;
          } else {
            stats.rejected += 1;
            await markDecision(candidate, "rejected", gate.reason);
            await markValidationRejected(candidate, gate.reason, verification);
          }
          await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
          continue;
        }
        const databaseStarted = Date.now();
        stats.validCandidates += 1;
        stats.databaseInsertAttempts += 1;
        try {
          await prisma.generationRun.update({ where: { id: runId }, data: { currentPhase: "Resultaat veilig opslaan", progress: run.progress, heartbeatAt: new Date() } });
          const saved = await stageQualifiedLead(runId, candidate, verification);
          if (saved.staged) {
            stats.stored += 1;
            if (verification.status === "NO_WEBSITE_CONFIRMED") { stats.withoutWebsite += 1; stats.noWebsite += 1; }
            else if (verification.status === "IMPROVABLE_WEBSITE") stats.improvableWebsite += 1;
            else stats.outdatedWebsite += 1;
            await markDecision(candidate, "qualified_draft", verification.status.toLowerCase(), undefined, { websiteStatus: verification.status, websiteConfidence: verification.confidence, websiteEvidence: verification.evidence });
          } else if (saved.reviewOnly) {
            if (row.attempts === 0) stats.manualReview += 1;
            retriedThisBatch += 1;
            await markDecision(candidate, "retry", saved.reason);
            await queueValidationRetry({ runId, candidate, verification, reason: saved.reason });
            await finishQueueItem(
              row.id,
              candidateRetryStatus(row.attempts + 1) === "FAILED" ? CandidateQueueStatus.FAILED : CandidateQueueStatus.PENDING,
              saved.reason,
            );
            continue;
          } else {
            stats.rejected += 1;
            await markDecision(candidate, "skipped", saved.reason.startsWith("SKIPPED_") ? saved.reason : rejectionCode(saved.reason));
            await markValidationRejected(candidate, saved.reason, verification);
          }
          await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
        } catch (error) {
          stats.databaseInsertFailures += 1;
          if ((error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") || error instanceof DuplicateIdentityError) {
            stats.duplicates += 1; stats.existing += 1;
            await markDecision(candidate, "duplicate", "race_condition_duplicate", undefined, databaseErrorEvidence(error));
            await markValidationRejected(candidate, "race_condition_duplicate", verification);
            await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
          } else {
            const message = errorMessage(error);
            const evidence = databaseErrorEvidence(error);
            retriedThisBatch += 1;
            errors.push(`${candidate.companyName}: DATABASE_ERROR ${JSON.stringify(evidence)}`);
            await logSource(runId, candidate.source ?? "OPENSTREETMAP", "ERROR", JSON.stringify({
              jobId: runId, step: "lead_insert_failed", sourceRecordId: candidate.externalPlaceId, evidence,
            }), candidate.city, candidate.category);
            await markDecision(candidate, "retry", "database_error", undefined, evidence);
            await queueValidationRetry({ runId, candidate, verification, reason: `DATABASE_ERROR: ${message}` });
            await finishQueueItem(row.id, candidateRetryStatus(row.attempts + 1) === "FAILED" ? CandidateQueueStatus.FAILED : CandidateQueueStatus.PENDING, message);
          }
        } finally { databaseDurationMs += Date.now() - databaseStarted; }
      }
    }

    const state = await prisma.generationRun.findUniqueOrThrow({ where: { id: runId }, select: { cancelRequested: true, status: true } });
    if (state.cancelRequested || state.status === JobStatus.CANCELLED) return terminalRun(runId, JobStatus.CANCELLED, stats, places, errors, warnings, "De zoekrun is geannuleerd; alle eerder bewaarde resultaten blijven behouden.");
    const pendingCandidates = await prisma.generationCandidate.count({ where: { runId, status: CandidateQueueStatus.PENDING } });
    if (capacity(stats) >= run.targetCount) {
      const finalized = await finalizeQualifiedBatch(runId);
      if (finalized === run.targetCount) {
        return terminalRun(runId, JobStatus.COMPLETE, stats, places, errors, warnings, `Doelbatch bereikt: exact ${finalized} volledig gekwalificeerde leads atomair opgeslagen; ${stats.manualReview} onzekere kandidaten blijven in de PostgreSQL-retryqueue.`);
      }
      const remainingDrafts = await prisma.qualifiedLeadDraft.count({ where: { runId } });
      stats.stored = remainingDrafts;
      if (remainingDrafts < run.targetCount && stats.checked < run.maxCandidates) {
        return prisma.generationRun.update({ where: { id: runId }, data: {
          ...runData(stats, places, errors, warnings),
          status: JobStatus.RUNNING,
          currentPhase: "Concepten opnieuw valideren",
          message: `${remainingDrafts}/${run.targetCount} recente concepten bleven geldig; vervallen, dubbele of onzekere concepten zijn veilig teruggezet voor hercontrole.`,
          heartbeatAt: new Date(),
        } });
      }
    }
    if (stats.checked >= run.maxCandidates) {
      const status = pendingCandidates > 0 || stats.stored > 0 ? JobStatus.PARTIALLY_COMPLETED : JobStatus.COMPLETE;
      return terminalRun(runId, status, stats, places, errors, warnings, candidateBudgetReason(stats, pendingCandidates, run.maxCandidates));
    }
    if (shouldStopForSourceOutage(consecutiveSourceFailures, env.GENERATION_MAX_SOURCE_FAILURES) && pendingCandidates === 0) {
      const status = capacity(stats) ? JobStatus.PARTIALLY_COMPLETED : JobStatus.FAILED;
      return terminalRun(runId, status, stats, places, errors, warnings, `De gratis bedrijfsbronnen zijn na ${consecutiveSourceFailures} opeenvolgende mislukte zoekbatches tijdelijk niet betrouwbaar bereikbaar. ${stats.checked} kandidaten zijn gecontroleerd en ${stats.stored} gekwalificeerde concepten zijn veilig bewaard; bestaande gegevens zijn behouden.`);
    }
    if (run.processedSegments + stats.sourceFailures >= env.GENERATION_MAX_SOURCE_CALLS && pendingCandidates === 0) {
      const status = capacity(stats) ? JobStatus.PARTIALLY_COMPLETED : JobStatus.COMPLETE;
      return terminalRun(runId, status, stats, places, errors, warnings, `${run.processedSegments + stats.sourceFailures} begrensde zoekbatches zijn uitgevoerd. ${stats.checked} kandidaten zijn gecontroleerd en ${stats.stored} gekwalificeerde concepten zijn veilig bewaard; de veiligheidsgrens van deze run is bereikt terwijl overige zoekstrategieën voor een volgende run beschikbaar blijven.`);
    }
    const completionStatus = generationCompletionStatus({ usable: capacity(stats), target: run.targetCount, processedSegments: run.processedSegments, sourceFailures: stats.sourceFailures, maxSegments: env.GENERATION_MAX_SOURCE_CALLS, pendingCandidates });
    if (completionStatus) {
      const status = completionStatus === "PARTIALLY_COMPLETED" ? JobStatus.PARTIALLY_COMPLETED : completionStatus === "FAILED" ? JobStatus.FAILED : JobStatus.COMPLETE;
      return terminalRun(runId, status, stats, places, errors, warnings, `${stats.stored} van de gewenste ${run.targetCount} volledig gekwalificeerde concepten gevonden. De ingestelde maximale zoekomvang van ${env.GENERATION_MAX_SOURCE_CALLS} succesvol opgehaalde segmenten is verwerkt; ${stats.manualReview} onzekere kandidaten blijven in de PostgreSQL-retryqueue.`);
    }

    const durationMs = Date.now() - batchStartedAt;
    const event = { jobId: runId, batchNumber: run.batchNumber, step: "batch_completed", durationMs, candidates: queued.length,
      checked: stats.checked - run.candidatesChecked, stored: stats.stored - run.stored, manualReview: stats.manualReview - run.manualReview,
      retries: retriedThisBatch, sourceFailures: stats.sourceFailures - run.sourceFailures, validationDurationMs, databaseDurationMs };
    console.info(JSON.stringify(event));
    await logSource(runId, run.currentSource ?? "GENERATION", "INFO", JSON.stringify(event), run.currentRegion ?? undefined, run.currentCategory ?? undefined);
    return prisma.generationRun.update({ where: { id: runId }, data: {
      ...runData(stats, places, errors, warnings), status: JobStatus.RUNNING,
      pendingCandidates, retriedCandidates: { increment: retriedThisBatch }, lastBatchDurationMs: durationMs,
      progress: Math.max(run.progress, generationProgress({ stored: stats.stored, target: run.targetCount, candidatesReserved: run.candidatesReserved, candidatesChecked: stats.checked, maxCandidates: run.maxCandidates, processedSegments: run.processedSegments, sourceFailures: stats.sourceFailures, maxSegments: env.GENERATION_MAX_SOURCE_CALLS })),
      currentPhase: isBatchDeadlineNear(deadline, Date.now(), 1_000) ? "Batch veilig gepauzeerd" : "Zoekbatch afgerond",
      message: isBatchDeadlineNear(deadline, Date.now(), 1_000)
        ? "De huidige batch is vóór de serverless deadline veilig gepauzeerd; de volgende batch wordt automatisch gestart."
        : batchMessage ?? `${stats.checked} kandidaten gecontroleerd; ${pendingCandidates} wachten nog in de persistente queue. De volgende batch wordt gestart.`,
    } });
  } catch (error) {
    errors.push(errorMessage(error));
    return terminalRun(runId, JobStatus.FAILED, stats, places, errors, warnings, `De job kan technisch niet verder: ${errorMessage(error)}`);
  } finally {
    await lock.release();
  }
}

/** Local/cron compatibility: the web UI uses one resumable batch per request. */
export async function runLeadGeneration(runId: string) {
  let run = await prisma.generationRun.findUniqueOrThrow({ where: { id: runId } });
  while (!terminalStatuses.has(run.status)) run = await processGenerationBatch(runId);
  return run;
}
