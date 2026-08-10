import { CandidateQueueStatus, JobStatus, Prisma, type GenerationCandidate, type GenerationRun } from "@prisma/client";

import { serverEnv } from "@/lib/env";
import { candidateDedupeKeys, dedupeFingerprintValues, fingerprintValues, RunDeduplicator } from "@/lib/leads/deduplication";
import { isPermanentlyClosed, isTemporarilyClosed } from "@/lib/leads/company-status";
import { validatePublicContacts } from "@/lib/leads/contact-validation";
import { inspectOwnedWebsite } from "@/lib/leads/digital-qualification";
import { validateCandidateBasics, type Candidate } from "@/lib/leads/eligibility";
import { evaluateNewLeadGate } from "@/lib/leads/intake-gate";
import { normalizeText } from "@/lib/leads/normalization";
import { precheckQualifiedLocation, recheckQualifiedDraft, type DeliverableContacts, type QualifiedDraftPayload } from "@/lib/leads/qualified-draft";
import { verifyWebsiteCandidate, type WebsiteVerificationResult } from "@/lib/leads/website-verification";
import { nextOverpassTileCursor, OSM_SEARCH_CURSOR_COUNT, overpassSearchPlan, type OverpassEvent } from "@/lib/openstreetmap/overpass";
import { prisma } from "@/lib/prisma";
import { enabledSourceAdapters } from "@/lib/sources/openstreetmap";
import { ensureLeadfinderTask, LEADFINDER_TASK_ID } from "./automation-tasks";
import { acquireJobLock } from "./lock";
import { candidateRetryStatus, generationCompletionStatus, isBatchDeadlineNear, isGenerationRunExpired, isReviewRetryReason, phaseProgress, shouldFetchFreshSource, shouldStopForSourceFailures, sourceAttemptDelta, terminalGenerationStatuses, terminalStatusForStoredLeads, unwrapGenerationCandidatePayload } from "./generation-state";

type Stats = {
  found: number;
  checked: number;
  withoutWebsite: number;
  duplicates: number;
  existing: number;
  rejected: number;
  stored: number;
  validDrafts: number;
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
    validDrafts: run.validDrafts,
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
    validDrafts: stats.validDrafts,
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

function capacity(stats: Stats) { return stats.stored + stats.validDrafts; }

export async function createGenerationRun(options: { continuousRequested?: boolean } = {}) {
  return prisma.$transaction(async (tx) => {
    const startedAt = new Date();
    const reusableDrafts = await tx.qualifiedLeadDraft.findMany({
      orderBy: { createdAt: "asc" },
      take: 10,
      select: { id: true, payload: true },
    });
    const retryCandidates = await tx.generationCandidate.findMany({
      where: {
        status: CandidateQueueStatus.PENDING,
        run: { status: { in: [JobStatus.COMPLETE, JobStatus.PARTIALLY_COMPLETED, JobStatus.FAILED, JobStatus.TIMED_OUT, JobStatus.CANCELLED] } },
      },
      orderBy: { updatedAt: "asc" },
      take: 16,
      select: { source: true, sourceRecordId: true, segment: true, payload: true, attempts: true, lastError: true },
    });
    const run = await tx.generationRun.create({
      data: {
        targetCount: 10,
        startedAt,
        continuousRequested: options.continuousRequested ?? false,
        stored: 0,
        validDrafts: 0,
        retryQueueCount: retryCandidates.length,
        currentPhase: "Zoekopdracht klaarzetten",
        progress: phaseProgress("queued"),
        message: reusableDrafts.length
          ? `${reusableDrafts.length} eerder gekwalificeerde concepten worden opnieuw gecontroleerd voordat de zoekopdracht verdergaat.`
          : "De zoekopdracht is gevalideerd en staat klaar.",
        heartbeatAt: startedAt,
      },
    });
    if (reusableDrafts.length) {
      await tx.qualifiedLeadDraft.updateMany({
        where: { id: { in: reusableDrafts.map(({ id }) => id) } },
        data: { runId: run.id, validatedAt: null },
      });
    }
    const reusableCandidates = reusableDrafts.flatMap(({ payload }) => {
      const draft = payload as unknown as QualifiedDraftPayload;
      return draft.candidate?.externalPlaceId ? [{
        runId: run.id,
        source: draft.candidate.source ?? "OPENSTREETMAP",
        sourceRecordId: draft.candidate.externalPlaceId,
        segment: "reusable-qualified-draft",
        payload: JSON.parse(JSON.stringify(draft.candidate)) as Prisma.InputJsonValue,
      }] : [];
    });
    const reusableRetryCandidates = retryCandidates.flatMap((candidate) => {
      try {
        const normalized = unwrapGenerationCandidatePayload(candidate.payload, candidate.sourceRecordId);
        return [{
          ...candidate,
          runId: run.id,
          payload: JSON.parse(JSON.stringify(normalized)) as Prisma.InputJsonValue,
        }];
      } catch {
        return [];
      }
    });
    await tx.generationCandidate.createMany({
      data: [
        ...reusableRetryCandidates,
        ...reusableCandidates,
      ],
      skipDuplicates: true,
    });
    return run;
  });
}

export async function markStaleGenerationRuns(now = new Date()) {
  const env = serverEnv();
  const staleBefore = new Date(now.getTime() - env.GENERATION_WATCHDOG_SECONDS * 1000);
  await prisma.generationCandidate.updateMany({
    where: {
      status: "PROCESSING",
      claimedAt: { lt: staleBefore },
    },
    data: { status: "PENDING", claimedAt: null, lastError: "Onderbroken batch automatisch vrijgegeven." },
  });
  return prisma.generationRun.updateMany({
    where: {
      status: JobStatus.RUNNING,
      updatedAt: { lt: staleBefore },
    },
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
  if (!active) {
    const latest = runId
      ? await prisma.generationRun.findUnique({ where: { id: runId } })
      : await prisma.generationRun.findFirst({ where: { continuousRequested: true }, orderBy: { createdAt: "desc" } });
    if (!latest) return null;
    return prisma.generationRun.update({
      where: { id: latest.id },
      data: { continuousRequested: false, cancelRequested: true },
    });
  }
  return prisma.generationRun.update({
    where: { id: active.id },
    data: {
      cancelRequested: true,
      continuousRequested: false,
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
  const fingerprints = [...new Set(entries.flatMap(({ keys }) => dedupeFingerprintValues(keys).map(({ fingerprint }) => fingerprint)))];
  const [sourceRecords, leads, suppressed, exclusions] = await Promise.all([
    prisma.sourceRecord.findMany({
      where: { OR: entries.map(({ candidate }) => ({ source: candidate.source ?? "OPENSTREETMAP", sourceRecordId: candidate.externalPlaceId })) },
      select: { source: true, sourceRecordId: true, decision: true },
    }),
    prisma.lead.findMany({
      where: { OR: [
        { externalPlaceId: { in: entries.map(({ candidate }) => candidate.externalPlaceId) } },
        { normalizedPhoneNumber: { in: entries.flatMap(({ keys }) => keys.phone ? [keys.phone] : []) } },
        { email: { in: entries.flatMap(({ keys }) => keys.email ? [keys.email] : []) } },
        { normalizedDomain: { in: entries.flatMap(({ keys }) => keys.domain ? [keys.domain] : []) } },
        ...entries.map(({ candidate }) => ({ normalizedCompanyName: normalizeText(candidate.companyName), normalizedAddress: normalizeText(candidate.streetAddress) })),
      ] },
      select: { externalPlaceId: true, normalizedPhoneNumber: true, email: true, normalizedDomain: true, normalizedCompanyName: true, normalizedAddress: true },
    }),
    prisma.suppressedLead.findMany({ where: { fingerprint: { in: fingerprints } }, select: { fingerprint: true } }),
    prisma.leadExclusion.findMany({ where: { identityKey: { in: fingerprints }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { identityKey: true } }),
  ]);
  const priorSources = new Set(sourceRecords
    .filter(({ decision }) => decision && !["retry", "qualified_draft"].includes(decision))
    .map(({ source, sourceRecordId }) => `${source}:${sourceRecordId}`));
  const blocked = new Set([...suppressed.map(({ fingerprint }) => fingerprint), ...exclusions.map(({ identityKey }) => identityKey)]);
  return new Map(entries.map(({ candidate, keys }) => {
    let reason: string | null = null;
    if (priorSources.has(`${candidate.source ?? "OPENSTREETMAP"}:${candidate.externalPlaceId}`) || leads.some((lead) => lead.externalPlaceId === candidate.externalPlaceId)) reason = "duplicate_source_id";
    else if (keys.domain && leads.some((lead) => lead.normalizedDomain === keys.domain)) reason = "duplicate_domain";
    else if (keys.email && leads.some((lead) => lead.email === keys.email)) reason = "duplicate_email";
    else if (keys.phone && leads.some((lead) => lead.normalizedPhoneNumber === keys.phone)) reason = "duplicate_phone";
    else if (leads.some((lead) => lead.normalizedCompanyName === normalizeText(candidate.companyName) && lead.normalizedAddress === normalizeText(candidate.streetAddress))) reason = "duplicate_name_address";
    else if (dedupeFingerprintValues(keys).some(({ fingerprint }) => blocked.has(fingerprint))) reason = "previously_rejected";
    return [candidate.externalPlaceId, reason] as const;
  }));
}

async function excludeCandidate(candidate: Candidate, verification: WebsiteVerificationResult) {
  const keys = candidateDedupeKeys(candidate);
  await Promise.all(dedupeFingerprintValues(keys).map(({ fingerprint: identityKey }) => prisma.leadExclusion.upsert({
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

type LeadWriteClient = typeof prisma | Prisma.TransactionClient;
async function insertQualifiedLead(
  db: LeadWriteClient,
  candidate: Candidate,
  verification: WebsiteVerificationResult,
  contacts: DeliverableContacts,
  batchId?: string,
) {
  const basic = validateCandidateBasics(candidate);
  if (!basic.ok) throw new Error(`Kandidaat verloor kwalificatie tijdens definitieve opslag: ${basic.reason}`);
  const dedupeFingerprint = fingerprintValues(candidateDedupeKeys(candidate))[0]?.fingerprint;
  const lead = await db.lead.create({ data: {
    externalPlaceId: basic.lead.externalPlaceId,
    companyName: basic.lead.companyName,
    normalizedCompanyName: basic.lead.normalizedCompanyName,
    phoneNumber: basic.lead.phoneNumber || contacts.phone,
    normalizedPhoneNumber: contacts.phone,
    internationalPhoneNumber: basic.lead.internationalPhoneNumber || contacts.phone,
    phoneValidationStatus: contacts.phoneStatus,
    phoneValidationSource: contacts.phoneSource,
    phoneValidatedAt: contacts.phoneValidatedAt,
    email: contacts.email,
    emailValidationStatus: contacts.emailStatus,
    emailValidationSource: contacts.emailSource,
    emailValidatedAt: contacts.emailValidatedAt,
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
    chatbotStatus: verification.chatbotStatus ?? (verification.website ? "UNKNOWN" : "NOT_PRESENT"),
    chatbotStatusReason: verification.chatbotReason ?? (verification.website ? "Chatbotcontrole niet beschikbaar." : "Er is geen zelfstandige website waarop een chatwidget kan draaien."),
    chainStatus: "INDEPENDENT",
    qualificationReason: verification.reason,
    batchId,
    dedupeFingerprint,
    sourceUrl: basic.lead.sourceUrl ?? basic.lead.googleMapsUrl,
    sourceFetchedAt: basic.lead.fetchedAt ? new Date(basic.lead.fetchedAt) : new Date(),
    leadType: verification.website
      ? ["WEBSITE_OUTDATED", "WEBSITE_BROKEN"].includes(verification.status) ? "OUTDATED_WEBSITE" : "IMPROVABLE_WEBSITE"
      : "NO_WEBSITE",
    opportunityScore: verification.website ? 80 : 90,
    conversionQualityScore: 0,
    businessStatus: basic.lead.businessStatus,
    source: candidate.source ?? "OPENSTREETMAP",
    confidenceScore: basic.lead.confidenceScore,
    confidenceLevel: basic.lead.confidenceLevel,
    status: "NEW",
    isActive: true,
    isFiltered: false,
    filterReason: null,
    evidence: { create: verification.evidence },
    activities: { create: { type: "LEAD_GENERATED", summary: verification.reason, details: { source: candidate.source, websiteStatus: verification.status, batchId } } },
    history: { create: { event: "LEAD_GENERATED", details: { source: candidate.source, websiteStatus: verification.status, batchId } } },
  } });
  await db.sourceRecord.update({
    where: { source_sourceRecordId: { source: candidate.source ?? "OPENSTREETMAP", sourceRecordId: candidate.externalPlaceId } },
    data: {
      leadId: lead.id,
      decision: "stored",
      reasonCode: verification.status.toLowerCase(),
      processedAt: new Date(),
    },
  });
  for (const item of fingerprintValues(candidateDedupeKeys(candidate))) {
    await db.duplicateFingerprint.upsert({
      where: { fingerprint: item.fingerprint },
      create: { ...item, leadId: lead.id },
      update: { leadId: lead.id },
    });
  }
  return lead;
}

export async function storeNewLead(candidate: Candidate, verification: WebsiteVerificationResult, batchId?: string) {
  const gate = evaluateNewLeadGate(candidate, verification);
  if (!gate.allowed) return { stored: false, reviewOnly: false, reason: gate.reason, leadId: undefined };
  const basic = validateCandidateBasics(candidate);
  if (!basic.ok) return { stored: false, reviewOnly: false, reason: basic.reason, leadId: undefined };
  const contacts = await validatePublicContacts(candidate);
  if (!contacts.ok) return { stored: false, reviewOnly: false, reason: contacts.reason, leadId: undefined };
  const lead = await insertQualifiedLead(prisma, candidate, verification, contacts, batchId);
  return { stored: true, reviewOnly: false, reason: verification.reason, leadId: lead.id };
}

export async function stageQualifiedLead(runId: string, candidate: Candidate, verification: WebsiteVerificationResult) {
  const gate = evaluateNewLeadGate(candidate, verification);
  if (!gate.allowed) return { stored: false, staged: false, reviewOnly: false, reason: gate.reason, leadId: undefined };
  const basic = validateCandidateBasics(candidate);
  if (!basic.ok) return { stored: false, staged: false, reviewOnly: false, reason: basic.reason, leadId: undefined };
  const contacts = await validatePublicContacts(candidate);
  if (!contacts.ok) return { stored: false, staged: false, reviewOnly: false, reason: contacts.reason, leadId: undefined };
  const fingerprint = fingerprintValues(candidateDedupeKeys(candidate))[0]?.fingerprint;
  if (!fingerprint) return { stored: false, staged: false, reviewOnly: false, reason: "missing_fingerprint", leadId: undefined };
  const payload = JSON.parse(JSON.stringify({ candidate, verification, contacts })) as Prisma.InputJsonValue;
  const qualification = recheckQualifiedDraft(payload as unknown as QualifiedDraftPayload);
  if (!qualification.valid) {
    return { stored: false, staged: false, reviewOnly: qualification.retry, reason: qualification.reason, leadId: undefined };
  }
  try {
    await prisma.qualifiedLeadDraft.upsert({
      where: { fingerprint },
      create: {
        runId,
        fingerprint,
        payload,
        validatedAt: new Date(),
      },
      update: { runId, payload, validatedAt: new Date() },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { stored: false, staged: false, reviewOnly: false, reason: "duplicate_draft", leadId: undefined };
    }
    throw error;
  }
  return { stored: false, staged: true, reviewOnly: false, reason: verification.reason, leadId: undefined };
}

async function duplicateReasonInTransaction(tx: Prisma.TransactionClient, candidate: Candidate) {
  const keys = candidateDedupeKeys(candidate);
  const lead = await tx.lead.findFirst({
    where: {
      OR: [
        { externalPlaceId: candidate.externalPlaceId },
        ...(keys.phone ? [{ normalizedPhoneNumber: keys.phone }] : []),
        ...(keys.email ? [{ email: keys.email }] : []),
        ...(keys.domain ? [{ normalizedDomain: keys.domain }] : []),
        { normalizedCompanyName: normalizeText(candidate.companyName), normalizedAddress: normalizeText(candidate.streetAddress) },
      ],
    },
    select: { id: true },
  });
  if (lead) return "duplicate_lead";
  const fingerprints = dedupeFingerprintValues(keys).map(({ fingerprint }) => fingerprint);
  if (!fingerprints.length) return null;
  const [suppressed, excluded] = await Promise.all([
    tx.suppressedLead.findFirst({ where: { fingerprint: { in: fingerprints } }, select: { id: true } }),
    tx.leadExclusion.findFirst({
      where: { identityKey: { in: fingerprints }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      select: { id: true },
    }),
  ]);
  return suppressed || excluded ? "previously_rejected" : null;
}

export type FinalizationResult = {
  inserted: number;
  totalStored: number;
  invalid: number;
  duplicates: number;
};

/**
 * Publishes every independently valid draft in one serializable transaction.
 * Invalid and duplicate drafts remain durable; successful drafts are deleted
 * only in the same transaction that demonstrably created their Lead records.
 */
export async function finalizeQualifiedDrafts(runId: string): Promise<FinalizationResult> {
  return prisma.$transaction(async (tx) => {
    const drafts = await tx.qualifiedLeadDraft.findMany({
      where: { runId, validatedAt: { not: null } },
      orderBy: { createdAt: "asc" },
    });
    let inserted = 0;
    let invalid = 0;
    let duplicates = 0;
    for (const draft of drafts) {
      const payload = draft.payload as unknown as QualifiedDraftPayload;
      const qualification = recheckQualifiedDraft(payload);
      if (!qualification.valid) {
        invalid += 1;
        await tx.generationCandidate.updateMany({
          where: {
            runId,
            source: payload.candidate.source ?? "OPENSTREETMAP",
            sourceRecordId: payload.candidate.externalPlaceId,
          },
          data: {
            status: qualification.retry ? CandidateQueueStatus.PENDING : CandidateQueueStatus.PROCESSED,
            claimedAt: null,
            lastError: qualification.reason,
          },
        });
        continue;
      }
      const duplicate = await duplicateReasonInTransaction(tx, payload.candidate);
      if (duplicate) {
        duplicates += 1;
        await tx.generationCandidate.updateMany({
          where: {
            runId,
            source: payload.candidate.source ?? "OPENSTREETMAP",
            sourceRecordId: payload.candidate.externalPlaceId,
          },
          data: { status: CandidateQueueStatus.PROCESSED, claimedAt: null, lastError: duplicate },
        });
        continue;
      }
      const lead = await insertQualifiedLead(
        tx,
        payload.candidate,
        payload.verification,
        qualification.contacts,
        runId,
      );
      const readBack = await tx.lead.findUnique({
        where: { id: lead.id },
        select: { id: true, status: true },
      });
      if (!readBack || readBack.status !== "NEW") throw new Error("LEAD_DATABASE_READBACK_FAILED");
      await tx.qualifiedLeadDraft.delete({ where: { id: draft.id } });
      inserted += 1;
    }
    const totalStored = await tx.lead.count({ where: { batchId: runId } });
    return { inserted, totalStored, invalid, duplicates };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 });
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

async function finishGenerationRunWithLockHeld(runId: string, cause: string) {
  await prisma.generationCandidate.updateMany({
    where: { runId, status: CandidateQueueStatus.PROCESSING },
    data: {
      status: CandidateQueueStatus.PENDING,
      claimedAt: null,
      lastError: "De deadline is bereikt voordat deze kandidatencontrole kon worden afgerond.",
    },
  });
  const before = await prisma.generationRun.findUniqueOrThrow({ where: { id: runId } });
  if (terminalStatuses.has(before.status)) return before;
  const stats = statsFromRun(before);
  const result = await finalizeQualifiedDrafts(runId);
  const [pendingCandidates, retryQueueCount] = await Promise.all([
    prisma.generationCandidate.count({ where: { runId, status: CandidateQueueStatus.PENDING } }),
    prisma.generationCandidate.count({
      where: { runId, status: { in: [CandidateQueueStatus.PENDING, CandidateQueueStatus.FAILED] } },
    }),
  ]);
  stats.stored = result.totalStored;
  stats.validDrafts = 0;
  stats.duplicates += result.duplicates;
  const places = stringArray(before.placesUsed);
  const errors = stringArray(before.apiErrors);
  const warnings = stringArray(before.warnings);
  const status = terminalStatusForStoredLeads(result.totalStored) === "PARTIALLY_COMPLETED"
    ? JobStatus.PARTIALLY_COMPLETED
    : JobStatus.COMPLETE;
  const leadText = result.totalStored === 1
    ? "1 volledig gekwalificeerde lead is opgeslagen in pipelinefase Nieuw."
    : `${result.totalStored} volledig gekwalificeerde leads zijn opgeslagen in pipelinefase Nieuw.`;
  const retryText = retryQueueCount === 1
    ? "1 onzekere kandidaat blijft bewaard voor een volgende run."
    : `${retryQueueCount} onzekere kandidaten blijven bewaard voor een volgende run.`;
  const prefix = "De zoekrun is veilig afgerond.";
  const noResultReason = result.totalStored === 0
    ? ` Er is niets opgeslagen omdat geen enkel concept bij de eindcontrole volledig aan alle kwalificatie-eisen voldeed.${result.invalid ? ` ${result.invalid} concepten vielen bij de eindcontrole af.` : ""}`
    : "";
  await terminalRun(
    runId,
    status,
    stats,
    places,
    errors,
    warnings,
    `${prefix} ${leadText} ${retryText}${noResultReason} ${cause}`.trim(),
  );
  return prisma.generationRun.update({
    where: { id: runId },
    data: { pendingCandidates, retryQueueCount, validDrafts: 0 },
  });
}

export async function finishGenerationRun(runId: string, cause: string, lockAlreadyHeld = false) {
  if (lockAlreadyHeld) return finishGenerationRunWithLockHeld(runId, cause);
  const env = serverEnv();
  const lock = await acquireJobLock(
    `lead-generation:${runId}`,
    (env.GENERATION_BATCH_DURATION_SECONDS + 10) * 1000,
  );
  if (!lock) {
    return prisma.generationRun.findUniqueOrThrow({ where: { id: runId } });
  }
  try {
    return await finishGenerationRunWithLockHeld(runId, cause);
  } finally {
    await lock.release();
  }
}

function candidateFromQueue(row: GenerationCandidate): Candidate {
  return unwrapGenerationCandidatePayload(row.payload, row.sourceRecordId);
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
    const [draftCount, finalizedCount] = await Promise.all([
      prisma.qualifiedLeadDraft.count({ where: { runId, validatedAt: { not: null } } }),
      prisma.lead.count({ where: { batchId: runId } }),
    ]);
    stats.validDrafts = draftCount;
    stats.stored = finalizedCount;
    run = await prisma.generationRun.update({
      where: { id: runId },
      data: {
        status: JobStatus.RUNNING,
        startedAt: run.startedAt,
        batchNumber: { increment: 1 },
        currentPhase: "Zoekopdracht valideren",
        progress: Math.max(run.progress, phaseProgress("validate")),
        message: "De volgende begrensde batch wordt vanaf de opgeslagen cursor voorbereid.",
        heartbeatAt: new Date(),
      },
    });
    if (finalizedCount >= run.targetCount) {
      return finishGenerationRun(runId, "Het maximum van 10 volledig gekwalificeerde leads is bereikt.", true);
    }
    if (run.cancelRequested) return terminalRun(runId, JobStatus.CANCELLED, stats, places, errors, warnings, "De zoekrun is geannuleerd.");
    if (isGenerationRunExpired(run.startedAt, 0)) {
      return finishGenerationRun(runId, "De maximale zoektijd van 10 minuten is bereikt vóór een nieuwe kandidatenbatch.", true);
    }
    let queued = await prisma.generationCandidate.findMany({
      where: { runId, status: CandidateQueueStatus.PENDING },
      orderBy: [{ attempts: "asc" }, { createdAt: "asc" }],
      take: env.GENERATION_BATCH_CANDIDATES,
    });

    if (shouldFetchFreshSource({
      queuedCount: queued.length,
      queuedOnlyRetries: queued.length > 0 && queued.every(({ attempts }) => attempts > 0),
      batchNumber: run.batchNumber,
    })) {
      if (run.processedSegments >= env.GENERATION_MAX_SOURCE_CALLS) {
        return finishGenerationRun(runId, "De beschikbare openbare zoeksegmenten voor deze run zijn verwerkt.", true);
      }
      const adapters = enabledSourceAdapters();
      if (!adapters.length) throw new Error("Er is geen gratis databron ingeschakeld.");
      const selected = await nextSearchArea();
      if (!selected) return finishGenerationRun(runId, "Er zijn geen openbare zoekgebieden beschikbaar.", true);
      const { area, combination, tileCursor } = selected;
      const adapter = adapters[0];
      const region = `${area.city}, ${area.country}`;
      const tileLabel = overpassSearchPlan(tileCursor).id;
      const segment = `${area.country}:${area.city}:${area.category}:${tileLabel}`;

      await prisma.generationRun.update({ where: { id: runId }, data: {
        currentPhase: "Openbare bedrijfsvermeldingen ophalen", currentSource: adapter.id, currentRegion: region,
        currentCategory: area.category, currentTile: tileLabel, continuationCursor: segment,
        message: `Zoektegel ${tileLabel} voor ${area.category} in ${region} wordt met een eigen requesttimeout opgehaald.`, heartbeatAt: new Date(),
      } });

      try {
        if (isGenerationRunExpired(run.startedAt, 0)) {
          return finishGenerationRun(runId, "De maximale zoektijd van 10 minuten is bereikt vóór een nieuw bronverzoek.", true);
        }
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
        const attemptDelta = sourceAttemptDelta(true);
        warnings.push(...result.warnings);
        if (!places.includes(segment)) places.push(segment);
        await prisma.$transaction([
          prisma.coverageArea.update({ where: { id: area.id }, data: { lastScannedAt: new Date(), resultsFound: { increment: queuedResult.count } } }),
          prisma.searchCombination.update({ where: { id: combination.id }, data: {
            useCount: { increment: 1 }, candidatesFound: { increment: queuedResult.count }, lastUsedAt: new Date(),
            tileCursor: nextOverpassTileCursor(tileCursor, true), lastTile: result.tile, lastError: null,
          } }),
          prisma.generationRun.update({ where: { id: runId }, data: { processedSegments: { increment: attemptDelta.processedSegments }, lastError: null } }),
        ]);
        run.processedSegments += attemptDelta.processedSegments;
        batchMessage = `${queuedResult.count} nieuwe kandidaten zijn duurzaam in de controlequeue gezet.`;
      } catch (error) {
        const message = errorMessage(error);
        const attemptDelta = sourceAttemptDelta(false);
        stats.sourceFailures += attemptDelta.sourceFailures;
        errors.push(`${adapter.id} / ${region} / ${area.category}: ${message}`);
        batchMessage = `Deze bronbatch mislukte zonder eerdere resultaten te verliezen. De volgende zoekcombinatie wordt geprobeerd.`;
        await Promise.all([
          logSource(runId, adapter.id, "ERROR", JSON.stringify({ jobId: runId, batchNumber: run.batchNumber, step: "source_failed", region, category: area.category, tile: tileLabel, errorCode: "SOURCE_ERROR", message }), area.city, area.category),
          prisma.coverageArea.update({ where: { id: area.id }, data: { lastScannedAt: new Date() } }),
          prisma.searchCombination.update({ where: { id: combination.id }, data: { useCount: { increment: 1 }, lastUsedAt: new Date(), tileCursor: nextOverpassTileCursor(tileCursor, false), lastTile: tileLabel, lastError: message } }),
          prisma.generationRun.update({ where: { id: runId }, data: { lastError: message } }),
        ]);
        if (shouldStopForSourceFailures({ sourceFailures: stats.sourceFailures, processedSegments: run.processedSegments, maxFailures: env.GENERATION_MAX_SOURCE_FAILURES })) {
          if (stats.validDrafts > 0) {
            return finishGenerationRun(runId, `De gratis openbare bron bleef na ${stats.sourceFailures} pogingen onbereikbaar.`, true);
          }
          return terminalRun(
            runId,
            JobStatus.FAILED,
            stats,
            places,
            errors,
            warnings,
            `Er zijn geen leads opgeslagen. De gratis openbare bron bleef na ${stats.sourceFailures} pogingen overwegend onbereikbaar; kandidaten blijven bewaard voor een volgende poging.`,
          );
        }
      }

      queued = await prisma.generationCandidate.findMany({
        where: { runId, status: CandidateQueueStatus.PENDING },
        orderBy: [{ attempts: "asc" }, { createdAt: "asc" }],
        take: env.GENERATION_BATCH_CANDIDATES,
      });
    }

    if (queued.length) {
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
    const knownReasons = queued.length ? await knownCandidateReasons(queued.map(candidateFromQueue)) : new Map<string, string | null>();
    for (const row of queued) {
      if (isGenerationRunExpired(run.startedAt, 0)) {
        releaseIds.push(row.id);
        continue;
      }
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
      const locationGate = precheckQualifiedLocation(candidate);
      if (locationGate) {
        if (locationGate.retry) {
          if (row.attempts === 0) stats.manualReview += 1;
          retriedThisBatch += 1;
          await markDecision(candidate, "retry", locationGate.reason);
          await finishQueueItem(
            row.id,
            candidateRetryStatus(row.attempts + 1) === "FAILED" ? CandidateQueueStatus.FAILED : CandidateQueueStatus.PENDING,
            locationGate.reason,
          );
        } else {
          stats.rejected += 1;
          await markDecision(candidate, "rejected", locationGate.reason);
          await finishQueueItem(row.id, CandidateQueueStatus.PROCESSED, locationGate.reason);
        }
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

    if (isGenerationRunExpired(run.startedAt, 0)) {
      await releaseQueueItems(verificationWork.map(({ row }) => row.id), "De tienminutendeadline is bereikt vóór deze kandidatencontrole.");
      verificationWork.length = 0;
    }

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
        if (isGenerationRunExpired(run.startedAt, 0)) {
          retriedThisBatch += 1;
          await markDecision(candidate, "retry", "deadline_before_final_checks");
          await finishQueueItem(row.id, CandidateQueueStatus.PENDING, "De deadline verstreek voordat de resterende controles konden starten.");
          continue;
        }
        let verification = result.value;
        if (verification.status === "WEBSITE_FOUND" && verification.website) {
          const inspected = await inspectOwnedWebsite(verification.website);
          verification = { ...inspected, evidence: [...verification.evidence, ...inspected.evidence] };
        }
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
            if (row.attempts === 0) stats.manualReview += 1;
            retriedThisBatch += 1;
            await markDecision(candidate, "retry", gate.reason);
          }
          const queueStatus = isReviewRetryReason(gate.reason)
            ? candidateRetryStatus(row.attempts + 1) === "FAILED" ? CandidateQueueStatus.FAILED : CandidateQueueStatus.PENDING
            : CandidateQueueStatus.PROCESSED;
          await finishQueueItem(row.id, queueStatus, gate.detail);
          continue;
        }
        if (isGenerationRunExpired(run.startedAt, 0)) {
          retriedThisBatch += 1;
          await markDecision(candidate, "retry", "deadline_before_final_checks");
          await finishQueueItem(row.id, CandidateQueueStatus.PENDING, "De deadline verstreek vóór de e-mail/MX- en telefooncontrole kon starten.");
          continue;
        }
        const databaseStarted = Date.now();
        try {
          await prisma.generationRun.update({ where: { id: runId }, data: { currentPhase: "Resultaat veilig opslaan", heartbeatAt: new Date() } });
          const saved = await storeNewLead(candidate, verification, runId);
          if (saved.stored) {
            stats.stored += 1;
            if (verification.website) stats.websitesFound += 1;
            if (verification.status === "WEBSITE_OUTDATED" || verification.status === "WEBSITE_BROKEN") stats.outdatedWebsite += 1;
            else if (verification.website) stats.improvableWebsite += 1;
            else { stats.withoutWebsite += 1; stats.noWebsite += 1; }
            await markDecision(candidate, "stored", verification.status.toLowerCase());
          } else {
            if (isReviewRetryReason(saved.reason)) {
              if (row.attempts === 0) stats.manualReview += 1;
              retriedThisBatch += 1;
              await markDecision(candidate, "retry", saved.reason);
              await finishQueueItem(
                row.id,
                candidateRetryStatus(row.attempts + 1) === "FAILED" ? CandidateQueueStatus.FAILED : CandidateQueueStatus.PENDING,
                saved.reason,
              );
              continue;
            }
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
    const [pendingCandidates, retryQueueCount] = await Promise.all([
      prisma.generationCandidate.count({ where: { runId, status: CandidateQueueStatus.PENDING } }),
      prisma.generationCandidate.count({ where: { runId, status: { in: [CandidateQueueStatus.PENDING, CandidateQueueStatus.FAILED] } } }),
    ]);
    if (isGenerationRunExpired(run.startedAt, 0)) {
      return finishGenerationRun(runId, "De maximale zoektijd van 10 minuten is bereikt.", true);
    }
    const completionStatus = generationCompletionStatus({ usable: capacity(stats), target: run.targetCount, processedSegments: run.processedSegments, maxSegments: env.GENERATION_MAX_SOURCE_CALLS, pendingCandidates });
    if (completionStatus === "COMPLETE" && capacity(stats) >= run.targetCount) {
      return finishGenerationRun(runId, "Het maximum van 10 volledig gekwalificeerde leads is bereikt.", true);
    }
    if (completionStatus) {
      return finishGenerationRun(runId, "De beschikbare zoekruimte voor deze run is verwerkt.", true);
    }

    const durationMs = Date.now() - batchStartedAt;
    const event = { jobId: runId, batchNumber: run.batchNumber, step: "batch_completed", durationMs, candidates: queued.length,
      checked: stats.checked - run.candidatesChecked, stored: stats.validDrafts - run.validDrafts, manualReview: stats.manualReview - run.manualReview,
      retries: retriedThisBatch, sourceFailures: stats.sourceFailures - run.sourceFailures, validationDurationMs, databaseDurationMs };
    console.info(JSON.stringify(event));
    await logSource(runId, run.currentSource ?? "GENERATION", "INFO", JSON.stringify(event), run.currentRegion ?? undefined, run.currentCategory ?? undefined);
    return prisma.generationRun.update({ where: { id: runId }, data: {
      ...runData(stats, places, errors, warnings), status: JobStatus.RUNNING,
      pendingCandidates, retryQueueCount, retriedCandidates: { increment: retriedThisBatch }, lastBatchDurationMs: durationMs,
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

export async function runGenerationWatchdog(now = new Date()) {
  const watchdogLock = await acquireJobLock("lead-generation-watchdog", 70_000);
  if (!watchdogLock) return { active: true, processed: false, reason: "watchdog_already_running" };
  try {
    const task = await ensureLeadfinderTask();
    if (!task.enabled) return { active: false, processed: false, reason: "task_paused", taskName: task.name };
    await markStaleGenerationRuns(now);
    const activeRuns = await prisma.generationRun.findMany({
      where: { status: { in: [JobStatus.PENDING, JobStatus.RUNNING] } },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    });
    let active = activeRuns[0] ?? null;
    const duplicates = activeRuns.slice(1);
    if (duplicates.length) {
      await prisma.generationRun.updateMany({
        where: { id: { in: duplicates.map(({ id }) => id) } },
        data: {
          status: JobStatus.CANCELLED,
          cancelRequested: true,
          continuousRequested: false,
          progress: 100,
          currentPhase: "Dubbele achtergrondrun opgeruimd",
          message: "Veilig beëindigd omdat één permanente Leadfinder-taak alle zoekbatches verwerkt.",
          stopReason: "Dubbele achtergrondrun veilig beëindigd.",
          finishedAt: now,
          heartbeatAt: now,
        },
      });
    }
    if (!active) {
      active = await createGenerationRun({ continuousRequested: true });
    } else if (!active.continuousRequested || active.cancelRequested) {
      active = await prisma.generationRun.update({
        where: { id: active.id },
        data: { continuousRequested: true, cancelRequested: false },
      });
    }
    await prisma.leadfinderTask.update({
      where: { id: LEADFINDER_TASK_ID },
      data: { status: "RUNNING", currentRunId: active.id, lastRunId: active.id, lastHeartbeatAt: now, lastError: null },
    });
    if (isGenerationRunExpired(active.startedAt, 0, now)) {
      const finished = await finishGenerationRun(active.id, "De maximale zoektijd van 10 minuten is bereikt.");
      await prisma.generationRun.update({ where: { id: finished.id }, data: { continuousRequested: false } });
      const next = await createGenerationRun({ continuousRequested: true });
      await prisma.leadfinderTask.update({
        where: { id: LEADFINDER_TASK_ID },
        data: { status: "RUNNING", currentRunId: next.id, lastRunId: next.id, lastHeartbeatAt: now },
      });
      return { active: true, processed: true, runId: next.id, status: next.status, taskName: task.name, duplicatesRemoved: duplicates.length };
    }
    const run = await processGenerationBatch(active.id);
    if (terminalStatuses.has(run.status)) {
      await prisma.generationRun.update({ where: { id: run.id }, data: { continuousRequested: false } });
      const next = await createGenerationRun({ continuousRequested: true });
      await prisma.leadfinderTask.update({
        where: { id: LEADFINDER_TASK_ID },
        data: { status: "RUNNING", currentRunId: next.id, lastRunId: next.id, lastHeartbeatAt: new Date(), lastError: null },
      });
      return { active: true, processed: true, runId: next.id, status: next.status, taskName: task.name, duplicatesRemoved: duplicates.length };
    }
    await prisma.leadfinderTask.update({
      where: { id: LEADFINDER_TASK_ID },
      data: { status: "RUNNING", currentRunId: run.id, lastRunId: run.id, lastHeartbeatAt: new Date(), lastError: null },
    });
    return {
      active: true,
      processed: true,
      runId: run.id,
      status: run.status,
      taskName: task.name,
      duplicatesRemoved: duplicates.length,
    };
  } catch (error) {
    await prisma.leadfinderTask.updateMany({
      where: { id: LEADFINDER_TASK_ID },
      data: { status: "ERROR", lastHeartbeatAt: new Date(), lastError: errorMessage(error) },
    });
    throw error;
  } finally {
    await watchdogLock.release();
  }
}
