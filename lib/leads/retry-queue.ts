import { CandidateQueueStatus, JobStatus, Prisma, ValidationCandidateStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { Candidate } from "./eligibility";
import type { WebsiteVerificationResult } from "./website-verification";

const baseRetryDelayMs = 15 * 60_000;
const maxRetryDelayMs = 24 * 60 * 60_000;
export const defaultMaxValidationRetries = 5;

export function validationErrorCode(reason: string) {
  if (/429|rate.?limit/i.test(reason)) return "RATE_LIMIT";
  if (/timeout|timed out|abort/i.test(reason)) return "TIMEOUT";
  if (/database/i.test(reason)) return "DATABASE_ERROR";
  if (/status|temporar/i.test(reason)) return "STATUS_CHECK_FAILED";
  if (/website|dns|domain|ssl|network|blocked/i.test(reason)) return "WEBSITE_CHECK_FAILED";
  return "VALIDATION_CONFLICT";
}

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function validationRetryDelayMs(retryCount: number) {
  return Math.min(maxRetryDelayMs, baseRetryDelayMs * (2 ** Math.min(6, Math.max(0, retryCount))));
}

export function validationConfidence(candidate: Candidate, verification?: WebsiteVerificationResult) {
  const identity = candidate.externalPlaceId && candidate.companyName.trim() ? 90 : 30;
  const location = Number.isFinite(candidate.latitude) && Number.isFinite(candidate.longitude) && candidate.city.trim() ? 85 : 35;
  const website = verification?.confidence ?? 0;
  const business = /CLOSED|DISUSED|ABANDONED/i.test(candidate.businessStatus ?? "") ? 0 : candidate.activitySignals?.length ? 90 : 70;
  return {
    identity,
    location,
    website,
    business,
    total: Math.round(identity * 0.25 + location * 0.2 + website * 0.35 + business * 0.2),
  };
}

export async function queueValidationRetry(input: {
  runId: string;
  candidate: Candidate;
  reason: string;
  verification?: WebsiteVerificationResult;
  now?: Date;
}) {
  const { runId, candidate, verification } = input;
  const source = candidate.source ?? "OPENSTREETMAP";
  const now = input.now ?? new Date();
  const existing = await prisma.validationCandidate.findUnique({
    where: { source_sourceRecordId: { source, sourceRecordId: candidate.externalPlaceId } },
    select: { retryCount: true, maxRetries: true },
  });
  const retryCount = existing?.retryCount ?? 0;
  const maxRetries = existing?.maxRetries ?? defaultMaxValidationRetries;
  const confidence = validationConfidence(candidate, verification);
  const errorCode = validationErrorCode(input.reason);
  const exhausted = retryCount >= maxRetries;
  const values = {
    originRunId: runId,
    companyName: candidate.companyName,
    streetAddress: candidate.streetAddress,
    city: candidate.city,
    country: candidate.country.toUpperCase(),
    phone: candidate.internationalPhoneNumber || candidate.phoneNumber || null,
    email: candidate.email || null,
    possibleWebsite: verification?.website || candidate.website || null,
    websiteStatus: verification?.status ?? "CHECK_FAILED",
    businessStatus: candidate.businessStatus ?? "UNKNOWN",
    identityConfidence: confidence.identity,
    locationConfidence: confidence.location,
    websiteConfidence: confidence.website,
    businessConfidence: confidence.business,
    totalConfidence: confidence.total,
    failureReason: input.reason.slice(0, 500),
    maxRetries,
    nextRetryAt: exhausted ? now : new Date(now.getTime() + validationRetryDelayMs(retryCount)),
    lastErrorCode: errorCode,
    lastErrorMessage: input.reason.slice(0, 500),
    lastProvider: source,
    lastCheckedAt: now,
    payload: json(candidate),
    verificationEvidence: verification ? json(verification.evidence) : Prisma.JsonNull,
    status: exhausted ? ValidationCandidateStatus.EXHAUSTED : ValidationCandidateStatus.RETRY_SCHEDULED,
    promotedLeadId: null,
    validatedAt: null,
    rejectedAt: null,
  } as const;
  return prisma.validationCandidate.upsert({
    where: { source_sourceRecordId: { source, sourceRecordId: candidate.externalPlaceId } },
    create: { source, sourceRecordId: candidate.externalPlaceId, ...values },
    update: values,
  });
}

export async function importDueValidationRetries(runId: string, limit: number, now = new Date()) {
  await prisma.validationCandidate.updateMany({
    where: {
      status: { in: [ValidationCandidateStatus.RETRY_REQUIRED, ValidationCandidateStatus.RETRY_SCHEDULED] },
      retryCount: { gte: defaultMaxValidationRetries },
    },
    data: { status: ValidationCandidateStatus.EXHAUSTED, lastCheckedAt: now },
  });
  const due = await prisma.validationCandidate.findMany({
    where: {
      status: { in: [ValidationCandidateStatus.RETRY_REQUIRED, ValidationCandidateStatus.RETRY_SCHEDULED] },
      nextRetryAt: { lte: now },
      retryCount: { lt: defaultMaxValidationRetries },
    },
    orderBy: [{ nextRetryAt: "asc" }, { createdAt: "asc" }],
    take: Math.max(0, limit),
  });
  if (!due.length) return 0;
  const existing = await prisma.generationCandidate.findMany({
    where: { runId, OR: due.map(({ source, sourceRecordId }) => ({ source, sourceRecordId })) },
    select: { source: true, sourceRecordId: true },
  });
  const existingKeys = new Set(existing.map(({ source, sourceRecordId }) => `${source}:${sourceRecordId}`));
  const selected = due.filter(({ source, sourceRecordId }) => !existingKeys.has(`${source}:${sourceRecordId}`));
  if (!selected.length) return 0;
  return prisma.$transaction(async (tx) => {
    const inserted = await tx.generationCandidate.createMany({
      data: selected.map((item) => ({
        runId,
        source: item.source,
        sourceRecordId: item.sourceRecordId,
        segment: `retry:${item.id}`,
        payload: item.payload as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });
    await tx.validationCandidate.updateMany({
      where: { id: { in: selected.map(({ id }) => id) }, status: { in: [ValidationCandidateStatus.RETRY_REQUIRED, ValidationCandidateStatus.RETRY_SCHEDULED] } },
      data: { status: ValidationCandidateStatus.VALIDATING, retryCount: { increment: 1 }, lastCheckedAt: now },
    });
    return inserted.count;
  });
}

function repairInterruptedPayload(payload: Prisma.JsonValue, segment: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload as Prisma.InputJsonValue;
  const candidate = { ...payload } as Record<string, unknown>;
  const [segmentCountry, segmentCity] = segment.replace(/^(?:carryover:)+/, "").split(":");
  const currentCity = typeof candidate.city === "string" ? candidate.city.trim() : "";
  if ((!currentCity || /^onbekend$/i.test(currentCity)) && segmentCity) {
    candidate.city = segmentCity;
    const currentAddress = typeof candidate.streetAddress === "string" ? candidate.streetAddress.trim() : "";
    if (!currentAddress || /^onbekend(?:\s|$)/i.test(currentAddress)) {
      const latitude = typeof candidate.latitude === "number" ? candidate.latitude : null;
      const longitude = typeof candidate.longitude === "number" ? candidate.longitude : null;
      candidate.streetAddress = latitude !== null && longitude !== null
        ? `${segmentCity} (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`
        : segmentCity;
    }
  }
  if ((!candidate.country || candidate.country === "UNKNOWN") && /^(NL|BE)$/i.test(segmentCountry ?? "")) {
    candidate.country = segmentCountry.toUpperCase();
  }
  return json(candidate);
}

export async function importInterruptedGenerationCandidates(runId: string, limit: number) {
  const interrupted = await prisma.generationCandidate.findMany({
    where: {
      runId: { not: runId },
      status: CandidateQueueStatus.PENDING,
      run: { status: { in: [JobStatus.CANCELLED, JobStatus.TIMED_OUT, JobStatus.FAILED, JobStatus.PARTIALLY_COMPLETED] } },
    },
    orderBy: { createdAt: "asc" },
    take: Math.max(0, limit),
  });
  if (!interrupted.length) return 0;

  return prisma.$transaction(async (tx) => {
    const inserted = await tx.generationCandidate.createMany({
      data: interrupted.map((item) => ({
        runId,
        source: item.source,
        sourceRecordId: item.sourceRecordId,
        segment: `carryover:${item.segment.replace(/^(?:carryover:)+/, "")}`,
        payload: repairInterruptedPayload(item.payload, item.segment),
      })),
      skipDuplicates: true,
    });
    await tx.generationCandidate.updateMany({
      where: { id: { in: interrupted.map(({ id }) => id) }, status: CandidateQueueStatus.PENDING },
      data: {
        status: CandidateQueueStatus.PROCESSED,
        processedAt: new Date(),
        lastError: `Overgenomen door vervolgrun ${runId}`,
      },
    });
    return inserted.count;
  });
}

export async function markValidationRejected(candidate: Candidate, reason: string, verification?: WebsiteVerificationResult) {
  const source = candidate.source ?? "OPENSTREETMAP";
  return prisma.validationCandidate.updateMany({
    where: { source, sourceRecordId: candidate.externalPlaceId },
    data: {
      status: ValidationCandidateStatus.REJECTED,
      failureReason: reason.slice(0, 500),
      websiteStatus: verification?.status,
      websiteConfidence: verification?.confidence,
      verificationEvidence: verification ? json(verification.evidence) : undefined,
      rejectedAt: new Date(),
      nextRetryAt: new Date(),
    },
  });
}
