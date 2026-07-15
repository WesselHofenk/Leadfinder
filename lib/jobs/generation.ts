import { CandidateQueueStatus, JobStatus, Prisma, type GenerationCandidate, type GenerationRun } from "@prisma/client";

import { serverEnv } from "@/lib/env";
import { candidateDedupeKeys, fingerprintValues, RunDeduplicator } from "@/lib/leads/deduplication";
import { isPermanentlyClosed, isTemporarilyClosed } from "@/lib/leads/company-status";
import { validateCandidateBasics, type Candidate } from "@/lib/leads/eligibility";
import { evaluateNewLeadGate } from "@/lib/leads/intake-gate";
import { normalizeText } from "@/lib/leads/normalization";
import { extractCompanyWebsite } from "@/lib/leads/website";
import { verifyWebsiteCandidate, type WebsiteVerificationResult } from "@/lib/leads/website-verification";
import type { OverpassEvent } from "@/lib/openstreetmap/overpass";
import { prisma } from "@/lib/prisma";
import { enabledSourceAdapters } from "@/lib/sources/openstreetmap";
import { acquireJobLock } from "./lock";
import { candidateRetryStatus, generationCompletionStatus, isBatchDeadlineNear, phaseProgress, terminalGenerationStatuses } from "./generation-state";

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
    branchesUsed: [],
    apiErrors: errors.slice(-50),
    warnings: warnings.slice(-50),
    heartbeatAt: new Date(),
  };
}

function capacity(stats: Stats) { return stats.stored; }

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

async function knownCandidateReasons(candidates: Candidate[]) {
  const entries = candidates.map((candidate) => ({ candidate, keys: candidateDedupeKeys(candidate) }));
  const fingerprints = [...new Set(entries.flatMap(({ keys }) => fingerprintValues(keys).map(({ fingerprint }) => fingerprint)))];
  const [sourceRecords, leads, suppressed, exclusions] = await Promise.all([
    prisma.sourceRecord.findMany({
      where: { OR: entries.map(({ candidate }) => ({ source: candidate.source ?? "OPENSTREETMAP", sourceRecordId: candidate.externalPlaceId })) },
      select: { source: true, sourceRecordId: true, decision: true },
    }),
    prisma.lead.findMany({
      where: { OR: [
        { externalPlaceId: { in: entries.map(({ candidate }) => candidate.externalPlaceId) } },
        { normalizedPhoneNumber: { in: entries.flatMap(({ keys }) => keys.phone ? [keys.phone] : []) } },
        { normalizedDomain: { in: entries.flatMap(({ keys }) => keys.domain ? [keys.domain] : []) } },
        ...entries.map(({ candidate }) => ({ normalizedCompanyName: normalizeText(candidate.companyName), normalizedAddress: normalizeText(candidate.streetAddress) })),
      ] },
      select: { externalPlaceId: true, normalizedPhoneNumber: true, normalizedDomain: true, normalizedCompanyName: true, normalizedAddress: true },
    }),
    prisma.suppressedLead.findMany({ where: { fingerprint: { in: fingerprints } }, select: { fingerprint: true } }),
    prisma.leadExclusion.findMany({ where: { identityKey: { in: fingerprints }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { identityKey: true } }),
  ]);
  const priorSources = new Set(sourceRecords.filter(({ decision }) => decision && decision !== "retry").map(({ source, sourceRecordId }) => `${source}:${sourceRecordId}`));
  const blocked = new Set([...suppressed.map(({ fingerprint }) => fingerprint), ...exclusions.map(({ identityKey }) => identityKey)]);
  return new Map(entries.map(({ candidate, keys }) => {
    let reason: string | null = null;
    if (priorSources.has(`${candidate.source ?? "OPENSTREETMAP"}:${candidate.externalPlaceId}`) || leads.some((lead) => lead.externalPlaceId === candidate.externalPlaceId)) reason = "duplicate_source_id";
    else if (keys.domain && leads.some((lead) => lead.normalizedDomain === keys.domain)) reason = "duplicate_domain";
    else if (keys.phone && leads.some((lead) => lead.normalizedPhoneNumber === keys.phone)) reason = "duplicate_phone";
    else if (leads.some((lead) => lead.normalizedCompanyName === normalizeText(candidate.companyName) && lead.normalizedAddress === normalizeText(candidate.streetAddress))) reason = "duplicate_name_address";
    else if (fingerprintValues(keys).some(({ fingerprint }) => blocked.has(fingerprint))) reason = "previously_rejected";
    return [candidate.externalPlaceId, reason] as const;
  }));
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

export async function storeNewLead(candidate: Candidate, verification: WebsiteVerificationResult) {
  const gate = evaluateNewLeadGate(candidate, verification);
  if (!gate.allowed) return { stored: false, reviewOnly: false, reason: gate.reason, leadId: undefined };
  const basic = validateCandidateBasics(candidate);
  if (!basic.ok) return { stored: false, reviewOnly: false, reason: basic.reason, leadId: undefined };
  const lead = await prisma.lead.create({ data: {
    externalPlaceId: basic.lead.externalPlaceId,
    companyName: basic.lead.companyName,
    normalizedCompanyName: basic.lead.normalizedCompanyName,
    phoneNumber: basic.lead.phoneNumber || basic.lead.normalizedPhoneNumber,
    normalizedPhoneNumber: basic.lead.normalizedPhoneNumber,
    internationalPhoneNumber: basic.lead.internationalPhoneNumber || basic.lead.normalizedPhoneNumber,
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
    status: "NEW",
    isActive: true,
    isFiltered: false,
    filterReason: null,
    evidence: { create: verification.evidence },
    activities: { create: { type: "LEAD_GENERATED", summary: verification.reason, details: { source: candidate.source, websiteStatus: verification.status } } },
    history: { create: { event: "LEAD_GENERATED", details: { source: candidate.source, websiteStatus: verification.status } } },
  } });
  await prisma.sourceRecord.update({
    where: { source_sourceRecordId: { source: candidate.source ?? "OPENSTREETMAP", sourceRecordId: candidate.externalPlaceId } },
    data: { leadId: lead.id },
  });
  await Promise.all(fingerprintValues(candidateDedupeKeys(candidate)).map((item) => prisma.duplicateFingerprint.upsert({
    where: { fingerprint: item.fingerprint },
    create: { ...item, leadId: lead.id },
    update: { leadId: lead.id },
  })));
  return { stored: true, reviewOnly: false, reason: verification.reason, leadId: lead.id };
}

function rejectionCode(reason: string) {
  return ({ niet_operationeel: "likely_closed", keten_of_uitgesloten: "excluded_category", onbetrouwbare_status: "manual_verification_required" } as Record<string, string>)[reason] ?? "invalid_business";
}

async function nextSearchArea() {
  const area = await prisma.coverageArea.findFirst({
    where: { status: { not: "PAUSED" } },
    orderBy: [{ lastScannedAt: { sort: "asc", nulls: "first" } }, { priority: "asc" }, { city: "asc" }, { category: "asc" }],
  });
  if (!area) return null;
  const combination = await prisma.searchCombination.upsert({
    where: { country_city_category_source: { country: area.country, city: area.city, category: area.category, source: "OPENSTREETMAP" } },
    create: { country: area.country, city: area.city, category: area.category, source: "OPENSTREETMAP" },
    update: {},
  });
  return { area, combination, tileCursor: combination.tileCursor % 9 };
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

function progressFor(stats: Stats, target: number, processedSegments: number, maxSegments: number) {
  const resultProgress = Math.min(72, Math.round((capacity(stats) / Math.max(1, target)) * 72));
  const searchProgress = Math.min(18, Math.round((processedSegments / Math.max(1, maxSegments)) * 18));
  return Math.min(94, Math.max(5, 5 + resultProgress + searchProgress));
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

    let queued = await prisma.generationCandidate.findMany({
      where: { runId, status: CandidateQueueStatus.PENDING }, orderBy: { createdAt: "asc" }, take: env.GENERATION_BATCH_CANDIDATES,
    });

    if (!queued.length) {
      if (run.processedSegments >= env.GENERATION_MAX_SOURCE_CALLS) {
        const status = capacity(stats) ? JobStatus.PARTIALLY_COMPLETED : JobStatus.COMPLETE;
        return terminalRun(runId, status, stats, places, errors, warnings, `${stats.stored} van de gewenste ${run.targetCount} bevestigde geen-websiteleads gevonden; alle configureerbare zoeksegmenten zijn verwerkt.`);
      }
      const adapters = enabledSourceAdapters();
      if (!adapters.length) throw new Error("Er is geen gratis databron ingeschakeld.");
      const selected = await nextSearchArea();
      if (!selected) return terminalRun(runId, JobStatus.COMPLETE, stats, places, errors, warnings, "Er zijn geen openbare zoekgebieden beschikbaar.");
      const { area, combination, tileCursor } = selected;
      const adapter = adapters[0];
      const region = `${area.city}, ${area.country}`;
      const tileLabel = `t${tileCursor}`;
      const segment = `${area.country}:${area.city}:${area.category}:${tileLabel}`;

      await prisma.generationRun.update({ where: { id: runId }, data: {
        currentPhase: "Openbare bedrijfsvermeldingen ophalen", currentSource: adapter.id, currentRegion: region,
        currentCategory: area.category, currentTile: tileLabel, continuationCursor: segment,
        message: `Zoektegel ${tileLabel} voor ${area.category} in ${region} wordt met een eigen requesttimeout opgehaald.`, heartbeatAt: new Date(),
      } });

      try {
        const result = await adapter.searchBusinesses({
          country: area.country, city: area.city, latitude: Number(area.latitude), longitude: Number(area.longitude),
          radius: area.radius, category: area.category, tileCursor,
          onEvent: (event) => logOverpassEvent(runId, area.city, area.category, event),
        });
        const queuedResult = await prisma.generationCandidate.createMany({
          data: result.candidates.map((candidate) => ({
            runId, source: candidate.source ?? adapter.id, sourceRecordId: candidate.externalPlaceId, segment,
            payload: JSON.parse(JSON.stringify(candidate)) as Prisma.InputJsonValue,
          })),
          skipDuplicates: true,
        });
        stats.found += queuedResult.count;
        warnings.push(...result.warnings);
        if (!places.includes(segment)) places.push(segment);
        await prisma.$transaction([
          prisma.coverageArea.update({ where: { id: area.id }, data: { lastScannedAt: new Date(), resultsFound: { increment: queuedResult.count } } }),
          prisma.searchCombination.update({ where: { id: combination.id }, data: {
            useCount: { increment: 1 }, candidatesFound: { increment: queuedResult.count }, lastUsedAt: new Date(),
            tileCursor: (tileCursor + 1) % 9, lastTile: result.tile, lastError: null,
          } }),
          prisma.generationRun.update({ where: { id: runId }, data: { processedSegments: { increment: 1 }, lastError: null } }),
        ]);
        run.processedSegments += 1;
        batchMessage = `${queuedResult.count} nieuwe kandidaten zijn duurzaam in de controlequeue gezet.`;
      } catch (error) {
        const message = errorMessage(error);
        stats.sourceFailures += 1;
        errors.push(`${adapter.id} / ${region} / ${area.category}: ${message}`);
        batchMessage = `Deze bronbatch mislukte zonder eerdere resultaten te verliezen. De volgende zoekcombinatie wordt geprobeerd.`;
        await Promise.all([
          logSource(runId, adapter.id, "ERROR", JSON.stringify({ jobId: runId, batchNumber: run.batchNumber, step: "source_failed", region, category: area.category, tile: tileLabel, errorCode: "SOURCE_ERROR", message }), area.city, area.category),
          prisma.coverageArea.update({ where: { id: area.id }, data: { lastScannedAt: new Date() } }),
          prisma.searchCombination.update({ where: { id: combination.id }, data: { useCount: { increment: 1 }, lastUsedAt: new Date(), tileCursor: (tileCursor + 1) % 9, lastTile: tileLabel, lastError: message } }),
          prisma.generationRun.update({ where: { id: runId }, data: { processedSegments: { increment: 1 }, lastError: message } }),
        ]);
        run.processedSegments += 1;
      }

      queued = await prisma.generationCandidate.findMany({
        where: { runId, status: CandidateQueueStatus.PENDING }, orderBy: { createdAt: "asc" }, take: env.GENERATION_BATCH_CANDIDATES,
      });
    }

    if (queued.length) {
      await prisma.generationCandidate.updateMany({
        where: { id: { in: queued.map(({ id }) => id) }, status: CandidateQueueStatus.PENDING },
        data: { status: CandidateQueueStatus.PROCESSING, claimedAt: new Date() },
      });
    }

    const verificationWork: Array<{ row: GenerationCandidate; candidate: Candidate }> = [];
    const releaseIds: string[] = [];
    const knownReasons = queued.length ? await knownCandidateReasons(queued.map(candidateFromQueue)) : new Map<string, string | null>();
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
        await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
        continue;
      }
      if (isTemporarilyClosed(candidate)) {
        stats.temporarilyClosed += 1;
        await markDecision(candidate, "skipped", "SKIPPED_TEMPORARILY_CLOSED");
        await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
        continue;
      }
      const basic = validateCandidateBasics(candidate);
      if (!basic.ok) {
        stats.rejected += 1;
        await markDecision(candidate, "rejected", rejectionCode(basic.reason));
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
        await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
        continue;
      }
      const keys = candidateDedupeKeys(candidate);
      const knownReason = dedupe.hasOrAdd(keys) ? "duplicate_name_address" : knownReasons.get(candidate.externalPlaceId);
      if (knownReason) {
        stats.duplicates += 1; stats.existing += 1;
        await markDecision(candidate, "duplicate", knownReason);
        await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
        continue;
      }
      verificationWork.push({ row, candidate });
    }
    await releaseQueueItems(releaseIds, "Doorgeschoven naar de volgende kleine batch.");

    if (verificationWork.length) {
      stats.websitesChecked += verificationWork.length;
      await prisma.generationRun.update({ where: { id: runId }, data: {
        ...runData(stats, places, errors, warnings), currentPhase: "Websitebewijs controleren",
        message: `${verificationWork.length} websitecontroles draaien gelimiteerd en onafhankelijk van elkaar.`, heartbeatAt: new Date(),
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
          } else if (gate.reason === "SKIPPED_PERMANENTLY_CLOSED") {
            stats.permanentlyClosed += 1;
            await markDecision(candidate, "skipped", gate.reason);
          } else {
            stats.manualReview += 1;
            await markDecision(candidate, "retry", gate.reason);
          }
          await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
          continue;
        }
        const databaseStarted = Date.now();
        try {
          await prisma.generationRun.update({ where: { id: runId }, data: { currentPhase: "Resultaat veilig opslaan", heartbeatAt: new Date() } });
          const saved = await storeNewLead(candidate, verification);
          if (saved.stored) {
            stats.stored += 1; stats.withoutWebsite += 1; stats.noWebsite += 1;
            await markDecision(candidate, "stored", "no_website_confirmed", saved.leadId);
          } else {
            stats.rejected += 1;
            await markDecision(candidate, "skipped", saved.reason.startsWith("SKIPPED_") ? saved.reason : rejectionCode(saved.reason));
          }
          await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            stats.duplicates += 1; stats.existing += 1;
            await markDecision(candidate, "duplicate", "race_condition_duplicate");
            await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED);
          } else {
            const message = errorMessage(error);
            retriedThisBatch += 1;
            errors.push(`${candidate.companyName}: DATABASE_ERROR: ${message}`);
            await markDecision(candidate, "retry", "database_error");
            await finishQueueItem(row.id, candidateRetryStatus(row.attempts + 1) === "FAILED" ? CandidateQueueStatus.FAILED : CandidateQueueStatus.PENDING, message);
          }
        } finally { databaseDurationMs += Date.now() - databaseStarted; }
      }
    }

    const state = await prisma.generationRun.findUniqueOrThrow({ where: { id: runId }, select: { cancelRequested: true, status: true } });
    if (state.cancelRequested || state.status === JobStatus.CANCELLED) return terminalRun(runId, JobStatus.CANCELLED, stats, places, errors, warnings, "De zoekrun is geannuleerd; alle eerder bewaarde resultaten blijven behouden.");
    const pendingCandidates = await prisma.generationCandidate.count({ where: { runId, status: CandidateQueueStatus.PENDING } });
    const completionStatus = generationCompletionStatus({ usable: capacity(stats), target: run.targetCount, processedSegments: run.processedSegments, maxSegments: env.GENERATION_MAX_SOURCE_CALLS, pendingCandidates });
    if (completionStatus === "COMPLETE" && capacity(stats) >= run.targetCount) return terminalRun(runId, JobStatus.COMPLETE, stats, places, errors, warnings, `Doelbatch bereikt: ${stats.stored} bevestigde geen-websiteleads; ${stats.manualReview} onzekere kandidaten zijn veilig overgeslagen.`);
    if (completionStatus) {
      const status = completionStatus === "PARTIALLY_COMPLETED" ? JobStatus.PARTIALLY_COMPLETED : JobStatus.COMPLETE;
      return terminalRun(runId, status, stats, places, errors, warnings, `${stats.stored} van de gewenste ${run.targetCount} bevestigde geen-websiteleads gevonden. De openbare zoekruimte voor deze run is uitgeput; onzekere kandidaten zijn niet opgeslagen.`);
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
      progress: progressFor(stats, run.targetCount, run.processedSegments, env.GENERATION_MAX_SOURCE_CALLS),
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
