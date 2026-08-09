BEGIN;

CREATE TEMP TABLE "_LegacyLeadStatusRepairSnapshot" ON COMMIT DROP AS
SELECT
  COUNT(*)::INTEGER AS "totalBefore",
  COUNT(*) FILTER (
    WHERE "status"::TEXT NOT IN (
      'NEW',
      'VOICEMAIL',
      'CALL_BACK',
      'INTERESTED',
      'APPOINTMENT',
      'QUOTE_SENT',
      'CUSTOMER',
      'NOT_INTERESTED'
    )
  )::INTEGER AS "invalidBefore"
FROM "Lead";

-- Productiedata kan nog enumwaarden uit een oudere importer bevatten. Herstel
-- die vanuit de relationele pipelinefase; EMAILED is de oude naam van Gemaild.
UPDATE "Lead"
SET
  "pipelineStageId" = CASE
    WHEN "status"::TEXT = 'EMAILED' THEN 'pipeline-gemaild'
    WHEN "pipelineStageId" IN (
      'pipeline-nieuw',
      'pipeline-belletje-1',
      'pipeline-belletje-2',
      'pipeline-gemaild',
      'pipeline-geen-interesse',
      'pipeline-klant'
    ) THEN "pipelineStageId"
    ELSE 'pipeline-nieuw'
  END,
  "status" = CASE
    WHEN "status"::TEXT = 'EMAILED' THEN 'QUOTE_SENT'::"LeadStatus"
    WHEN "pipelineStageId" = 'pipeline-belletje-1' THEN 'VOICEMAIL'::"LeadStatus"
    WHEN "pipelineStageId" = 'pipeline-belletje-2' THEN 'CALL_BACK'::"LeadStatus"
    WHEN "pipelineStageId" = 'pipeline-gemaild' THEN 'QUOTE_SENT'::"LeadStatus"
    WHEN "pipelineStageId" = 'pipeline-geen-interesse' THEN 'NOT_INTERESTED'::"LeadStatus"
    WHEN "pipelineStageId" = 'pipeline-klant' THEN 'CUSTOMER'::"LeadStatus"
    ELSE 'NEW'::"LeadStatus"
  END
WHERE "status"::TEXT NOT IN (
  'NEW',
  'VOICEMAIL',
  'CALL_BACK',
  'INTERESTED',
  'APPOINTMENT',
  'QUOTE_SENT',
  'CUSTOMER',
  'NOT_INTERESTED'
);

ALTER TABLE "Lead" DROP CONSTRAINT IF EXISTS "Lead_status_canonical_check";
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_status_canonical_check" CHECK (
  "status"::TEXT IN (
    'NEW',
    'VOICEMAIL',
    'CALL_BACK',
    'INTERESTED',
    'APPOINTMENT',
    'QUOTE_SENT',
    'CUSTOMER',
    'NOT_INTERESTED'
  )
);

DO $$
DECLARE
  total_before INTEGER;
  invalid_before INTEGER;
  total_after INTEGER;
  invalid_after INTEGER;
BEGIN
  SELECT "totalBefore", "invalidBefore"
  INTO total_before, invalid_before
  FROM "_LegacyLeadStatusRepairSnapshot";

  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (
      WHERE "status"::TEXT NOT IN (
        'NEW',
        'VOICEMAIL',
        'CALL_BACK',
        'INTERESTED',
        'APPOINTMENT',
        'QUOTE_SENT',
        'CUSTOMER',
        'NOT_INTERESTED'
      )
    )::INTEGER
  INTO total_after, invalid_after
  FROM "Lead";

  IF total_before <> total_after THEN
    RAISE EXCEPTION 'Leadaantal wijzigde tijdens statusherstel: % -> %', total_before, total_after;
  END IF;
  IF invalid_after <> 0 THEN
    RAISE EXCEPTION 'Niet-canonieke leadstatussen over na herstel: %', invalid_after;
  END IF;

  RAISE NOTICE 'Herstelde % niet-canonieke leadstatussen; % leads behouden.', invalid_before, total_after;

  INSERT INTO "PipelineMigrationAudit" (
    "migrationKey",
    "totalBefore",
    "totalAfter",
    "migratedLeads",
    "unknownStages",
    "distributionBefore",
    "distributionAfter"
  ) VALUES (
    '20260809212000_repair_legacy_lead_status_drift',
    total_before,
    total_after,
    invalid_before,
    invalid_before,
    jsonb_build_object('invalidLegacyStatusRows', invalid_before),
    jsonb_build_object('invalidLegacyStatusRows', invalid_after)
  )
  ON CONFLICT ("migrationKey") DO UPDATE SET
    "totalAfter" = EXCLUDED."totalAfter",
    "migratedLeads" = EXCLUDED."migratedLeads",
    "unknownStages" = EXCLUDED."unknownStages",
    "distributionAfter" = EXCLUDED."distributionAfter";
END;
$$;

COMMIT;
