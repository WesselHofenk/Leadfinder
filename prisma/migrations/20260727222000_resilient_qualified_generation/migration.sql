ALTER TYPE "WebsiteStatus" ADD VALUE IF NOT EXISTS 'IMPROVABLE_WEBSITE';

DO $$
BEGIN
  CREATE TYPE "ContactValidationStatus" AS ENUM ('PENDING', 'DELIVERABLE', 'VALID', 'INVALID', 'UNKNOWN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "emailValidationStatus" "ContactValidationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "emailValidationSource" TEXT,
  ADD COLUMN IF NOT EXISTS "emailValidatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "phoneValidationStatus" "ContactValidationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "phoneValidationSource" TEXT,
  ADD COLUMN IF NOT EXISTS "phoneValidatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "qualificationReason" TEXT,
  ADD COLUMN IF NOT EXISTS "batchId" TEXT,
  ADD COLUMN IF NOT EXISTS "dedupeFingerprint" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Lead_dedupeFingerprint_key" ON "Lead"("dedupeFingerprint");
CREATE INDEX IF NOT EXISTS "Lead_batchId_idx" ON "Lead"("batchId");

CREATE TABLE IF NOT EXISTS "QualifiedLeadDraft" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QualifiedLeadDraft_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QualifiedLeadDraft_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "GenerationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "QualifiedLeadDraft_fingerprint_key" ON "QualifiedLeadDraft"("fingerprint");
CREATE INDEX IF NOT EXISTS "QualifiedLeadDraft_runId_createdAt_idx" ON "QualifiedLeadDraft"("runId", "createdAt");

-- Voeg echte Vlaamse zoekdekking toe. Brussel en Gent blijven bewust buiten
-- deze lijst en worden daarnaast door de centrale locatieblokkade geweigerd.
INSERT INTO "CoverageArea" (
  "id", "country", "region", "city", "latitude", "longitude", "radius",
  "category", "status", "priority", "nextScanAt", "updatedAt"
)
SELECT
  MD5(CONCAT('coverage:BE:', center.city, ':', category.name)),
  'BE',
  center.region,
  center.city,
  center.latitude,
  center.longitude,
  12000,
  category.name,
  'PENDING'::"CoverageStatus",
  category.priority,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  VALUES
    ('Antwerpen', 'Antwerpen', 51.2194::decimal, 4.4025::decimal),
    ('Antwerpen', 'Mechelen', 51.0259::decimal, 4.4776::decimal),
    ('West-Vlaanderen', 'Brugge', 51.2093::decimal, 3.2247::decimal),
    ('West-Vlaanderen', 'Kortrijk', 50.8280::decimal, 3.2649::decimal),
    ('Vlaams-Brabant', 'Leuven', 50.8798::decimal, 4.7005::decimal),
    ('Limburg', 'Hasselt', 50.9307::decimal, 5.3325::decimal),
    ('Oost-Vlaanderen', 'Aalst', 50.9383::decimal, 4.0392::decimal)
) AS center(region, city, latitude, longitude)
CROSS JOIN "Category" AS category
WHERE category."isActive" = TRUE
ON CONFLICT ("country", "city", "category", "latitude", "longitude") DO UPDATE
SET "region" = EXCLUDED."region",
    "radius" = EXCLUDED."radius",
    "status" = 'PENDING'::"CoverageStatus",
    "errorMessage" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP;
