BEGIN;

CREATE TABLE IF NOT EXISTS "DutchLeadRecoveryAudit" (
  "id" TEXT NOT NULL,
  "recoveryKey" TEXT NOT NULL,
  "totalBefore" INTEGER NOT NULL,
  "totalAfter" INTEGER NOT NULL,
  "recognizedDutchLeads" INTEGER NOT NULL,
  "validPipelineStatus" INTEGER NOT NULL,
  "fallbackToNieuw" INTEGER NOT NULL,
  "restored" INTEGER NOT NULL,
  "duplicateGroups" INTEGER NOT NULL,
  "unresolved" INTEGER NOT NULL,
  "distributionBefore" JSONB NOT NULL,
  "distributionAfter" JSONB NOT NULL,
  "backupSchema" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DutchLeadRecoveryAudit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DutchLeadRecoveryAudit_recoveryKey_key" ON "DutchLeadRecoveryAudit"("recoveryKey");

-- De vooraf gemaakte volledige databasesnapshot is een harde voorwaarde.
DO $$
DECLARE
  backup_leads INTEGER;
  current_leads INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "information_schema"."tables"
    WHERE "table_schema" = 'recovery_backup_20260716_165500' AND "table_name" = 'Lead'
  ) THEN
    RAISE EXCEPTION 'Herstel afgebroken: volledige productieback-up ontbreekt';
  END IF;
  EXECUTE 'SELECT COUNT(*)::integer FROM "recovery_backup_20260716_165500"."Lead"' INTO backup_leads;
  SELECT COUNT(*)::integer INTO current_leads FROM "Lead";
  IF backup_leads <> current_leads THEN
    RAISE EXCEPTION 'Herstel afgebroken: leadaantal veranderde sinds de dry-run (% versus %)', backup_leads, current_leads;
  END IF;
END $$;

CREATE TEMP TABLE "_DutchLeadRecoveryCandidates" ON COMMIT DROP AS
SELECT
  l."id",
  l."pipelineStageId" AS "previousPipelineStageId",
  CASE WHEN p."id" IS NULL THEN 'pipeline-nieuw' ELSE l."pipelineStageId" END AS "targetPipelineStageId",
  l."isActive" AS "previousIsActive",
  l."isFiltered" AS "previousIsFiltered",
  l."isSuppressed" AS "previousIsSuppressed"
FROM "Lead" l
LEFT JOIN "PipelineStage" p ON p."id" = l."pipelineStageId" AND p."isActive" = true
WHERE
  UPPER(TRIM(COALESCE(l."country", ''))) IN ('NL', 'NEDERLAND', 'NETHERLANDS')
  OR COALESCE(l."postalCode", '') ~* '^[1-9][0-9]{3}[[:space:]]?[A-Z]{2}$'
  OR LOWER(TRIM(COALESCE(l."province", ''))) IN (
    'drenthe','flevoland','friesland','fryslân','gelderland','groningen','limburg','noord-brabant',
    'noord-holland','overijssel','utrecht','zeeland','zuid-holland'
  )
  OR (
    COALESCE(l."normalizedPhoneNumber", l."phoneNumber", '') LIKE '+31%'
    AND COALESCE(l."city", '') <> ''
    AND UPPER(TRIM(COALESCE(l."country", ''))) NOT IN ('BE','BELGIË','BELGIE','BELGIUM')
  );

CREATE TEMP TABLE "_DutchLeadRecoveryDuplicateGroups" ON COMMIT DROP AS
SELECT "identityKey", COUNT(*)::integer AS "count"
FROM (
  SELECT CASE
    WHEN NULLIF(l."externalPlaceId", '') IS NOT NULL THEN 'external:' || l."externalPlaceId"
    WHEN NULLIF(l."normalizedCompanyName", '') IS NOT NULL AND NULLIF(l."normalizedAddress", '') IS NOT NULL
      THEN 'name-address:' || l."normalizedCompanyName" || '|' || l."normalizedAddress"
    ELSE 'id:' || l."id"
  END AS "identityKey"
  FROM "Lead" l JOIN "_DutchLeadRecoveryCandidates" c ON c."id" = l."id"
) identities
GROUP BY "identityKey" HAVING COUNT(*) > 1;

DO $$
DECLARE duplicate_groups INTEGER;
BEGIN
  SELECT COUNT(*)::integer INTO duplicate_groups FROM "_DutchLeadRecoveryDuplicateGroups";
  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION 'Herstel afgebroken: % onverwachte duplicaatgroepen vereisen handmatige samenvoeging', duplicate_groups;
  END IF;
END $$;

CREATE TEMP TABLE "_DutchLeadRecoveryBefore" ON COMMIT DROP AS
SELECT
  (SELECT COUNT(*)::integer FROM "Lead") AS "total",
  (SELECT MD5(COALESCE(STRING_AGG(l."id" || ':' || MD5(TO_JSONB(l)::text), '|' ORDER BY l."id"), ''))
   FROM "Lead" l WHERE NOT EXISTS (SELECT 1 FROM "_DutchLeadRecoveryCandidates" c WHERE c."id" = l."id")) AS "foreignFingerprint",
  (SELECT COALESCE(JSONB_OBJECT_AGG(p."slug", counts."count" ORDER BY p."position"), '{}'::jsonb)
   FROM "PipelineStage" p
   LEFT JOIN (
     SELECT l."pipelineStageId", COUNT(*)::integer AS "count"
     FROM "Lead" l JOIN "_DutchLeadRecoveryCandidates" c ON c."id" = l."id"
     GROUP BY l."pipelineStageId"
   ) counts ON counts."pipelineStageId" = p."id"
   WHERE p."isActive") AS "distribution";

UPDATE "Lead" l
SET
  "pipelineStageId" = c."targetPipelineStageId",
  "isActive" = true,
  "isFiltered" = false,
  "isSuppressed" = false
FROM "_DutchLeadRecoveryCandidates" c
WHERE l."id" = c."id";

INSERT INTO "LeadHistory" ("id", "leadId", "actorId", "event", "details", "createdAt")
SELECT
  'restore-nl-20260716-history-' || MD5(c."id"), c."id", NULL, 'DUTCH_LEAD_RECOVERED',
  JSONB_BUILD_OBJECT(
    'recoveryKey', 'restore-dutch-leads-20260716',
    'previousPipelineStageId', c."previousPipelineStageId",
    'pipelineStageId', c."targetPipelineStageId",
    'previousIsActive', c."previousIsActive",
    'previousIsFiltered', c."previousIsFiltered",
    'previousIsSuppressed', c."previousIsSuppressed"
  ), CURRENT_TIMESTAMP
FROM "_DutchLeadRecoveryCandidates" c
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LeadActivity" ("id", "leadId", "actorId", "type", "summary", "details", "createdAt")
SELECT
  'restore-nl-20260716-activity-' || MD5(c."id"), c."id", NULL, 'DUTCH_LEAD_RECOVERED',
  'Bestaande Nederlandse lead veilig teruggezet in de verkooppipeline.',
  JSONB_BUILD_OBJECT('recoveryKey', 'restore-dutch-leads-20260716', 'pipelineStageId', c."targetPipelineStageId"),
  CURRENT_TIMESTAMP
FROM "_DutchLeadRecoveryCandidates" c
ON CONFLICT ("id") DO NOTHING;

-- Houd de deployment-compatibele enumspiegel synchroon met alle tien relationele fases.
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
        WHEN 'pipeline-gemaild' THEN 'QUOTE_SENT'::"LeadStatus"
        WHEN 'pipeline-ingepland' THEN 'APPOINTMENT'::"LeadStatus"
        WHEN 'pipeline-deal' THEN 'CUSTOMER'::"LeadStatus"
        WHEN 'pipeline-geen-interesse' THEN 'NOT_INTERESTED'::"LeadStatus"
        WHEN 'pipeline-terugbel-verzoek' THEN 'CALL_BACK'::"LeadStatus"
        ELSE 'NEW'::"LeadStatus" END;
    END IF;
  ELSIF NEW."pipelineStageId" IS DISTINCT FROM OLD."pipelineStageId" THEN
    NEW."status" := CASE NEW."pipelineStageId"
      WHEN 'pipeline-belletje-1' THEN 'VOICEMAIL'::"LeadStatus"
      WHEN 'pipeline-belletje-2' THEN 'CALL_BACK'::"LeadStatus"
      WHEN 'pipeline-belletje-3' THEN 'INTERESTED'::"LeadStatus"
      WHEN 'pipeline-belletje-4' THEN 'QUOTE_SENT'::"LeadStatus"
      WHEN 'pipeline-gemaild' THEN 'QUOTE_SENT'::"LeadStatus"
      WHEN 'pipeline-ingepland' THEN 'APPOINTMENT'::"LeadStatus"
      WHEN 'pipeline-deal' THEN 'CUSTOMER'::"LeadStatus"
      WHEN 'pipeline-geen-interesse' THEN 'NOT_INTERESTED'::"LeadStatus"
      WHEN 'pipeline-terugbel-verzoek' THEN 'CALL_BACK'::"LeadStatus"
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

INSERT INTO "DutchLeadRecoveryAudit" (
  "id", "recoveryKey", "totalBefore", "totalAfter", "recognizedDutchLeads", "validPipelineStatus",
  "fallbackToNieuw", "restored", "duplicateGroups", "unresolved", "distributionBefore", "distributionAfter", "backupSchema"
)
SELECT
  'restore-dutch-leads-20260716', 'restore-dutch-leads-20260716', b."total", (SELECT COUNT(*)::integer FROM "Lead"),
  (SELECT COUNT(*)::integer FROM "_DutchLeadRecoveryCandidates"),
  (SELECT COUNT(*)::integer FROM "_DutchLeadRecoveryCandidates" WHERE "previousPipelineStageId" = "targetPipelineStageId"),
  (SELECT COUNT(*)::integer FROM "_DutchLeadRecoveryCandidates" WHERE "previousPipelineStageId" <> "targetPipelineStageId"),
  (SELECT COUNT(*)::integer FROM "_DutchLeadRecoveryCandidates"),
  (SELECT COUNT(*)::integer FROM "_DutchLeadRecoveryDuplicateGroups"), 0, b."distribution",
  (SELECT COALESCE(JSONB_OBJECT_AGG(p."slug", counts."count" ORDER BY p."position"), '{}'::jsonb)
   FROM "PipelineStage" p
   LEFT JOIN (
     SELECT l."pipelineStageId", COUNT(*)::integer AS "count"
     FROM "Lead" l JOIN "_DutchLeadRecoveryCandidates" c ON c."id" = l."id"
     GROUP BY l."pipelineStageId"
   ) counts ON counts."pipelineStageId" = p."id"
   WHERE p."isActive"),
  'recovery_backup_20260716_165500'
FROM "_DutchLeadRecoveryBefore" b
ON CONFLICT ("recoveryKey") DO NOTHING;

DO $$
DECLARE
  total_before INTEGER;
  total_after INTEGER;
  foreign_before TEXT;
  foreign_after TEXT;
  hidden_dutch INTEGER;
BEGIN
  SELECT "total", "foreignFingerprint" INTO total_before, foreign_before FROM "_DutchLeadRecoveryBefore";
  SELECT COUNT(*)::integer INTO total_after FROM "Lead";
  SELECT MD5(COALESCE(STRING_AGG(l."id" || ':' || MD5(TO_JSONB(l)::text), '|' ORDER BY l."id"), ''))
  INTO foreign_after FROM "Lead" l
  WHERE NOT EXISTS (SELECT 1 FROM "_DutchLeadRecoveryCandidates" c WHERE c."id" = l."id");
  SELECT COUNT(*)::integer INTO hidden_dutch
  FROM "Lead" l JOIN "_DutchLeadRecoveryCandidates" c ON c."id" = l."id"
  WHERE NOT l."isActive" OR l."isFiltered" OR l."isSuppressed";

  IF total_before <> total_after THEN
    RAISE EXCEPTION 'Herstel wijzigde onverwacht het totale leadaantal';
  END IF;
  IF foreign_before IS DISTINCT FROM foreign_after THEN
    RAISE EXCEPTION 'Herstel wijzigde onverwacht een niet-Nederlandse lead';
  END IF;
  IF hidden_dutch <> 0 THEN
    RAISE EXCEPTION 'Herstel liet % Nederlandse leads verborgen', hidden_dutch;
  END IF;
END $$;

COMMIT;
