import { CandidateQueueStatus, JobStatus, Prisma, type GenerationCandidate, type GenerationRun } from "@prisma/client";

import { serverEnv } from "@/lib/env";
import { candidateDedupeKeys, fingerprintValues, RunDeduplicator, strongIdentityFingerprintValues } from "@/lib/leads/deduplication";
import { isPermanentlyClosed, isTemporarilyClosed } from "@/lib/leads/company-status";
import { validateCandidateBasics, type Candidate } from "@/lib/leads/eligibility";
import { evaluateNewLeadGate } from "@/lib/leads/intake-gate";
import { normalizeText } from "@/lib/leads/normalization";
import { NEW_PIPELINE_STAGE_ID } from "@/lib/leads/pipeline";
import { importDueValidationRetries, importInterruptedGenerationCandidates, markValidationRejected, queueValidationRetry } from "@/lib/leads/retry-queue";
import { extractCompanyWebsite } from "@/lib/leads/website";
import { verifyWebsiteCandidate, type WebsiteVerificationResult } from "@/lib/leads/website-verification";
import { nextOverpassTileCursor, OSM_SEARCH_CURSOR_COUNT, overpassSearchPlan, type OverpassEvent } from "@/lib/openstreetmap/overpass";
import { prisma } from "@/lib/prisma";
import { enabledSourceAdapters } from "@/lib/sources/openstreetmap";
import { acquireJobLock } from "./lock";
import { candidateRetryStatus, generationCompletionStatus, generationProgress, generationRetryImportLimit, isBatchDeadlineNear, isGenerationRunExpired, phaseProgress, sourceAttemptDelta, sourceFailureWarningDue, terminalGenerationStatuses } from "./generation-state";

type Stats = {
  found: number;
  checked: number;
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
};

const terminalStatuses = new Set<JobStatus>(terminalGenerationStatuses as readonly JobStatus[]);
const errorMessage = (error: unknown) => error instanceof Error ? error.message.slice(0, 300) : "Onbekende bronfout";
const stringArray = (value: Prisma.JsonValue): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

function statsFromRun(run: GenerationRun): Stats {
  return {
    found: run.candidatesFound,
    checked: run.candidatesChecked,
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
  };
}

function runData(stats: Stats, places: string[], errors: string[], warnings: string[]): Prisma.GenerationRunUpdateInput {
  const branches = [...new Set(places.map((segment) => segment.split(":")[2]).filter(Boolean))];
  return {
    candidatesFound: stats.found,
    candidatesChecked: stats.checked,
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
    estimatedCostCents: 0,
    placesUsed: places,
    branchesUsed: branches,
    apiErrors: errors.slice(-50),
    warnings: warnings.slice(-50),
    heartbeatAt: new Date(),
  };
}

function capacity(stats: Pick<Stats, "stored">) { return stats.stored; }

export async function createGenerationRun() {
  const target = Number(process.env.LEAD_GENERATION_TARGET || 50);
  return prisma.generationRun.create({
    data: {
      targetCount: Math.min(50, Math.max(1, target)),
      currentPhase: "Zoekopdracht klaarzetten",
      progress: phaseProgress("queued"),
      message: "De zoekopdracht is gevalideerd en staat klaar.",
      heartbeatAt: new Date(),
    },
  });
}

export async function markStaleGenerationRuns(now = new Date()) {
  const env = serverEnv();
  const staleBefore = new Date(now.getTime() - env.GENERATION_WATCHDOG_SECONDS * 1000);
  await prisma.generationCandidate.updateMany({
    where: { status: "PROCESSING", claimedAt: { lt: staleBefore } },
    data: { status: "PENDING", claimedAt: null, lastError: "Onderbroken batch automatisch vrijgegeven." },
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
  await logSource(runId, "OPENSTREETMAP", level, JSON.stringify(entry), city, category);
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
      rawWebsite: candidate.website,
      rawBusinessStatus: candidate.businessStatus,
      payload: JSON.parse(JSON.stringify(candidate)),
    },
  });
}

async function markDecision(candidate: Candidate, decision: string, reasonCode: string, leadId?: string) {
  await prisma.sourceRecord.update({
    where: { source_sourceRecordId: { source: candidate.source ?? "OPENSTREETMAP", sourceRecordId: candidate.externalPlaceId } },
    data: { decision, reasonCode, processedAt: new Date(), leadId },
  });
  if (reasonCode.startsWith("SKIPPED_")) {
    console.info(JSON.stringify({ step: "candidate_skipped", source: candidate.source ?? "OPENSTREETMAP", sourceRecordId: candidate.externalPlaceId, companyName: candidate.companyName, reasonCode }));
  }
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
        { normalizedPhoneNumber: { in: entries.flatMap(({ keys }) => keys.phone ? [keys.phone] : []) } },
        { normalizedDomain: { in: entries.flatMap(({ keys }) => keys.domain ? [keys.domain] : []) } },
        ...entries.map(({ candidate }) => ({ normalizedCompanyName: normalizeText(candidate.companyName), normalizedAddress: normalizeText(candidate.streetAddress) })),
      ] },
      select: { id: true, externalPlaceId: true, normalizedPhoneNumber: true, normalizedDomain: true, normalizedCompanyName: true, normalizedAddress: true },
    }),
    prisma.suppressedLead.findMany({ where: { fingerprint: { in: fingerprints } }, select: { fingerprint: true } }),
    prisma.leadExclusion.findMany({ where: { identityKey: { in: fingerprints }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { identityKey: true } }),
  ]);
  const blocked = new Set([...suppressed.map(({ fingerprint }) => fingerprint), ...exclusions.map(({ identityKey }) => identityKey)]);
  return new Map<string, KnownCandidateMatch | null>(entries.map(({ candidate, keys }) => {
    let match: KnownCandidateMatch | null = null;
    const priorSource = sourceRecords.find(({ source, sourceRecordId }) => source === (candidate.source ?? "OPENSTREETMAP") && sourceRecordId === candidate.externalPlaceId);
    const sourceLead = leads.find((lead) => lead.externalPlaceId === candidate.externalPlaceId);
    const domainLead = keys.domain ? leads.find((lead) => lead.normalizedDomain === keys.domain) : undefined;
    const phoneLead = keys.phone ? leads.find((lead) => lead.normalizedPhoneNumber === keys.phone) : undefined;
    const addressLead = leads.find((lead) => lead.normalizedCompanyName === normalizeText(candidate.companyName) && lead.normalizedAddress === normalizeText(candidate.streetAddress));
    if (sourceLead || priorSource?.leadId || ["stored", "duplicate"].includes(priorSource?.decision ?? "")) {
      match = { reason: "duplicate_source_id", disposition: "duplicate", leadId: sourceLead?.id ?? priorSource?.leadId ?? undefined, matchedFields: ["source_id"] };
    } else if (domainLead) match = { reason: "duplicate_domain", disposition: "duplicate", leadId: domainLead.id, matchedFields: ["domain"] };
    else if (phoneLead) match = { reason: "duplicate_phone", disposition: "duplicate", leadId: phoneLead.id, matchedFields: ["phone"] };
    else if (addressLead) match = { reason: "duplicate_name_address", disposition: "duplicate", leadId: addressLead.id, matchedFields: ["name", "address"] };
    else if (["skipped", "rejected"].includes(priorSource?.decision ?? "") && [
      "SKIPPED_PERMANENTLY_CLOSED",
      "SKIPPED_HAS_WEBSITE",
      "likely_closed",
      "excluded_category",
    ].includes(priorSource?.reasonCode ?? "")) {
      match = { reason: priorSource?.reasonCode ?? "previously_rejected", disposition: "rejected", matchedFields: ["source_id"] };
    } else if (strongIdentityFingerprintValues(keys).some(({ fingerprint }) => blocked.has(fingerprint))) {
      match = { reason: "previously_rejected", disposition: "rejected", matchedFields: ["strong_identity"] };
    }
    return [candidate.externalPlaceId, match] as const;
  }));
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

export async function saveValidatedLead(candidate: Candidate, verification: WebsiteVerificationResult) {
  // Existing leads must remain untouched.
  // Validation applies only to newly generated candidates.
  const gate = evaluateNewLeadGate(candidate, verification);
  if (!gate.allowed) return { stored: false, reviewOnly: false, reason: gate.reason, leadId: undefined };
  const basic = validateCandidateBasics(candidate);
  if (!basic.ok) return { stored: false, reviewOnly: false, reason: basic.reason, leadId: undefined };
  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({ data: {
      externalPlaceId: basic.lead.externalPlaceId,
      companyName: basic.lead.companyName,
      normalizedCompanyName: basic.lead.normalizedCompanyName,
      phoneNumber: basic.lead.phoneNumber || basic.lead.normalizedPhoneNumber || "",
      normalizedPhoneNumber: basic.lead.normalizedPhoneNumber,
      internationalPhoneNumber: basic.lead.internationalPhoneNumber || basic.lead.normalizedPhoneNumber || null,
      email: basic.lead.email,
      category: basic.lead.category,
      subCategory: basic.lead.subCategory,
      country: basic.lead.country,
      province: basic.lead.province,
      municipality: basic.lead.municipality,
      city: basic.lead.city,
      postalCode: basic.lead.postalCode,
      streetAddress: basic.lead.streetAddress,
      houseNumber: basic.lead.houseNumber,
      normalizedAddress: basic.lead.normalizedAddress,
      latitude: new Prisma.Decimal(basic.lead.latitude),
      longitude: new Prisma.Decimal(basic.lead.longitude),
      googleMapsUrl: basic.lead.googleMapsUrl,
      website: verification.website,
      websiteUrl: verification.website,
      normalizedDomain: verification.website ? new URL(verification.website).hostname.replace(/^www\./, "") : null,
      websiteStatus: verification.status,
      websiteStatusReason: verification.reason,
      websiteConfidence: verification.confidence,
      websiteSource: "local_verification",
      sourceUrl: basic.lead.sourceUrl ?? basic.lead.googleMapsUrl,
      sourceFetchedAt: basic.lead.fetchedAt ? new Date(basic.lead.fetchedAt) : new Date(),
      leadType: "NO_WEBSITE",
      opportunityScore: 90,
      conversionQualityScore: 0,
      businessStatus: basic.lead.businessStatus,
      source: "OPENSTREETMAP",
      confidenceScore: basic.lead.confidenceScore,
      confidenceLevel: basic.lead.confidenceLevel,
      pipelineStageId: NEW_PIPELINE_STAGE_ID,
      isActive: true,
      isFiltered: false,
      filterReason: null,
      evidence: { create: verification.evidence },
      activities: { create: { type: "LEAD_GENERATED", summary: verification.reason, details: { source: candidate.source, websiteStatus: verification.status } } },
      history: { create: { event: "LEAD_GENERATED", details: { source: candidate.source, websiteStatus: verification.status } } },
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
        rawWebsite: candidate.website,
        rawBusinessStatus: candidate.businessStatus,
        decision: "stored",
        reasonCode: "no_website_confirmed",
        processedAt: new Date(),
        leadId: lead.id,
        payload: JSON.parse(JSON.stringify(candidate)) as Prisma.InputJsonValue,
      },
      update: { leadId: lead.id, decision: "stored", reasonCode: "no_website_confirmed", processedAt: new Date() },
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
    await Promise.all(fingerprintValues(candidateDedupeKeys(candidate)).map((item) => tx.duplicateFingerprint.upsert({
      where: { fingerprint: item.fingerprint },
      create: { ...item, leadId: lead.id },
      update: { leadId: lead.id },
    })));
    return { stored: true, reviewOnly: false, reason: verification.reason, leadId: lead.id };
  });
}

export const storeNewLead = saveValidatedLead;

function rejectionCode(reason: string) {
  return ({ niet_operationeel: "likely_closed", keten_of_uitgesloten: "excluded_category", onbetrouwbare_status: "manual_verification_required" } as Record<string, string>)[reason] ?? "invalid_business";
}

async function nextSearchArea() {
  const areas = await prisma.coverageArea.findMany({
    where: { status: { not: "PAUSED" } },
    orderBy: [{ lastScannedAt: { sort: "asc", nulls: "first" } }, { priority: "asc" }, { city: "asc" }, { category: "asc" }],
    take: 24,
  });
  if (!areas.length) return null;
  const unseen = areas.find((area) => !area.lastScannedAt);
  let area = unseen ?? areas[0];
  if (!unseen) {
    const combinations = await prisma.searchCombination.findMany({
      where: { OR: areas.map((candidate) => ({ country: candidate.country, city: candidate.city, category: candidate.category, source: "OPENSTREETMAP" })) },
      select: { country: true, city: true, category: true, validLeads: true, useCount: true },
    });
    const yields = new Map(combinations.map((item) => [`${item.country}:${item.city}:${item.category}`, item.validLeads / Math.max(1, item.useCount)]));
    // Choose a productive combination only inside the 24 least-recently-used
    // candidates. This exploits proven segments without sacrificing rotation.
    area = areas.slice().sort((left, right) =>
      (yields.get(`${right.country}:${right.city}:${right.category}`) ?? 0)
      - (yields.get(`${left.country}:${left.city}:${left.category}`) ?? 0),
    )[0];
  }
  const combination = await prisma.searchCombination.upsert({
    where: { country_city_category_source: { country: area.country, city: area.city, category: area.category, source: "OPENSTREETMAP" } },
    create: { country: area.country, city: area.city, category: area.category, source: "OPENSTREETMAP", region: area.region, searchTerm: area.category, provider: "OPENSTREETMAP" },
    update: { region: area.region, searchTerm: area.category },
  });
  return { area, combination, tileCursor: combination.tileCursor % OSM_SEARCH_CURSOR_COUNT };
}

async function terminalRun(runId: string, status: JobStatus, stats: Stats, places: string[], errors: string[], warnings: string[], reason: string) {
  return prisma.generationRun.update({
    where: { id: runId },
    data: {
      ...runData(stats, places, errors, warnings),
      status,
      progress: 100,
      exhausted: (status === JobStatus.COMPLETE || status === JobStatus.PARTIALLY_COMPLETED) && stats.stored < (await prisma.generationRun.findUniqueOrThrow({ where: { id: runId }, select: { targetCount: true } })).targetCount,
      currentPhase: status === JobStatus.CANCELLED ? "Geannuleerd" : status === JobStatus.TIMED_OUT ? "Tijdslimiet bereikt" : status === JobStatus.FAILED ? "Mislukt" : status === JobStatus.PARTIALLY_COMPLETED ? "Gedeeltelijk afgerond" : "Voltooid",
      message: reason,
      stopReason: reason,
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
    data: { status, lastError: lastError?.slice(0, 300) ?? null, claimedAt: null, processedAt: status === CandidateQueueStatus.PROCESSED || status === CandidateQueueStatus.FAILED ? new Date() : null },
  });
}

async function releaseQueueItems(ids: string[], reason: string) {
  if (!ids.length) return;
  await prisma.generationCandidate.updateMany({ where: { id: { in: ids }, status: CandidateQueueStatus.PROCESSING }, data: { status: CandidateQueueStatus.PENDING, claimedAt: null, lastError: reason } });
}

export async function processGenerationBatch(runId: string) {
  const env = serverEnv();
  await markStaleGenerationRuns();
  let run = await prisma.generationRun.findUniqueOrThrow({ where: { id: runId } });
  if (terminalStatuses.has(run.status)) return run;
  const batchStartedAt = Date.now();
  const deadline = batchStartedAt + env.GENERATION_BATCH_DURATION_SECONDS * 1000;
  const lock = await acquireJobLock(`lead-generation:${runId}`, (env.GENERATION_BATCH_DURATION_SECONDS + 10) * 1000);
  if (!lock) return run;

  const stats = statsFromRun(run);
  const errors = stringArray(run.apiErrors);
  const warnings = stringArray(run.warnings);
  const places = stringArray(run.placesUsed);
  const dedupe = new RunDeduplicator();
  let retriedThisBatch = 0;
  let validationDurationMs = 0;
  let databaseDurationMs = 0;
  let batchMessage: string | null = null;

  try {
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
    if (run.cancelRequested) return terminalRun(runId, JobStatus.CANCELLED, stats, places, errors, warnings, "De zoekrun is geannuleerd.");
    if (isGenerationRunExpired(run.startedAt, env.GENERATION_MAX_RUN_MINUTES)) {
      return terminalRun(
        runId,
        JobStatus.TIMED_OUT,
        stats,
        places,
        errors,
        warnings,
        `${stats.stored} bevestigde leads opgeslagen. De ingestelde maximale zoektijd van ${env.GENERATION_MAX_RUN_MINUTES} minuten is bereikt na ${run.processedSegments} succesvolle zoeksegmenten en ${stats.sourceFailures} bronfouten; ${stats.manualReview} onzekere kandidaten blijven in de PostgreSQL-retryqueue.`,
      );
    }

    let queued = await prisma.generationCandidate.findMany({
      where: { runId, status: CandidateQueueStatus.PENDING }, orderBy: { createdAt: "asc" }, take: env.GENERATION_BATCH_CANDIDATES,
    });

    let retryQuotaRemaining = generationRetryImportLimit(env.GENERATION_BATCH_CANDIDATES, run.retriedCandidates);

    if (!queued.length && retryQuotaRemaining > 0) {
      const carriedCandidates = await importInterruptedGenerationCandidates(runId, retryQuotaRemaining);
      if (carriedCandidates) {
        stats.found += carriedCandidates;
        retriedThisBatch += carriedCandidates;
        queued = await prisma.generationCandidate.findMany({
          where: { runId, status: CandidateQueueStatus.PENDING }, orderBy: { createdAt: "asc" }, take: env.GENERATION_BATCH_CANDIDATES,
        });
        batchMessage = `${carriedCandidates} nog niet gecontroleerde kandidaten uit een onderbroken run zijn veilig hervat.`;
        retryQuotaRemaining -= carriedCandidates;
      }
    }

    if (!queued.length && retryQuotaRemaining > 0) {
      const importedRetries = await importDueValidationRetries(runId, retryQuotaRemaining);
      if (importedRetries) {
        retriedThisBatch += importedRetries;
        queued = await prisma.generationCandidate.findMany({
          where: { runId, status: CandidateQueueStatus.PENDING }, orderBy: { createdAt: "asc" }, take: env.GENERATION_BATCH_CANDIDATES,
        });
        batchMessage = `${importedRetries} onzekere kandidaten zijn uit de duurzame retryqueue opnieuw ingepland.`;
      }
    }

    if (!queued.length) {
      if (run.processedSegments + stats.sourceFailures >= env.GENERATION_MAX_SOURCE_CALLS) {
        const status = capacity(stats) ? JobStatus.PARTIALLY_COMPLETED : JobStatus.FAILED;
        return terminalRun(runId, status, stats, places, errors, warnings, `${stats.stored} van de gewenste ${run.targetCount} bevestigde geen-websiteleads gevonden; de ingestelde maximale zoekomvang van ${env.GENERATION_MAX_SOURCE_CALLS} succesvol opgehaalde segmenten is verwerkt.`);
      }
      const adapters = enabledSourceAdapters();
      if (!adapters.length) throw new Error("Er is geen gratis databron ingeschakeld.");
      const selected = await nextSearchArea();
      if (!selected) return terminalRun(runId, stats.stored ? JobStatus.PARTIALLY_COMPLETED : JobStatus.FAILED, stats, places, errors, warnings, "Er zijn geen openbare zoekgebieden beschikbaar; er zijn geen nieuwe geldige leads opgeslagen.");
      const { area, combination, tileCursor } = selected;
      const adapter = adapters[0];
      const region = `${area.city}, ${area.country}`;
      const tileLabel = overpassSearchPlan(tileCursor).id;
      const segment = `${area.country}:${area.city}:${area.category}:${tileLabel}`;
      const sourceStartedAt = Date.now();

      run.progress = Math.max(run.progress, phaseProgress("source"));
      await prisma.generationRun.update({ where: { id: runId }, data: {
        currentPhase: "Openbare bedrijfsvermeldingen ophalen", currentSource: adapter.id, currentRegion: region,
        currentCategory: area.category, currentTile: tileLabel, continuationCursor: segment,
        progress: run.progress,
        message: `Zoektegel ${tileLabel} voor ${area.category} in ${region} wordt met een eigen requesttimeout opgehaald.`, heartbeatAt: new Date(),
      } });

      try {
        const result = await adapter.searchBusinesses({
          country: area.country, city: area.city, latitude: Number(area.latitude), longitude: Number(area.longitude),
          radius: area.radius, category: area.category, tileCursor,
          onEvent: (event) => logOverpassEvent(runId, area.city, area.category, event),
        });
        const attemptDelta = sourceAttemptDelta(true);
        const sourceDurationMs = Date.now() - sourceStartedAt;
        warnings.push(...result.warnings);
        if (!places.includes(segment)) places.push(segment);
        const bufferedCandidates = result.candidates.slice(0, env.LEAD_CANDIDATE_BUFFER);
        const knownAtSource = bufferedCandidates.length ? await knownCandidateReasons(bufferedCandidates) : new Map<string, KnownCandidateMatch | null>();
        const novelCandidates = bufferedCandidates.filter((candidate) => {
          const known = knownAtSource.get(candidate.externalPlaceId);
          if (!known) return true;
          if (known.disposition === "rejected") stats.rejected += 1;
          else { stats.duplicates += 1; stats.existing += 1; }
          return false;
        });
        const queuedResult = await prisma.$transaction(async (tx) => {
          const inserted = await tx.generationCandidate.createMany({
            data: novelCandidates.map((candidate) => ({
              runId, source: candidate.source ?? adapter.id, sourceRecordId: candidate.externalPlaceId, segment,
              payload: JSON.parse(JSON.stringify(candidate)) as Prisma.InputJsonValue,
            })),
            skipDuplicates: true,
          });
          await tx.coverageArea.update({ where: { id: area.id }, data: { lastScannedAt: new Date(), resultsFound: { increment: result.candidates.length } } });
          await tx.searchCombination.update({ where: { id: combination.id }, data: {
            useCount: { increment: 1 }, candidatesFound: { increment: result.candidates.length }, lastUsedAt: new Date(),
            region: area.region, searchTerm: area.category, provider: result.sourceUrl ?? adapter.id,
            totalDurationMs: { increment: BigInt(sourceDurationMs) },
            averageDurationMs: Math.round((Number(combination.totalDurationMs) + sourceDurationMs) / (combination.useCount + 1)),
            tileCursor: nextOverpassTileCursor(tileCursor), lastTile: result.tile, lastError: null,
          } });
          await tx.generationRun.update({ where: { id: runId }, data: { processedSegments: { increment: attemptDelta.processedSegments }, lastError: null } });
          return inserted;
        });
        stats.found += result.candidates.length;
        run.processedSegments += attemptDelta.processedSegments;
        batchMessage = `${result.candidates.length} kandidaten gevonden; ${queuedResult.count} nog onbekende kandidaten zijn duurzaam in de controlequeue gezet.`;
      } catch (error) {
        const message = errorMessage(error);
        const sourceDurationMs = Date.now() - sourceStartedAt;
        const attemptDelta = sourceAttemptDelta(false);
        stats.sourceFailures += attemptDelta.sourceFailures;
        errors.push(`${adapter.id} / ${region} / ${area.category}: ${message}`);
        batchMessage = `Deze bronbatch mislukte zonder eerdere resultaten te verliezen. De volgende zoekcombinatie wordt geprobeerd.`;
        await Promise.all([
          logSource(runId, adapter.id, "ERROR", JSON.stringify({ jobId: runId, batchNumber: run.batchNumber, step: "source_failed", region, category: area.category, tile: tileLabel, errorCode: "SOURCE_ERROR", message }), area.city, area.category),
          prisma.coverageArea.update({ where: { id: area.id }, data: { lastScannedAt: new Date() } }),
          prisma.searchCombination.update({ where: { id: combination.id }, data: {
            useCount: { increment: 1 }, errorCount: { increment: 1 }, lastUsedAt: new Date(),
            region: area.region, searchTerm: area.category, provider: adapter.id,
            totalDurationMs: { increment: BigInt(sourceDurationMs) },
            averageDurationMs: Math.round((Number(combination.totalDurationMs) + sourceDurationMs) / (combination.useCount + 1)),
            tileCursor: nextOverpassTileCursor(tileCursor), lastTile: tileLabel, lastError: message,
          } }),
          prisma.generationRun.update({ where: { id: runId }, data: { lastError: message } }),
        ]);
        if (sourceFailureWarningDue(stats.sourceFailures, env.GENERATION_MAX_SOURCE_FAILURES)) {
          warnings.push(`${stats.sourceFailures} openbare bronbatches reageerden niet; de run gaat door met andere plaatsen, branches, tegels en hosts.`);
        }
      }

      queued = await prisma.generationCandidate.findMany({
        where: { runId, status: CandidateQueueStatus.PENDING }, orderBy: { createdAt: "asc" }, take: env.GENERATION_BATCH_CANDIDATES,
      });
    }

    if (queued.length) {
      run.progress = Math.max(run.progress, phaseProgress("candidates"));
      await prisma.generationRun.update({ where: { id: runId }, data: {
        currentPhase: "Kandidaten valideren", progress: run.progress,
        message: `${queued.length} kandidaten worden gecontroleerd op status, contactgegevens en duplicaten.`, heartbeatAt: new Date(),
      } });
      await prisma.generationCandidate.updateMany({
        where: { id: { in: queued.map(({ id }) => id) }, status: CandidateQueueStatus.PENDING },
        data: { status: CandidateQueueStatus.PROCESSING, claimedAt: new Date() },
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
    const releaseIds: string[] = [];
    const knownReasons = queued.length ? await knownCandidateReasons(queued.map(candidateFromQueue)) : new Map<string, KnownCandidateMatch | null>();
    for (const row of queued) {
      if (isBatchDeadlineNear(deadline) || verificationWork.length >= env.GENERATION_BATCH_WEBSITE_CHECKS || capacity(stats) + verificationWork.length >= run.targetCount) {
        releaseIds.push(row.id);
        continue;
      }
      await prisma.generationCandidate.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
      const candidate = candidateFromQueue(row);
      if (row.attempts === 0) stats.checked += 1;
      await sourceRecord(candidate);
      if (isPermanentlyClosed(candidate)) {
        stats.permanentlyClosed += 1;
        await markDecision(candidate, "skipped", "SKIPPED_PERMANENTLY_CLOSED");
        await markValidationRejected(candidate, "SKIPPED_PERMANENTLY_CLOSED");
        await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
        continue;
      }
      if (isTemporarilyClosed(candidate)) {
        stats.temporarilyClosed += 1;
        stats.manualReview += 1;
        await markDecision(candidate, "retry", "TEMPORARILY_CLOSED");
        await queueValidationRetry({ runId, candidate, reason: "STATUS_CHECK_FAILED: bron meldt tijdelijk gesloten; later opnieuw controleren." });
        await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
        continue;
      }
      const basic = validateCandidateBasics(candidate);
      if (!basic.ok) {
        stats.rejected += 1;
        await markDecision(candidate, "rejected", rejectionCode(basic.reason));
        await markValidationRejected(candidate, rejectionCode(basic.reason));
        await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
        continue;
      }
      const sourceWebsite = extractCompanyWebsite(candidate);
      if (sourceWebsite) {
        const verification: WebsiteVerificationResult = {
          status: "WEBSITE_FOUND", confidence: 100, website: sourceWebsite,
          reason: "Eigen bedrijfswebsite rechtstreeks in de brongegevens gevonden.",
          evidence: [{ checkType: "SOURCE_WEBSITE", result: "FOUND", confidence: 100, evidenceUrl: sourceWebsite, shortExplanation: "Bronveld bevat een officieel bedrijfsdomein." }],
        };
        stats.websitesFound += 1; stats.rejected += 1;
        await excludeCandidate(candidate, verification);
        await markDecision(candidate, "skipped", "SKIPPED_HAS_WEBSITE");
        await markValidationRejected(candidate, "SKIPPED_HAS_WEBSITE", verification);
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
        await logDuplicateMatch(runId, candidate, match);
        await markDecision(candidate, knownMatch?.disposition === "rejected" ? "rejected" : "duplicate", match.reason);
        await markValidationRejected(candidate, match.reason);
        await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
        continue;
      }
      verificationWork.push({ row, candidate });
    }
    await releaseQueueItems(releaseIds, "Doorgeschoven naar de volgende kleine batch.");

    if (verificationWork.length) {
      stats.websitesChecked += verificationWork.length;
      run.progress = Math.max(run.progress, phaseProgress("websites"));
      await prisma.generationRun.update({ where: { id: runId }, data: {
        ...runData(stats, places, errors, warnings), currentPhase: "Websitebewijs controleren",
        progress: run.progress, message: `${verificationWork.length} websitecontroles draaien gelimiteerd en onafhankelijk van elkaar.`, heartbeatAt: new Date(),
      } });
      const validationStarted = Date.now();
      const verificationResults = await Promise.allSettled(verificationWork.map(({ candidate }) => verifyWebsiteCandidate(candidate)));
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
          } else {
            stats.manualReview += 1;
            await markDecision(candidate, "retry", gate.reason);
            await queueValidationRetry({ runId, candidate, verification, reason: `${gate.reason}: ${gate.detail}` });
          }
          await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
          continue;
        }
        const databaseStarted = Date.now();
        try {
          run.progress = Math.max(run.progress, phaseProgress("saving"));
          await prisma.generationRun.update({ where: { id: runId }, data: { currentPhase: "Resultaat veilig opslaan", progress: run.progress, heartbeatAt: new Date() } });
          const saved = await saveValidatedLead(candidate, verification);
          if (saved.stored) {
            stats.stored += 1; stats.withoutWebsite += 1; stats.noWebsite += 1;
            await markDecision(candidate, "stored", "no_website_confirmed", saved.leadId);
          } else {
            stats.rejected += 1;
            await markDecision(candidate, "skipped", saved.reason.startsWith("SKIPPED_") ? saved.reason : rejectionCode(saved.reason));
            await markValidationRejected(candidate, saved.reason, verification);
          }
          await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            stats.duplicates += 1; stats.existing += 1;
            await markDecision(candidate, "duplicate", "race_condition_duplicate");
            await markValidationRejected(candidate, "race_condition_duplicate", verification);
            await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
          } else {
            const message = errorMessage(error);
            retriedThisBatch += 1;
            errors.push(`${candidate.companyName}: DATABASE_ERROR: ${message}`);
            await markDecision(candidate, "retry", "database_error");
            await queueValidationRetry({ runId, candidate, verification, reason: `DATABASE_ERROR: ${message}` });
            await finishQueueItem(row.id, candidateRetryStatus(row.attempts + 1) === "FAILED" ? CandidateQueueStatus.FAILED : CandidateQueueStatus.PENDING, message);
          }
        } finally { databaseDurationMs += Date.now() - databaseStarted; }
      }
    }

    const state = await prisma.generationRun.findUniqueOrThrow({ where: { id: runId }, select: { cancelRequested: true, status: true } });
    if (state.cancelRequested || state.status === JobStatus.CANCELLED) return terminalRun(runId, JobStatus.CANCELLED, stats, places, errors, warnings, "De zoekrun is geannuleerd; alle eerder bewaarde resultaten blijven behouden.");
    const pendingCandidates = await prisma.generationCandidate.count({ where: { runId, status: CandidateQueueStatus.PENDING } });
    const completionStatus = generationCompletionStatus({ usable: capacity(stats), target: run.targetCount, processedSegments: run.processedSegments, sourceFailures: stats.sourceFailures, maxSegments: env.GENERATION_MAX_SOURCE_CALLS, pendingCandidates });
    if (completionStatus === "COMPLETE" && capacity(stats) >= run.targetCount) return terminalRun(runId, JobStatus.COMPLETE, stats, places, errors, warnings, `Doelbatch bereikt: ${stats.stored} bevestigde geen-websiteleads; ${stats.manualReview} onzekere kandidaten blijven veilig in de PostgreSQL-retryqueue.`);
    if (completionStatus) {
      const status = completionStatus === "PARTIALLY_COMPLETED" ? JobStatus.PARTIALLY_COMPLETED : completionStatus === "FAILED" ? JobStatus.FAILED : JobStatus.COMPLETE;
      return terminalRun(runId, status, stats, places, errors, warnings, `${stats.stored} van de gewenste ${run.targetCount} bevestigde geen-websiteleads gevonden. De ingestelde maximale zoekomvang van ${env.GENERATION_MAX_SOURCE_CALLS} succesvol opgehaalde segmenten is verwerkt; ${stats.manualReview} onzekere kandidaten blijven in de PostgreSQL-retryqueue.`);
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
      progress: Math.max(run.progress, generationProgress({ stored: stats.stored, target: run.targetCount, candidatesChecked: stats.checked, processedSegments: run.processedSegments, sourceFailures: stats.sourceFailures, maxSegments: env.GENERATION_MAX_SOURCE_CALLS })),
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
