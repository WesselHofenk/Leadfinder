ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'TIMED_OUT';

ALTER TABLE "GenerationRun"
  ADD COLUMN "progress" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "message" TEXT,
  ADD COLUMN "heartbeatAt" TIMESTAMP(3),
  ADD COLUMN "processedSegments" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "existingLeads" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "currentTile" TEXT;

ALTER TABLE "SearchCombination"
  ADD COLUMN "tileCursor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastTile" TEXT;

ALTER TABLE "SourceRecord"
  ADD COLUMN "decision" TEXT,
  ADD COLUMN "reasonCode" TEXT,
  ADD COLUMN "processedAt" TIMESTAMP(3);

CREATE INDEX "GenerationRun_status_updatedAt_idx" ON "GenerationRun"("status", "updatedAt");
