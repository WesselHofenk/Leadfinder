import { Prisma, ValidationCandidateStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { Candidate } from "./eligibility";
import type { WebsiteVerificationResult } from "./website-verification";

const baseRetryDelayMs = 15 * 60_000;
const maxRetryDelayMs = 24 * 60 * 60_000;

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
    select: { retryCount: true },
  });
  const retryCount = existing?.retryCount ?? 0;
  const confidence = validationConfidence(candidate, verification);
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
    nextRetryAt: new Date(now.getTime() + validationRetryDelayMs(retryCount)),
    payload: json(candidate),
    verificationEvidence: verification ? json(verification.evidence) : Prisma.JsonNull,
    status: ValidationCandidateStatus.RETRY_REQUIRED,
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
  const due = await prisma.validationCandidate.findMany({
    where: { status: ValidationCandidateStatus.RETRY_REQUIRED, nextRetryAt: { lte: now } },
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
      where: { id: { in: selected.map(({ id }) => id) }, status: ValidationCandidateStatus.RETRY_REQUIRED },
      data: { status: ValidationCandidateStatus.PENDING_VALIDATION, retryCount: { increment: 1 } },
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
