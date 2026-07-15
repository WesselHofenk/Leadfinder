ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_COMPLETED';

CREATE TYPE "CandidateQueueStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

ALTER TABLE "GenerationRun"
  ADD COLUMN "websitesFound" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "batchNumber" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pendingCandidates" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "retriedCandidates" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastBatchDurationMs" INTEGER,
  ADD COLUMN "currentCategory" TEXT,
  ADD COLUMN "continuationCursor" TEXT,
  ADD COLUMN "lastError" TEXT;

CREATE TABLE "GenerationCandidate" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceRecordId" TEXT NOT NULL,
  "segment" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "CandidateQueueStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "claimedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GenerationCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GenerationCandidate_runId_source_sourceRecordId_key"
  ON "GenerationCandidate"("runId", "source", "sourceRecordId");
CREATE INDEX "GenerationCandidate_runId_status_createdAt_idx"
  ON "GenerationCandidate"("runId", "status", "createdAt");
CREATE INDEX "GenerationCandidate_status_claimedAt_idx"
  ON "GenerationCandidate"("status", "claimedAt");

ALTER TABLE "GenerationCandidate"
  ADD CONSTRAINT "GenerationCandidate_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "GenerationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
