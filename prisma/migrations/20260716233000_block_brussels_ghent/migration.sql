BEGIN;

ALTER TABLE "GenerationRun"
  ADD COLUMN IF NOT EXISTS "blockedBrussels" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "blockedGhent" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "invalidPhone" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "languageRejected" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "BlockedLocationCleanupAudit" (
  "id" TEXT NOT NULL,
  "cleanupKey" TEXT NOT NULL,
  "totalChecked" INTEGER NOT NULL,
  "brusselsFound" INTEGER NOT NULL,
  "ghentFound" INTEGER NOT NULL,
  "removed" INTEGER NOT NULL,
  "reasons" JSONB NOT NULL,
  "backupTable" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BlockedLocationCleanupAudit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BlockedLocationCleanupAudit_cleanupKey_key" ON "BlockedLocationCleanupAudit"("cleanupKey");

CREATE TABLE IF NOT EXISTS "BlockedLocationLeadBackup" (
  "id" TEXT NOT NULL,
  "cleanupRunId" TEXT NOT NULL,
  "originalLeadId" TEXT NOT NULL,
  "area" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "leadSnapshot" JSONB NOT NULL,
  "relatedSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BlockedLocationLeadBackup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BlockedLocationLeadBackup_cleanupRunId_originalLeadId_key" ON "BlockedLocationLeadBackup"("cleanupRunId", "originalLeadId");
CREATE INDEX IF NOT EXISTS "BlockedLocationLeadBackup_cleanupRunId_area_idx" ON "BlockedLocationLeadBackup"("cleanupRunId", "area");

CREATE TEMP TABLE "_BlockedLocationsToDelete" ON COMMIT DROP AS
WITH locations AS (
  SELECT
    l."id",
    LEFT(REGEXP_REPLACE(COALESCE(l."postalCode", ''), '[^0-9]', '', 'g'), 4) AS postcode,
    REGEXP_REPLACE(LOWER(CONCAT_WS(' ',
      l."city", l."municipality", l."province", l."postalCode", l."streetAddress", l."formattedAddress", l."regionLanguage",
      COALESCE((SELECT STRING_AGG(CONCAT_WS(' ',
        sr."rawAddress", sr."payload"->>'city', sr."payload"->>'municipality', sr."payload"->>'province',
        sr."payload"->>'postalCode', sr."payload"->>'streetAddress', sr."payload"->>'formattedAddress',
        sr."payload"#>>'{geocoding,city}', sr."payload"#>>'{geocoding,municipality}', sr."payload"#>>'{geocoding,postcode}',
        sr."payload"#>>'{address,city}', sr."payload"#>>'{address,municipality}', sr."payload"#>>'{address,postcode}',
        sr."payload"#>>'{sourceData,city}', sr."payload"#>>'{sourceData,municipality}', sr."payload"#>>'{sourceData,postalCode}',
        sr."payload"->'rawData'->>'addr:city', sr."payload"->'rawData'->>'addr:municipality',
        sr."payload"->'rawData'->>'addr:postcode', sr."payload"->'rawData'->>'addr:province'
      ), ' ') FROM "SourceRecord" sr WHERE sr."leadId" = l."id"), '')
    )), '[^a-z0-9]+', ' ', 'g') AS location_text
  FROM "Lead" l
), detected AS (
  SELECT
    "id",
    CASE
      WHEN postcode IN ('1000','1020','1030','1040','1047','1049','1050','1060','1070','1080','1081','1082','1083','1090','1120','1130','1140','1150','1160','1170','1180','1190','1200','1210')
        OR location_text ~ '(^| )(1000|1020|1030|1040|1047|1049|1050|1060|1070|1080|1081|1082|1083|1090|1120|1130|1140|1150|1160|1170|1180|1190|1200|1210)( |$)' THEN 'BRUSSELS'
      WHEN postcode IN ('9000','9030','9031','9032','9040','9041','9042','9050','9051','9052')
        OR location_text ~ '(^| )(9000|9030|9031|9032|9040|9041|9042|9050|9051|9052)( |$)' THEN 'GHENT'
      WHEN location_text ~ '(^| )(brussel|brussels|bruxelles|brussel stad|bruxelles ville|city of brussels|brussels hoofdstedelijk gewest|r gion de bruxelles capitale|brussels capital region|anderlecht|elsene|ixelles|etterbeek|evere|ganshoren|jette|koekelberg|oudergem|auderghem|schaarbeek|schaerbeek|sint agatha berchem|berchem sainte agathe|sint gillis|saint gilles|sint jans molenbeek|molenbeek saint jean|sint joost ten node|saint josse ten noode|sint lambrechts woluwe|woluwe saint lambert|sint pieters woluwe|woluwe saint pierre|ukkel|uccle|vorst|forest|watermaal bosvoorde|watermael boitsfort)( |$)' THEN 'BRUSSELS'
      WHEN location_text ~ '(^| )(gent|ghent|gand|stad gent|city of ghent|gent centrum|gentbrugge|ledeberg|mariakerke|drongen|wondelgem|sint amandsberg|oostakker|desteldonk|mendonk|sint kruis winkel|zwijnaarde|afsnee)( |$)' THEN 'GHENT'
    END AS area,
    CASE
      WHEN postcode IN ('1000','1020','1030','1040','1047','1049','1050','1060','1070','1080','1081','1082','1083','1090','1120','1130','1140','1150','1160','1170','1180','1190','1200','1210')
        OR location_text ~ '(^| )(1000|1020|1030|1040|1047|1049|1050|1060|1070|1080|1081|1082|1083|1090|1120|1130|1140|1150|1160|1170|1180|1190|1200|1210)( |$)' THEN 'blocked_brussels_postcode:' || CASE WHEN postcode IN ('1000','1020','1030','1040','1047','1049','1050','1060','1070','1080','1081','1082','1083','1090','1120','1130','1140','1150','1160','1170','1180','1190','1200','1210') THEN postcode ELSE 'source_metadata' END
      WHEN postcode IN ('9000','9030','9031','9032','9040','9041','9042','9050','9051','9052')
        OR location_text ~ '(^| )(9000|9030|9031|9032|9040|9041|9042|9050|9051|9052)( |$)' THEN 'blocked_ghent_postcode:' || CASE WHEN postcode IN ('9000','9030','9031','9032','9040','9041','9042','9050','9051','9052') THEN postcode ELSE 'source_metadata' END
      WHEN location_text ~ '(^| )(brussel|brussels|bruxelles|anderlecht|elsene|ixelles|etterbeek|evere|ganshoren|jette|koekelberg|oudergem|auderghem|schaarbeek|schaerbeek|ukkel|uccle|vorst|forest)( |$)' THEN 'blocked_brussels_location'
      ELSE 'blocked_ghent_location'
    END AS reason
  FROM locations
)
SELECT "id", area, reason FROM detected WHERE area IS NOT NULL;

INSERT INTO "BlockedLocationLeadBackup" ("id", "cleanupRunId", "originalLeadId", "area", "reason", "leadSnapshot", "relatedSnapshot")
SELECT
  'cleanup-blocked-brussels-ghent-20260716:' || l."id",
  'cleanup-blocked-brussels-ghent-20260716',
  l."id",
  b.area,
  b.reason,
  TO_JSONB(l),
  JSONB_BUILD_OBJECT(
    'websiteAnalyses', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM "WebsiteAnalysis" x WHERE x."leadId" = l."id"), '[]'::jsonb),
    'leadNotes', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM "LeadNote" x WHERE x."leadId" = l."id"), '[]'::jsonb),
    'history', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM "LeadHistory" x WHERE x."leadId" = l."id"), '[]'::jsonb),
    'evidence', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM "VerificationEvidence" x WHERE x."leadId" = l."id"), '[]'::jsonb),
    'activities', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM "LeadActivity" x WHERE x."leadId" = l."id"), '[]'::jsonb),
    'sourceRecords', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM "SourceRecord" x WHERE x."leadId" = l."id"), '[]'::jsonb),
    'scanJobs', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM "ScanJob" x WHERE x."leadId" = l."id"), '[]'::jsonb),
    'validationCandidates', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM "ValidationCandidate" x WHERE x."promotedLeadId" = l."id"), '[]'::jsonb)
  )
FROM "Lead" l
JOIN "_BlockedLocationsToDelete" b ON b."id" = l."id"
ON CONFLICT ("cleanupRunId", "originalLeadId") DO NOTHING;

INSERT INTO "LeadExclusion" ("id", "identityKey", "source", "sourceRecordId", "phoneNormalized", "nameNormalized", "postalCode", "reason", "createdAt", "updatedAt")
SELECT
  'blocked-' || MD5(l."id"), 'external:' || l."externalPlaceId", l."source"::text, l."externalPlaceId",
  l."normalizedPhoneNumber", l."normalizedCompanyName", l."postalCode", 'blocked_location:' || b.area, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Lead" l JOIN "_BlockedLocationsToDelete" b ON b."id" = l."id"
ON CONFLICT ("identityKey") DO UPDATE SET "reason" = EXCLUDED."reason", "expiresAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "SourceRecord" sr SET "leadId" = NULL, "decision" = 'rejected', "reasonCode" = 'BLOCKED_LOCATION', "processedAt" = CURRENT_TIMESTAMP
FROM "_BlockedLocationsToDelete" b WHERE sr."leadId" = b."id";
UPDATE "ScanJob" sj SET "leadId" = NULL FROM "_BlockedLocationsToDelete" b WHERE sj."leadId" = b."id";
UPDATE "DuplicateFingerprint" df SET "leadId" = NULL FROM "_BlockedLocationsToDelete" b WHERE df."leadId" = b."id";
UPDATE "ValidationCandidate" vc
SET "promotedLeadId" = NULL, "status" = 'REJECTED', "failureReason" = 'BLOCKED_LOCATION', "lastErrorCode" = 'BLOCKED_LOCATION', "rejectedAt" = CURRENT_TIMESTAMP
FROM "_BlockedLocationsToDelete" b WHERE vc."promotedLeadId" = b."id";

DELETE FROM "Lead" l USING "_BlockedLocationsToDelete" b WHERE l."id" = b."id";

INSERT INTO "BlockedLocationCleanupAudit" ("id", "cleanupKey", "totalChecked", "brusselsFound", "ghentFound", "removed", "reasons", "backupTable")
SELECT
  'cleanup-blocked-brussels-ghent-20260716', 'cleanup-blocked-brussels-ghent-20260716',
  (SELECT COUNT(*)::integer FROM "Lead") + COUNT(*)::integer,
  COUNT(*) FILTER (WHERE area = 'BRUSSELS')::integer,
  COUNT(*) FILTER (WHERE area = 'GHENT')::integer,
  COUNT(*)::integer,
  COALESCE(JSONB_OBJECT_AGG("id", reason), '{}'::jsonb),
  'BlockedLocationLeadBackup'
FROM "_BlockedLocationsToDelete"
ON CONFLICT ("cleanupKey") DO NOTHING;

UPDATE "CoverageArea"
SET "status" = 'PAUSED', "errorMessage" = 'Uitgesloten door harde locatieblokkade: Brussel/Gent'
WHERE "country" = 'BE' AND (
  LOWER("region") IN ('brussel', 'brussels', 'bruxelles')
  OR REGEXP_REPLACE(LOWER(CONCAT_WS(' ', "city", "municipality")), '[^a-z0-9]+', ' ', 'g')
    ~ '(^| )(brussel|brussels|bruxelles|gent|ghent|gand|gentbrugge|ledeberg|mariakerke|drongen|wondelgem|sint amandsberg|oostakker|desteldonk|mendonk|sint kruis winkel|zwijnaarde|afsnee)( |$)'
);

UPDATE "ValidationCandidate"
SET "status" = 'REJECTED', "failureReason" = 'BLOCKED_LOCATION', "lastErrorCode" = 'BLOCKED_LOCATION', "rejectedAt" = CURRENT_TIMESTAMP
WHERE REGEXP_REPLACE(LOWER(CONCAT_WS(' ', "city", "streetAddress")), '[^a-z0-9]+', ' ', 'g')
  ~ '(^| )(brussel|brussels|bruxelles|gent|ghent|gand|gentbrugge|ledeberg|mariakerke|drongen|wondelgem|sint amandsberg|oostakker|desteldonk|mendonk|sint kruis winkel|zwijnaarde|afsnee)( |$)'
  OR LEFT(REGEXP_REPLACE(COALESCE("streetAddress", ''), '[^0-9]', '', 'g'), 4) IN ('1000','1020','1030','1040','1047','1049','1050','1060','1070','1080','1081','1082','1083','1090','1120','1130','1140','1150','1160','1170','1180','1190','1200','1210','9000','9030','9031','9032','9040','9041','9042','9050','9051','9052');

COMMIT;
