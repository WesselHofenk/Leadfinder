BEGIN;

CREATE TEMP TABLE "_EmailedStageLeadCount" ON COMMIT DROP AS
SELECT COUNT(*)::INTEGER AS "total" FROM "Lead";

-- Maak positie 6 tijdelijk vrij zonder leads of hun fasekoppeling te wijzigen.
UPDATE "PipelineStage"
SET "position" = "position" + 100, "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" IN ('gemaild', 'ingepland', 'deal', 'geen-interesse');

INSERT INTO "PipelineStage" ("id", "slug", "name", "position", "isActive", "updatedAt")
VALUES ('pipeline-gemaild', 'gemaild', 'Gemaild', 6, true, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "position" = EXCLUDED."position",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "PipelineStage"
SET
  "position" = CASE "slug"
    WHEN 'nieuw' THEN 1
    WHEN 'belletje-1' THEN 2
    WHEN 'belletje-2' THEN 3
    WHEN 'belletje-3' THEN 4
    WHEN 'belletje-4' THEN 5
    WHEN 'gemaild' THEN 6
    WHEN 'ingepland' THEN 7
    WHEN 'deal' THEN 8
    WHEN 'geen-interesse' THEN 9
    ELSE "position"
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" IN ('nieuw', 'belletje-1', 'belletje-2', 'belletje-3', 'belletje-4', 'gemaild', 'ingepland', 'deal', 'geen-interesse');

DO $$
DECLARE
  lead_count_before INTEGER;
  lead_count_after INTEGER;
  emailed_stage_count INTEGER;
BEGIN
  SELECT "total" INTO lead_count_before FROM "_EmailedStageLeadCount";
  SELECT COUNT(*)::INTEGER INTO lead_count_after FROM "Lead";
  SELECT COUNT(*)::INTEGER INTO emailed_stage_count
  FROM "PipelineStage" WHERE "slug" = 'gemaild' AND "name" = 'Gemaild' AND "position" = 6 AND "isActive" = true;

  IF lead_count_before <> lead_count_after THEN
    RAISE EXCEPTION 'Pipelinefase-migratie wijzigde onverwacht het aantal leads';
  END IF;
  IF emailed_stage_count <> 1 THEN
    RAISE EXCEPTION 'Pipelinefase Gemaild kon niet veilig worden aangemaakt';
  END IF;
END $$;

COMMIT;
