BEGIN;

CREATE TEMP TABLE "_CallbackRequestStageLeadCount" ON COMMIT DROP AS
SELECT COUNT(*)::INTEGER AS "total" FROM "Lead";

INSERT INTO "PipelineStage" ("id", "slug", "name", "position", "isActive", "updatedAt")
VALUES ('pipeline-terugbel-verzoek', 'terugbel-verzoek', 'Terugbel verzoek', 10, true, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "position" = EXCLUDED."position",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

DO $$
DECLARE
  lead_count_before INTEGER;
  lead_count_after INTEGER;
  callback_stage_count INTEGER;
BEGIN
  SELECT "total" INTO lead_count_before FROM "_CallbackRequestStageLeadCount";
  SELECT COUNT(*)::INTEGER INTO lead_count_after FROM "Lead";
  SELECT COUNT(*)::INTEGER INTO callback_stage_count
  FROM "PipelineStage"
  WHERE "slug" = 'terugbel-verzoek'
    AND "name" = 'Terugbel verzoek'
    AND "position" = 10
    AND "isActive" = true;

  IF lead_count_before <> lead_count_after THEN
    RAISE EXCEPTION 'Pipelinefase-migratie wijzigde onverwacht het aantal leads';
  END IF;
  IF callback_stage_count <> 1 THEN
    RAISE EXCEPTION 'Pipelinefase Terugbel verzoek kon niet veilig worden aangemaakt';
  END IF;
END $$;

COMMIT;
