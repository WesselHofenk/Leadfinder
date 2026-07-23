BEGIN;

-- Additive-only migration: existing leads, activities, notes, pipeline data,
-- search history and retry candidates remain untouched.
ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "emailSource" TEXT,
  ADD COLUMN IF NOT EXISTS "emailSourceUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "emailMxVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);

ALTER TABLE "GenerationRun"
  ADD COLUMN IF NOT EXISTS "emailsFound" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "emailsMissing" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "emailsInvalid" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "emailRetries" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "emailsExternallyVerified" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "remainingSegments" INTEGER;

ALTER TABLE "SourceRecord"
  ADD COLUMN IF NOT EXISTS "rawEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "rawEmailSource" TEXT;

ALTER TABLE "SearchCombination"
  ADD COLUMN IF NOT EXISTS "candidatesChecked" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "rejectedCandidates" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "retryCandidates" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "nextEligibleAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "lastSuccessAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "SearchCombination_nextEligibleAt_source_idx"
  ON "SearchCombination"("nextEligibleAt", "source");

CREATE OR REPLACE FUNCTION enforce_new_active_lead_contact_requirements()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."isActive" = true AND (
    NEW."normalizedPhoneNumber" IS NULL
    OR BTRIM(COALESCE(NEW."email", '')) = ''
  ) THEN
    RAISE EXCEPTION 'Nieuwe actieve leads vereisen een geldig telefoonnummer en openbaar zakelijk e-mailadres';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "Lead_require_qualified_contact_on_insert" ON "Lead";
CREATE TRIGGER "Lead_require_qualified_contact_on_insert"
BEFORE INSERT ON "Lead"
FOR EACH ROW
EXECUTE FUNCTION enforce_new_active_lead_contact_requirements();

COMMIT;
