BEGIN;

LOCK TABLE "Lead" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "PipelineStage" IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE "_SixStageLeadPlan" ON COMMIT DROP AS
SELECT
  lead."id" AS "leadId",
  lead."pipelineStageId" AS "previousStageId",
  stage."slug" AS "previousStageSlug",
  stage."name" AS "previousStageName",
  CASE
    WHEN LOWER(COALESCE(stage."slug", '')) IN (
      'belletje-1', 'belletje-3', 'interessant', 'geinteresseerd', 'geïnteresseerd',
      'benaderd', 'gebeld', 'voicemail', 'called', 'no-answer', 'no_answer'
    ) THEN 'pipeline-belletje-1'
    WHEN LOWER(COALESCE(stage."slug", '')) IN (
      'belletje-2', 'ingepland', 'terugbel-verzoek', 'reactie-ontvangen',
      'reactie ontvangen', 'call-back', 'call_back', 'terugbellen'
    ) THEN 'pipeline-belletje-2'
    WHEN LOWER(COALESCE(stage."slug", '')) IN (
      'belletje-4', 'gemaild', 'emailed', 'mail-gestuurd',
      'mail gestuurd', 'mail gestuurd (nog te bellen)', 'quote-sent', 'quote_sent'
    ) THEN 'pipeline-gemaild'
    WHEN LOWER(COALESCE(stage."slug", '')) IN (
      'geen-interesse', 'geen interesse', 'niet-interessant', 'niet interessant',
      'niet-relevant', 'niet relevant', 'not-interested', 'not_interested'
    ) THEN 'pipeline-geen-interesse'
    WHEN LOWER(COALESCE(stage."slug", '')) IN (
      'klant', 'klant-geworden', 'klant geworden', 'deal', 'customer', 'won'
    ) THEN 'pipeline-klant'
    WHEN LOWER(COALESCE(stage."slug", '')) IN ('nieuw', 'new') THEN 'pipeline-nieuw'
    ELSE CASE lead."status"::TEXT
      WHEN 'VOICEMAIL' THEN 'pipeline-belletje-1'
      WHEN 'INTERESTED' THEN 'pipeline-belletje-1'
      WHEN 'CALL_BACK' THEN 'pipeline-belletje-2'
      WHEN 'APPOINTMENT' THEN 'pipeline-belletje-2'
      WHEN 'QUOTE_SENT' THEN 'pipeline-gemaild'
      WHEN 'NOT_INTERESTED' THEN 'pipeline-geen-interesse'
      WHEN 'CUSTOMER' THEN 'pipeline-klant'
      ELSE 'pipeline-nieuw'
    END
  END AS "targetStageId"
FROM "Lead" lead
LEFT JOIN "PipelineStage" stage ON stage."id" = lead."pipelineStageId";

CREATE TEMP TABLE "_SixStageMigrationSnapshot" ON COMMIT DROP AS
SELECT
  (SELECT COUNT(*)::INTEGER FROM "Lead") AS "totalBefore",
  (SELECT COUNT(*)::INTEGER FROM "_SixStageLeadPlan" WHERE "previousStageId" IS DISTINCT FROM "targetStageId") AS "migratedLeads",
  (
    SELECT COUNT(*)::INTEGER
    FROM "_SixStageLeadPlan"
    WHERE "previousStageSlug" IS NULL
  ) AS "unknownStages",
  (
    SELECT COALESCE(JSONB_OBJECT_AGG(distribution."label", distribution."total"), '{}'::JSONB)
    FROM (
      SELECT COALESCE("previousStageName", 'Onbekend of ontbrekend') AS "label", COUNT(*)::INTEGER AS "total"
      FROM "_SixStageLeadPlan"
      GROUP BY COALESCE("previousStageName", 'Onbekend of ontbrekend')
    ) distribution
  ) AS "distributionBefore";

-- Maak de unieke actieve posities tijdelijk vrij.
UPDATE "PipelineStage"
SET "position" = "position" + 1000, "updatedAt" = CURRENT_TIMESTAMP
WHERE "isActive" = true;

INSERT INTO "PipelineStage" ("id", "slug", "name", "position", "isActive", "updatedAt") VALUES
  ('pipeline-nieuw', 'nieuw', 'Nieuw', 1, true, CURRENT_TIMESTAMP),
  ('pipeline-belletje-1', 'belletje-1', 'Belletje 1', 2, true, CURRENT_TIMESTAMP),
  ('pipeline-belletje-2', 'belletje-2', 'Belletje 2', 3, true, CURRENT_TIMESTAMP),
  ('pipeline-gemaild', 'gemaild', 'Gemaild', 4, true, CURRENT_TIMESTAMP),
  ('pipeline-geen-interesse', 'geen-interesse', 'Geen interesse', 5, true, CURRENT_TIMESTAMP),
  ('pipeline-klant', 'klant', 'Klant', 6, true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "slug" = EXCLUDED."slug",
  "name" = EXCLUDED."name",
  "position" = EXCLUDED."position",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "Lead" lead
SET "pipelineStageId" = plan."targetStageId"
FROM "_SixStageLeadPlan" plan
WHERE lead."id" = plan."leadId"
  AND lead."pipelineStageId" IS DISTINCT FROM plan."targetStageId";

INSERT INTO "LeadActivity" ("id", "leadId", "actorId", "type", "summary", "details", "createdAt")
SELECT
  'six-stage-pipeline-20260723-' || SUBSTRING(MD5(plan."leadId") FROM 1 FOR 20),
  plan."leadId",
  NULL,
  'PIPELINE_STAGE_MIGRATED',
  'Pipelinefase automatisch gemigreerd naar de nieuwe zes-fasenpipeline.',
  JSONB_BUILD_OBJECT(
    'previousStageId', plan."previousStageId",
    'previousStage', plan."previousStageSlug",
    'nextStageId', plan."targetStageId",
    'nextStage', target."slug"
  ),
  CURRENT_TIMESTAMP
FROM "_SixStageLeadPlan" plan
JOIN "PipelineStage" target ON target."id" = plan."targetStageId"
WHERE plan."previousStageId" IS DISTINCT FROM plan."targetStageId"
ON CONFLICT ("id") DO NOTHING;

UPDATE "PipelineStage"
SET "isActive" = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" NOT IN (
  'pipeline-nieuw',
  'pipeline-belletje-1',
  'pipeline-belletje-2',
  'pipeline-gemaild',
  'pipeline-geen-interesse',
  'pipeline-klant'
);

-- PipelineStage is canoniek; de oude enumkolom blijft een compatibele spiegel.
CREATE OR REPLACE FUNCTION "syncLeadPipelineCompatibility"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status"::TEXT <> 'NEW' THEN
      NEW."pipelineStageId" := CASE NEW."status"::TEXT
        WHEN 'VOICEMAIL' THEN 'pipeline-belletje-1'
        WHEN 'INTERESTED' THEN 'pipeline-belletje-1'
        WHEN 'CALL_BACK' THEN 'pipeline-belletje-2'
        WHEN 'APPOINTMENT' THEN 'pipeline-belletje-2'
        WHEN 'QUOTE_SENT' THEN 'pipeline-gemaild'
        WHEN 'NOT_INTERESTED' THEN 'pipeline-geen-interesse'
        WHEN 'CUSTOMER' THEN 'pipeline-klant'
        ELSE 'pipeline-nieuw'
      END;
    ELSE
      NEW."status" := CASE NEW."pipelineStageId"
        WHEN 'pipeline-belletje-1' THEN 'VOICEMAIL'::"LeadStatus"
        WHEN 'pipeline-belletje-2' THEN 'CALL_BACK'::"LeadStatus"
        WHEN 'pipeline-gemaild' THEN 'QUOTE_SENT'::"LeadStatus"
        WHEN 'pipeline-geen-interesse' THEN 'NOT_INTERESTED'::"LeadStatus"
        WHEN 'pipeline-klant' THEN 'CUSTOMER'::"LeadStatus"
        ELSE 'NEW'::"LeadStatus"
      END;
    END IF;
  ELSIF NEW."pipelineStageId" IS DISTINCT FROM OLD."pipelineStageId" THEN
    NEW."status" := CASE NEW."pipelineStageId"
      WHEN 'pipeline-belletje-1' THEN 'VOICEMAIL'::"LeadStatus"
      WHEN 'pipeline-belletje-2' THEN 'CALL_BACK'::"LeadStatus"
      WHEN 'pipeline-gemaild' THEN 'QUOTE_SENT'::"LeadStatus"
      WHEN 'pipeline-geen-interesse' THEN 'NOT_INTERESTED'::"LeadStatus"
      WHEN 'pipeline-klant' THEN 'CUSTOMER'::"LeadStatus"
      ELSE 'NEW'::"LeadStatus"
    END;
  ELSIF NEW."status" IS DISTINCT FROM OLD."status" THEN
    NEW."pipelineStageId" := CASE NEW."status"::TEXT
      WHEN 'VOICEMAIL' THEN 'pipeline-belletje-1'
      WHEN 'INTERESTED' THEN 'pipeline-belletje-1'
      WHEN 'CALL_BACK' THEN 'pipeline-belletje-2'
      WHEN 'APPOINTMENT' THEN 'pipeline-belletje-2'
      WHEN 'QUOTE_SENT' THEN 'pipeline-gemaild'
      WHEN 'NOT_INTERESTED' THEN 'pipeline-geen-interesse'
      WHEN 'CUSTOMER' THEN 'pipeline-klant'
      ELSE 'pipeline-nieuw'
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

UPDATE "Lead"
SET "status" = CASE "pipelineStageId"
  WHEN 'pipeline-belletje-1' THEN 'VOICEMAIL'::"LeadStatus"
  WHEN 'pipeline-belletje-2' THEN 'CALL_BACK'::"LeadStatus"
  WHEN 'pipeline-gemaild' THEN 'QUOTE_SENT'::"LeadStatus"
  WHEN 'pipeline-geen-interesse' THEN 'NOT_INTERESTED'::"LeadStatus"
  WHEN 'pipeline-klant' THEN 'CUSTOMER'::"LeadStatus"
  ELSE 'NEW'::"LeadStatus"
END;

DO $$
DECLARE
  before_total INTEGER;
  after_total INTEGER;
  active_stages INTEGER;
  invalid_leads INTEGER;
BEGIN
  SELECT "totalBefore" INTO before_total FROM "_SixStageMigrationSnapshot";
  SELECT COUNT(*)::INTEGER INTO after_total FROM "Lead";
  SELECT COUNT(*)::INTEGER INTO active_stages FROM "PipelineStage" WHERE "isActive" = true;
  SELECT COUNT(*)::INTEGER INTO invalid_leads
  FROM "Lead" lead
  LEFT JOIN "PipelineStage" stage ON stage."id" = lead."pipelineStageId"
  WHERE stage."id" IS NULL OR stage."isActive" = false;

  IF before_total <> after_total THEN
    RAISE EXCEPTION 'Zes-fasenmigratie wijzigde het leadaantal van % naar %', before_total, after_total;
  END IF;
  IF invalid_leads <> 0 THEN
    RAISE EXCEPTION 'Zes-fasenmigratie liet % leads zonder geldige actieve fase achter', invalid_leads;
  END IF;
  IF active_stages <> 6 OR EXISTS (
    SELECT required."slug", required."position"
    FROM (VALUES
      ('nieuw', 1),
      ('belletje-1', 2),
      ('belletje-2', 3),
      ('gemaild', 4),
      ('geen-interesse', 5),
      ('klant', 6)
    ) AS required("slug", "position")
    LEFT JOIN "PipelineStage" stage
      ON stage."slug" = required."slug"
      AND stage."position" = required."position"
      AND stage."isActive" = true
    WHERE stage."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Zes-fasenmigratie verwacht exact zes actieve fases; gevonden: %', active_stages;
  END IF;
END $$;

INSERT INTO "PipelineMigrationAudit" (
  "migrationKey",
  "totalBefore",
  "totalAfter",
  "migratedLeads",
  "unknownStages",
  "distributionBefore",
  "distributionAfter"
)
SELECT
  '20260723210000_six_stage_pipeline',
  snapshot."totalBefore",
  (SELECT COUNT(*)::INTEGER FROM "Lead"),
  snapshot."migratedLeads",
  snapshot."unknownStages",
  snapshot."distributionBefore",
  JSONB_BUILD_OBJECT(
    'Nieuw', (SELECT COUNT(*) FROM "Lead" WHERE "pipelineStageId" = 'pipeline-nieuw'),
    'Belletje 1', (SELECT COUNT(*) FROM "Lead" WHERE "pipelineStageId" = 'pipeline-belletje-1'),
    'Belletje 2', (SELECT COUNT(*) FROM "Lead" WHERE "pipelineStageId" = 'pipeline-belletje-2'),
    'Gemaild', (SELECT COUNT(*) FROM "Lead" WHERE "pipelineStageId" = 'pipeline-gemaild'),
    'Geen interesse', (SELECT COUNT(*) FROM "Lead" WHERE "pipelineStageId" = 'pipeline-geen-interesse'),
    'Klant', (SELECT COUNT(*) FROM "Lead" WHERE "pipelineStageId" = 'pipeline-klant')
  )
FROM "_SixStageMigrationSnapshot" snapshot
ON CONFLICT ("migrationKey") DO NOTHING;

COMMIT;
