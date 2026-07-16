ALTER TABLE "Lead"
  ALTER COLUMN "normalizedPhoneNumber" DROP NOT NULL;

CREATE TYPE "ValidationCandidateStatus" AS ENUM (
  'PENDING_VALIDATION',
  'RETRY_REQUIRED',
  'VALIDATED',
  'REJECTED',
  'PROMOTED_TO_LEAD'
);

CREATE TABLE "ValidationCandidate" (
  "id" TEXT NOT NULL,
  "originRunId" TEXT,
  "source" TEXT NOT NULL,
  "sourceRecordId" TEXT NOT NULL,
  "companyName" TEXT NOT NULL,
  "streetAddress" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "phone" TEXT,
  "email" TEXT,
  "possibleWebsite" TEXT,
  "websiteStatus" TEXT NOT NULL,
  "businessStatus" TEXT NOT NULL,
  "identityConfidence" INTEGER NOT NULL DEFAULT 0,
  "locationConfidence" INTEGER NOT NULL DEFAULT 0,
  "websiteConfidence" INTEGER NOT NULL DEFAULT 0,
  "businessConfidence" INTEGER NOT NULL DEFAULT 0,
  "totalConfidence" INTEGER NOT NULL DEFAULT 0,
  "failureReason" TEXT NOT NULL,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "nextRetryAt" TIMESTAMP(3) NOT NULL,
  "payload" JSONB NOT NULL,
  "verificationEvidence" JSONB,
  "promotedLeadId" TEXT,
  "validatedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "status" "ValidationCandidateStatus" NOT NULL DEFAULT 'RETRY_REQUIRED',
  CONSTRAINT "ValidationCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ValidationCandidate_source_sourceRecordId_key"
  ON "ValidationCandidate"("source", "sourceRecordId");
CREATE INDEX "ValidationCandidate_status_nextRetryAt_idx"
  ON "ValidationCandidate"("status", "nextRetryAt");
CREATE INDEX "ValidationCandidate_originRunId_createdAt_idx"
  ON "ValidationCandidate"("originRunId", "createdAt");
CREATE INDEX "ValidationCandidate_promotedLeadId_idx"
  ON "ValidationCandidate"("promotedLeadId");
