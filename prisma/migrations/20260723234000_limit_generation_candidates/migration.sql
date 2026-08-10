BEGIN;

-- New runs use the smaller quality-focused budget. Historical run records and
-- their candidates remain unchanged for auditability and later retry import.
ALTER TABLE "GenerationRun"
  ALTER COLUMN "maxCandidates" SET DEFAULT 200;

COMMIT;
