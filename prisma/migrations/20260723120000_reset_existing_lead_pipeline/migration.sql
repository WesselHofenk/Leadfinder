BEGIN;

CREATE TABLE IF NOT EXISTS "LeadPipelineResetAudit" (
  "id" TEXT NOT NULL,
  "resetKey" TEXT NOT NULL,
  "totalBefore" INTEGER NOT NULL,
  "backupsCreated" INTEGER NOT NULL,
  "exclusionsCreated" INTEGER NOT NULL,
  "removed" INTEGER NOT NULL,
  "totalAfter" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "backupTable" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadPipelineResetAudit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LeadPipelineResetAudit_resetKey_key"
  ON "LeadPipelineResetAudit"("resetKey");

CREATE TABLE IF NOT EXISTS "LeadPipelineResetBackup" (
  "id" TEXT NOT NULL,
  "resetRunId" TEXT NOT NULL,
  "originalLeadId" TEXT NOT NULL,
  "leadSnapshot" JSONB NOT NULL,
  "relatedSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadPipelineResetBackup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LeadPipelineResetBackup_resetRunId_originalLeadId_key"
  ON "LeadPipelineResetBackup"("resetRunId", "originalLeadId");
CREATE INDEX IF NOT EXISTS "LeadPipelineResetBackup_resetRunId_createdAt_idx"
  ON "LeadPipelineResetBackup"("resetRunId", "createdAt");

-- Voorkom dat een actieve generatie tijdens de reset nog een lead toevoegt.
LOCK TABLE "Lead" IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE "_ExistingLeadsToReset" ON COMMIT DROP AS
SELECT l."id" FROM "Lead" l;

INSERT INTO "LeadPipelineResetBackup" (
  "id",
  "resetRunId",
  "originalLeadId",
  "leadSnapshot",
  "relatedSnapshot"
)
SELECT
  'reset-existing-pipeline-20260723:' || l."id",
  'reset-existing-pipeline-20260723',
  l."id",
  TO_JSONB(l),
  JSONB_BUILD_OBJECT(
    'websiteAnalyses', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM "WebsiteAnalysis" x WHERE x."leadId" = l."id"), '[]'::jsonb),
    'leadNotes', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM "LeadNote" x WHERE x."leadId" = l."id"), '[]'::jsonb),
    'history', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM "LeadHistory" x WHERE x."leadId" = l."id"), '[]'::jsonb),
    'evidence', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM "VerificationEvidence" x WHERE x."leadId" = l."id"), '[]'::jsonb),
    'activities', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM "LeadActivity" x WHERE x."leadId" = l."id"), '[]'::jsonb),
    'sourceRecords', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM "SourceRecord" x WHERE x."leadId" = l."id"), '[]'::jsonb),
    'scanJobs', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM "ScanJob" x WHERE x."leadId" = l."id"), '[]'::jsonb),
    'duplicateFingerprints', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM "DuplicateFingerprint" x WHERE x."leadId" = l."id"), '[]'::jsonb),
    'validationCandidates', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM "ValidationCandidate" x WHERE x."promotedLeadId" = l."id"), '[]'::jsonb)
  )
FROM "Lead" l
JOIN "_ExistingLeadsToReset" r ON r."id" = l."id"
ON CONFLICT ("resetRunId", "originalLeadId") DO NOTHING;

DO $$
DECLARE
  expected_count INTEGER;
  backup_count INTEGER;
BEGIN
  SELECT COUNT(*)::integer INTO expected_count FROM "_ExistingLeadsToReset";
  SELECT COUNT(*)::integer INTO backup_count
  FROM "LeadPipelineResetBackup"
  WHERE "resetRunId" = 'reset-existing-pipeline-20260723';

  IF backup_count <> expected_count THEN
    RAISE EXCEPTION 'Lead pipeline reset geannuleerd: backup bevat % van % leads', backup_count, expected_count;
  END IF;
END $$;

CREATE TEMP TABLE "_ExistingLeadIdentities" ON COMMIT DROP AS
SELECT DISTINCT ON ("identityKey")
  identities."leadId",
  identities."identityKey"
FROM (
  SELECT l."id" AS "leadId", 'external:' || l."externalPlaceId" AS "identityKey"
  FROM "Lead" l
  JOIN "_ExistingLeadsToReset" r ON r."id" = l."id"
  WHERE NULLIF(TRIM(l."externalPlaceId"), '') IS NOT NULL

  UNION ALL

  SELECT l."id", 'google_place_id:' || l."googlePlaceId"
  FROM "Lead" l
  JOIN "_ExistingLeadsToReset" r ON r."id" = l."id"
  WHERE NULLIF(TRIM(l."googlePlaceId"), '') IS NOT NULL

  UNION ALL

  SELECT l."id", 'phone:' || l."normalizedPhoneNumber"
  FROM "Lead" l
  JOIN "_ExistingLeadsToReset" r ON r."id" = l."id"
  WHERE NULLIF(TRIM(l."normalizedPhoneNumber"), '') IS NOT NULL

  UNION ALL

  SELECT l."id", 'email:' || LOWER(TRIM(l."email"))
  FROM "Lead" l
  JOIN "_ExistingLeadsToReset" r ON r."id" = l."id"
  WHERE NULLIF(TRIM(l."email"), '') IS NOT NULL
    AND LOWER(TRIM(l."email")) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'

  UNION ALL

  SELECT
    l."id",
    'address:' || l."normalizedCompanyName" || '|' ||
      TRIM(REGEXP_REPLACE(LOWER(l."city"), '[^a-z0-9]+', ' ', 'g')) || '|' ||
      l."normalizedAddress"
  FROM "Lead" l
  JOIN "_ExistingLeadsToReset" r ON r."id" = l."id"
  WHERE NULLIF(TRIM(l."normalizedCompanyName"), '') IS NOT NULL
    AND NULLIF(TRIM(l."city"), '') IS NOT NULL
    AND NULLIF(TRIM(l."normalizedAddress"), '') IS NOT NULL
) identities
ORDER BY "identityKey", "leadId";

INSERT INTO "LeadExclusion" (
  "id",
  "identityKey",
  "source",
  "sourceRecordId",
  "phoneNormalized",
  "domainNormalized",
  "nameNormalized",
  "postalCode",
  "reason",
  "createdAt",
  "updatedAt"
)
SELECT
  'pipeline-reset-' || MD5(i."identityKey"),
  i."identityKey",
  l."source"::text,
  l."externalPlaceId",
  l."normalizedPhoneNumber",
  l."normalizedDomain",
  l."normalizedCompanyName",
  l."postalCode",
  'PIPELINE_RESET_20260723',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_ExistingLeadIdentities" i
JOIN "Lead" l ON l."id" = i."leadId"
ON CONFLICT ("identityKey") DO UPDATE SET
  "reason" = EXCLUDED."reason",
  "expiresAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "SourceRecord" sr
SET
  "leadId" = NULL,
  "decision" = 'rejected',
  "reasonCode" = 'PIPELINE_RESET_20260723',
  "processedAt" = CURRENT_TIMESTAMP
FROM "_ExistingLeadsToReset" r
WHERE sr."leadId" = r."id";

UPDATE "ScanJob" sj
SET "leadId" = NULL
FROM "_ExistingLeadsToReset" r
WHERE sj."leadId" = r."id";

UPDATE "DuplicateFingerprint" df
SET "leadId" = NULL
FROM "_ExistingLeadsToReset" r
WHERE df."leadId" = r."id";

UPDATE "ValidationCandidate" vc
SET
  "promotedLeadId" = NULL,
  "status" = 'REJECTED',
  "failureReason" = 'PIPELINE_RESET_20260723',
  "lastErrorCode" = 'PIPELINE_RESET_20260723',
  "rejectedAt" = CURRENT_TIMESTAMP
FROM "_ExistingLeadsToReset" r
WHERE vc."promotedLeadId" = r."id";

DELETE FROM "Lead" l
USING "_ExistingLeadsToReset" r
WHERE l."id" = r."id";

DO $$
DECLARE
  remaining_count INTEGER;
BEGIN
  SELECT COUNT(*)::integer INTO remaining_count FROM "Lead";
  IF remaining_count <> 0 THEN
    RAISE EXCEPTION 'Lead pipeline reset geannuleerd: er zijn nog % leads aanwezig', remaining_count;
  END IF;
END $$;

INSERT INTO "LeadPipelineResetAudit" (
  "id",
  "resetKey",
  "totalBefore",
  "backupsCreated",
  "exclusionsCreated",
  "removed",
  "totalAfter",
  "reason",
  "backupTable"
)
SELECT
  'reset-existing-pipeline-20260723',
  'reset-existing-pipeline-20260723',
  (SELECT COUNT(*)::integer FROM "_ExistingLeadsToReset"),
  (SELECT COUNT(*)::integer FROM "LeadPipelineResetBackup" WHERE "resetRunId" = 'reset-existing-pipeline-20260723'),
  (SELECT COUNT(*)::integer FROM "_ExistingLeadIdentities"),
  (SELECT COUNT(*)::integer FROM "_ExistingLeadsToReset"),
  (SELECT COUNT(*)::integer FROM "Lead"),
  'Bestaande pipeline leeggemaakt; sterke identiteiten permanent uitgesloten zodat alleen nieuwe leads terugkomen.',
  'LeadPipelineResetBackup'
ON CONFLICT ("resetKey") DO NOTHING;

COMMIT;
