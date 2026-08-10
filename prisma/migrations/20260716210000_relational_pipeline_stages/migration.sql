BEGIN;

CREATE TABLE IF NOT EXISTS "PipelineStage" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PipelineStage_slug_key" ON "PipelineStage"("slug");

-- Eventuele niet-canonieke fases blijven voor historie bestaan, maar zijn niet actief.
UPDATE "PipelineStage"
SET "isActive" = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" NOT IN ('nieuw', 'belletje-1', 'belletje-2', 'belletje-3', 'belletje-4', 'ingepland', 'deal', 'geen-interesse');

INSERT INTO "PipelineStage" ("id", "slug", "name", "position", "isActive", "updatedAt") VALUES
  ('pipeline-nieuw', 'nieuw', 'Nieuw', 1, true, CURRENT_TIMESTAMP),
  ('pipeline-belletje-1', 'belletje-1', 'Belletje 1', 2, true, CURRENT_TIMESTAMP),
  ('pipeline-belletje-2', 'belletje-2', 'Belletje 2', 3, true, CURRENT_TIMESTAMP),
  ('pipeline-belletje-3', 'belletje-3', 'Belletje 3', 4, true, CURRENT_TIMESTAMP),
  ('pipeline-belletje-4', 'belletje-4', 'Belletje 4', 5, true, CURRENT_TIMESTAMP),
  ('pipeline-ingepland', 'ingepland', 'Ingepland', 6, true, CURRENT_TIMESTAMP),
  ('pipeline-deal', 'deal', 'Deal', 7, true, CURRENT_TIMESTAMP),
  ('pipeline-geen-interesse', 'geen-interesse', 'Geen interesse', 8, true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "slug" = EXCLUDED."slug",
  "name" = EXCLUDED."name",
  "position" = EXCLUDED."position",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "PipelineStage_active_position_key"
  ON "PipelineStage"("position") WHERE "isActive" = true;
CREATE INDEX IF NOT EXISTS "PipelineStage_isActive_position_idx"
  ON "PipelineStage"("isActive", "position");

CREATE TABLE IF NOT EXISTS "PipelineMigrationAudit" (
  "migrationKey" TEXT NOT NULL,
  "totalBefore" INTEGER NOT NULL,
  "totalAfter" INTEGER NOT NULL,
  "migratedLeads" INTEGER NOT NULL,
  "unknownStages" INTEGER NOT NULL,
  "distributionBefore" JSONB NOT NULL,
  "distributionAfter" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PipelineMigrationAudit_pkey" PRIMARY KEY ("migrationKey")
);

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "pipelineStageId" TEXT;

CREATE TEMP TABLE "_PipelineMigrationSnapshot" (
  "totalBefore" INTEGER NOT NULL,
  "migratedLeads" INTEGER NOT NULL,
  "unknownStages" INTEGER NOT NULL,
  "distributionBefore" JSONB NOT NULL
) ON COMMIT DROP;

INSERT INTO "_PipelineMigrationSnapshot"
SELECT
  COUNT(*)::INTEGER,
  COUNT(*) FILTER (WHERE "pipelineStageId" IS NULL OR "pipelineStageId" IS DISTINCT FROM CASE "status"::TEXT
    WHEN 'NEW' THEN 'pipeline-nieuw'
    WHEN 'VOICEMAIL' THEN 'pipeline-belletje-1'
    WHEN 'CALL_BACK' THEN 'pipeline-belletje-2'
    WHEN 'INTERESTED' THEN 'pipeline-belletje-3'
    WHEN 'QUOTE_SENT' THEN 'pipeline-belletje-4'
    WHEN 'APPOINTMENT' THEN 'pipeline-ingepland'
    WHEN 'CUSTOMER' THEN 'pipeline-deal'
    WHEN 'NOT_INTERESTED' THEN 'pipeline-geen-interesse'
    ELSE 'pipeline-nieuw'
  END)::INTEGER,
  COUNT(*) FILTER (WHERE "status" IS NULL OR "status"::TEXT NOT IN ('NEW', 'VOICEMAIL', 'CALL_BACK', 'INTERESTED', 'QUOTE_SENT', 'APPOINTMENT', 'CUSTOMER', 'NOT_INTERESTED'))::INTEGER,
  jsonb_build_object(
    'Nieuw', COUNT(*) FILTER (WHERE "status"::TEXT = 'NEW'),
    'Voicemail', COUNT(*) FILTER (WHERE "status"::TEXT = 'VOICEMAIL'),
    'Terugbellen', COUNT(*) FILTER (WHERE "status"::TEXT = 'CALL_BACK'),
    'Geïnteresseerd', COUNT(*) FILTER (WHERE "status"::TEXT = 'INTERESTED'),
    'Offerte gestuurd', COUNT(*) FILTER (WHERE "status"::TEXT = 'QUOTE_SENT'),
    'Afspraak', COUNT(*) FILTER (WHERE "status"::TEXT = 'APPOINTMENT'),
    'Klant', COUNT(*) FILTER (WHERE "status"::TEXT = 'CUSTOMER'),
    'Niet geïnteresseerd', COUNT(*) FILTER (WHERE "status"::TEXT = 'NOT_INTERESTED'),
    'Onbekend of ontbrekend', COUNT(*) FILTER (WHERE "status" IS NULL OR "status"::TEXT NOT IN ('NEW', 'VOICEMAIL', 'CALL_BACK', 'INTERESTED', 'QUOTE_SENT', 'APPOINTMENT', 'CUSTOMER', 'NOT_INTERESTED'))
  )
FROM "Lead";

-- Onbekende of ontbrekende waarden worden gerepareerd zonder de lead of historie te verwijderen.
INSERT INTO "LeadActivity" ("id", "leadId", "actorId", "type", "summary", "details", "createdAt")
SELECT
  'pipeline-repair-' || SUBSTRING(md5(lead."id") FROM 1 FOR 20),
  lead."id",
  NULL,
  'PIPELINE_STAGE_REPAIRED',
  'Onbekende pipelinefase automatisch hersteld naar Nieuw.',
  jsonb_build_object('previousStatus', lead."status"::TEXT, 'newStage', 'nieuw'),
  CURRENT_TIMESTAMP
FROM "Lead" lead
WHERE lead."status" IS NULL OR lead."status"::TEXT NOT IN ('NEW', 'VOICEMAIL', 'CALL_BACK', 'INTERESTED', 'QUOTE_SENT', 'APPOINTMENT', 'CUSTOMER', 'NOT_INTERESTED')
ON CONFLICT ("id") DO NOTHING;

UPDATE "Lead"
SET "pipelineStageId" = CASE "status"::TEXT
  WHEN 'NEW' THEN 'pipeline-nieuw'
  WHEN 'VOICEMAIL' THEN 'pipeline-belletje-1'
  WHEN 'CALL_BACK' THEN 'pipeline-belletje-2'
  WHEN 'INTERESTED' THEN 'pipeline-belletje-3'
  WHEN 'QUOTE_SENT' THEN 'pipeline-belletje-4'
  WHEN 'APPOINTMENT' THEN 'pipeline-ingepland'
  WHEN 'CUSTOMER' THEN 'pipeline-deal'
  WHEN 'NOT_INTERESTED' THEN 'pipeline-geen-interesse'
  ELSE 'pipeline-nieuw'
END
WHERE "pipelineStageId" IS DISTINCT FROM CASE "status"::TEXT
  WHEN 'NEW' THEN 'pipeline-nieuw'
  WHEN 'VOICEMAIL' THEN 'pipeline-belletje-1'
  WHEN 'CALL_BACK' THEN 'pipeline-belletje-2'
  WHEN 'INTERESTED' THEN 'pipeline-belletje-3'
  WHEN 'QUOTE_SENT' THEN 'pipeline-belletje-4'
  WHEN 'APPOINTMENT' THEN 'pipeline-ingepland'
  WHEN 'CUSTOMER' THEN 'pipeline-deal'
  WHEN 'NOT_INTERESTED' THEN 'pipeline-geen-interesse'
  ELSE 'pipeline-nieuw'
END;

ALTER TABLE "Lead" ALTER COLUMN "pipelineStageId" SET DEFAULT 'pipeline-nieuw';
ALTER TABLE "Lead" ALTER COLUMN "pipelineStageId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Lead_pipelineStageId_fkey') THEN
    ALTER TABLE "Lead" ADD CONSTRAINT "Lead_pipelineStageId_fkey"
      FOREIGN KEY ("pipelineStageId") REFERENCES "PipelineStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Lead_pipelineStageId_isFiltered_leadType_idx"
  ON "Lead"("pipelineStageId", "isFiltered", "leadType");

-- Houd de oude enumkolom uitsluitend als deployment-compatibele spiegel; PipelineStage is canoniek.
CREATE OR REPLACE FUNCTION "syncLeadPipelineCompatibility"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status"::TEXT <> 'NEW' THEN
      NEW."pipelineStageId" := CASE NEW."status"::TEXT
        WHEN 'VOICEMAIL' THEN 'pipeline-belletje-1' WHEN 'CALL_BACK' THEN 'pipeline-belletje-2'
        WHEN 'INTERESTED' THEN 'pipeline-belletje-3' WHEN 'QUOTE_SENT' THEN 'pipeline-belletje-4'
        WHEN 'APPOINTMENT' THEN 'pipeline-ingepland' WHEN 'CUSTOMER' THEN 'pipeline-deal'
        WHEN 'NOT_INTERESTED' THEN 'pipeline-geen-interesse' ELSE 'pipeline-nieuw' END;
    ELSE
      NEW."status" := CASE NEW."pipelineStageId"
        WHEN 'pipeline-belletje-1' THEN 'VOICEMAIL'::"LeadStatus"
        WHEN 'pipeline-belletje-2' THEN 'CALL_BACK'::"LeadStatus"
        WHEN 'pipeline-belletje-3' THEN 'INTERESTED'::"LeadStatus"
        WHEN 'pipeline-belletje-4' THEN 'QUOTE_SENT'::"LeadStatus"
        WHEN 'pipeline-ingepland' THEN 'APPOINTMENT'::"LeadStatus"
        WHEN 'pipeline-deal' THEN 'CUSTOMER'::"LeadStatus"
        WHEN 'pipeline-geen-interesse' THEN 'NOT_INTERESTED'::"LeadStatus"
        ELSE 'NEW'::"LeadStatus" END;
    END IF;
  ELSIF NEW."pipelineStageId" IS DISTINCT FROM OLD."pipelineStageId" THEN
    NEW."status" := CASE NEW."pipelineStageId"
      WHEN 'pipeline-belletje-1' THEN 'VOICEMAIL'::"LeadStatus"
      WHEN 'pipeline-belletje-2' THEN 'CALL_BACK'::"LeadStatus"
      WHEN 'pipeline-belletje-3' THEN 'INTERESTED'::"LeadStatus"
      WHEN 'pipeline-belletje-4' THEN 'QUOTE_SENT'::"LeadStatus"
      WHEN 'pipeline-ingepland' THEN 'APPOINTMENT'::"LeadStatus"
      WHEN 'pipeline-deal' THEN 'CUSTOMER'::"LeadStatus"
      WHEN 'pipeline-geen-interesse' THEN 'NOT_INTERESTED'::"LeadStatus"
      ELSE 'NEW'::"LeadStatus" END;
  ELSIF NEW."status" IS DISTINCT FROM OLD."status" THEN
    NEW."pipelineStageId" := CASE NEW."status"::TEXT
      WHEN 'VOICEMAIL' THEN 'pipeline-belletje-1' WHEN 'CALL_BACK' THEN 'pipeline-belletje-2'
      WHEN 'INTERESTED' THEN 'pipeline-belletje-3' WHEN 'QUOTE_SENT' THEN 'pipeline-belletje-4'
      WHEN 'APPOINTMENT' THEN 'pipeline-ingepland' WHEN 'CUSTOMER' THEN 'pipeline-deal'
      WHEN 'NOT_INTERESTED' THEN 'pipeline-geen-interesse' ELSE 'pipeline-nieuw' END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "Lead_pipeline_compatibility_trigger" ON "Lead";
CREATE TRIGGER "Lead_pipeline_compatibility_trigger"
  BEFORE INSERT OR UPDATE OF "status", "pipelineStageId" ON "Lead"
  FOR EACH ROW EXECUTE FUNCTION "syncLeadPipelineCompatibility"();

DO $$
DECLARE
  before_total INTEGER;
  after_total INTEGER;
  invalid_leads INTEGER;
  active_stages INTEGER;
BEGIN
  SELECT "totalBefore" INTO before_total FROM "_PipelineMigrationSnapshot";
  SELECT COUNT(*)::INTEGER INTO after_total FROM "Lead";
  SELECT COUNT(*)::INTEGER INTO invalid_leads
    FROM "Lead" lead LEFT JOIN "PipelineStage" stage ON stage."id" = lead."pipelineStageId"
    WHERE stage."id" IS NULL OR stage."isActive" = false;
  SELECT COUNT(*)::INTEGER INTO active_stages FROM "PipelineStage" WHERE "isActive" = true;
  IF before_total <> after_total THEN
    RAISE EXCEPTION 'Pipeline migration changed lead count from % to %', before_total, after_total;
  END IF;
  IF invalid_leads <> 0 THEN
    RAISE EXCEPTION 'Pipeline migration left % leads without a valid active stage', invalid_leads;
  END IF;
  IF active_stages <> 8 OR EXISTS (
    SELECT required.slug FROM (VALUES
      ('nieuw'), ('belletje-1'), ('belletje-2'), ('belletje-3'),
      ('belletje-4'), ('ingepland'), ('deal'), ('geen-interesse')
    ) AS required(slug)
    LEFT JOIN "PipelineStage" stage ON stage."slug" = required.slug AND stage."isActive" = true
    WHERE stage."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Pipeline migration expected 8 active stages, found %', active_stages;
  END IF;
END $$;

INSERT INTO "PipelineMigrationAudit" (
  "migrationKey", "totalBefore", "totalAfter", "migratedLeads", "unknownStages", "distributionBefore", "distributionAfter"
)
SELECT
  '20260716210000_relational_pipeline_stages',
  snapshot."totalBefore",
  (SELECT COUNT(*)::INTEGER FROM "Lead"),
  snapshot."migratedLeads",
  snapshot."unknownStages",
  snapshot."distributionBefore",
  jsonb_build_object(
    'Nieuw', (SELECT COUNT(*) FROM "Lead" WHERE "pipelineStageId" = 'pipeline-nieuw'),
    'Belletje 1', (SELECT COUNT(*) FROM "Lead" WHERE "pipelineStageId" = 'pipeline-belletje-1'),
    'Belletje 2', (SELECT COUNT(*) FROM "Lead" WHERE "pipelineStageId" = 'pipeline-belletje-2'),
    'Belletje 3', (SELECT COUNT(*) FROM "Lead" WHERE "pipelineStageId" = 'pipeline-belletje-3'),
    'Belletje 4', (SELECT COUNT(*) FROM "Lead" WHERE "pipelineStageId" = 'pipeline-belletje-4'),
    'Ingepland', (SELECT COUNT(*) FROM "Lead" WHERE "pipelineStageId" = 'pipeline-ingepland'),
    'Deal', (SELECT COUNT(*) FROM "Lead" WHERE "pipelineStageId" = 'pipeline-deal'),
    'Geen interesse', (SELECT COUNT(*) FROM "Lead" WHERE "pipelineStageId" = 'pipeline-geen-interesse')
  )
FROM "_PipelineMigrationSnapshot" snapshot
ON CONFLICT ("migrationKey") DO NOTHING;

COMMIT;
