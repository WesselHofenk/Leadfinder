CREATE TYPE "ContactValidationStatus" AS ENUM ('PENDING', 'DELIVERABLE', 'VALID', 'INVALID', 'UNKNOWN');
CREATE TYPE "ChatbotStatus" AS ENUM ('PRESENT', 'NOT_PRESENT', 'UNKNOWN');
CREATE TYPE "ChainStatus" AS ENUM ('INDEPENDENT', 'SMALL_GROUP', 'FRANCHISE', 'LARGE_CHAIN', 'CORPORATE', 'UNKNOWN');

ALTER TABLE "Lead"
  ADD COLUMN "emailValidationStatus" "ContactValidationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "emailValidationSource" TEXT,
  ADD COLUMN "emailValidatedAt" TIMESTAMP(3),
  ADD COLUMN "phoneValidationStatus" "ContactValidationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "phoneValidationSource" TEXT,
  ADD COLUMN "phoneValidatedAt" TIMESTAMP(3),
  ADD COLUMN "chatbotStatus" "ChatbotStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "chatbotStatusReason" TEXT,
  ADD COLUMN "chainStatus" "ChainStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "branchCount" INTEGER,
  ADD COLUMN "qualificationReason" TEXT,
  ADD COLUMN "batchId" TEXT,
  ADD COLUMN "dedupeFingerprint" TEXT;

CREATE UNIQUE INDEX "Lead_dedupeFingerprint_key" ON "Lead"("dedupeFingerprint");
CREATE INDEX "Lead_batchId_idx" ON "Lead"("batchId");

CREATE TABLE "QualifiedLeadDraft" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QualifiedLeadDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QualifiedLeadDraft_fingerprint_key" ON "QualifiedLeadDraft"("fingerprint");
CREATE INDEX "QualifiedLeadDraft_runId_createdAt_idx" ON "QualifiedLeadDraft"("runId", "createdAt");
ALTER TABLE "QualifiedLeadDraft" ADD CONSTRAINT "QualifiedLeadDraft_runId_fkey" FOREIGN KEY ("runId") REFERENCES "GenerationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
