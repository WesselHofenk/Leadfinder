-- Additive run counters for separately tracking qualified drafts, persisted
-- leads, and candidates retained for retry.
ALTER TABLE "GenerationRun"
  ADD COLUMN IF NOT EXISTS "validDrafts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "retryQueueCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "QualifiedLeadDraft"
  ADD COLUMN IF NOT EXISTS "validatedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "QualifiedLeadDraft_runId_validatedAt_idx"
  ON "QualifiedLeadDraft"("runId", "validatedAt");
