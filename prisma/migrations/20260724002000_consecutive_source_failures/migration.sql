BEGIN;

-- Keep the historical total error counter intact. This separate counter is
-- reset after every successful source response and therefore represents a
-- real uninterrupted outage.
ALTER TABLE "GenerationRun"
  ADD COLUMN IF NOT EXISTS "consecutiveSourceFailures" INTEGER NOT NULL DEFAULT 0;

COMMIT;
