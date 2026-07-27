ALTER TABLE "GenerationRun"
  ADD COLUMN "sourceRequests" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sourceSuccesses" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "wrongLocationRejected" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "insufficientDataRejected" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "validCandidates" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "databaseInsertAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "databaseInsertFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalDurationMs" INTEGER;

-- Keep the database barrier aligned with the product requirement: a callable
-- phone is mandatory; e-mail remains optional enrichment. Existing rows are
-- untouched and no unverified e-mail is fabricated.
CREATE OR REPLACE FUNCTION enforce_new_active_lead_contact_requirements()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."isActive" = true AND NEW."normalizedPhoneNumber" IS NULL THEN
    RAISE EXCEPTION 'Nieuwe actieve leads vereisen een geldig telefoonnummer';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "Lead_require_qualified_contact_on_insert" ON "Lead";
CREATE TRIGGER "Lead_require_qualified_contact_on_insert"
BEFORE INSERT ON "Lead"
FOR EACH ROW
EXECUTE FUNCTION enforce_new_active_lead_contact_requirements();

UPDATE "CoverageArea"
SET
  "status" = 'PAUSED',
  "errorMessage" = 'Uitgesloten: generator zoekt uitsluitend bedrijven in Nederland'
WHERE "country" <> 'NL'
  AND "status" <> 'PAUSED';
