-- Additive throughput and observability fields. No lead, pipeline, note or
-- historical generation data is changed or removed.
ALTER TABLE "GenerationRun"
  ADD COLUMN "maxCandidates" INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN "candidatesReserved" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cheapRejected" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "externallyValidated" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cacheHits" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "GenerationCandidate"
  ADD COLUMN "qualityScore" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "nextEligibleAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing queue rows count as already reserved by their original run.
UPDATE "GenerationRun" AS run
SET "candidatesReserved" = queued.count
FROM (
  SELECT "runId", COUNT(*)::INTEGER AS count
  FROM "GenerationCandidate"
  GROUP BY "runId"
) AS queued
WHERE run.id = queued."runId";

DROP INDEX IF EXISTS "GenerationCandidate_runId_status_createdAt_idx";
CREATE INDEX "GenerationCandidate_runId_status_qualityScore_createdAt_idx"
  ON "GenerationCandidate"("runId", "status", "qualityScore", "createdAt");
CREATE INDEX "GenerationCandidate_status_leaseExpiresAt_idx"
  ON "GenerationCandidate"("status", "leaseExpiresAt");
CREATE INDEX "GenerationCandidate_status_nextEligibleAt_idx"
  ON "GenerationCandidate"("status", "nextEligibleAt");
