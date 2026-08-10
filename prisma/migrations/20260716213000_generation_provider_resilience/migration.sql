-- Alle wijzigingen zijn additief. Bestaande leads, runs en retryrecords blijven staan.
ALTER TYPE "ValidationCandidateStatus" ADD VALUE IF NOT EXISTS 'RETRY_SCHEDULED';
ALTER TYPE "ValidationCandidateStatus" ADD VALUE IF NOT EXISTS 'VALIDATING';
ALTER TYPE "ValidationCandidateStatus" ADD VALUE IF NOT EXISTS 'EXHAUSTED';

ALTER TABLE "ValidationCandidate"
  ADD COLUMN IF NOT EXISTS "maxRetries" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "lastErrorCode" TEXT,
  ADD COLUMN IF NOT EXISTS "lastErrorMessage" TEXT,
  ADD COLUMN IF NOT EXISTS "lastProvider" TEXT,
  ADD COLUMN IF NOT EXISTS "lastCheckedAt" TIMESTAMP(3);

-- De oude RETRY_REQUIRED-status blijft leesbaar. Nieuwe writes gebruiken de
-- toegevoegde statussen pas nadat deze migratie volledig is gecommit.

ALTER TABLE "SearchCombination"
  ADD COLUMN IF NOT EXISTS "region" TEXT,
  ADD COLUMN IF NOT EXISTS "searchTerm" TEXT,
  ADD COLUMN IF NOT EXISTS "provider" TEXT,
  ADD COLUMN IF NOT EXISTS "errorCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "totalDurationMs" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "averageDurationMs" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "SourceProviderHealth" (
  "provider" TEXT NOT NULL,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "totalFailures" INTEGER NOT NULL DEFAULT 0,
  "totalSuccesses" INTEGER NOT NULL DEFAULT 0,
  "unhealthyUntil" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "lastDurationMs" INTEGER,
  "averageDurationMs" INTEGER NOT NULL DEFAULT 0,
  "lastCheckedAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceProviderHealth_pkey" PRIMARY KEY ("provider")
);

CREATE INDEX IF NOT EXISTS "SourceProviderHealth_unhealthyUntil_consecutiveFailures_idx"
  ON "SourceProviderHealth"("unhealthyUntil", "consecutiveFailures");
