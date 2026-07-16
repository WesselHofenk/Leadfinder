-- Additieve kwaliteitsvelden; bestaande leads en pipelinegegevens blijven intact.
ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "formattedAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "googleBusinessProfileUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "googleBusinessProfileVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "googleBusinessVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "statusConfidence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "language" TEXT,
  ADD COLUMN IF NOT EXISTS "languageConfidence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "regionLanguage" TEXT,
  ADD COLUMN IF NOT EXISTS "verificationSource" TEXT,
  ADD COLUMN IF NOT EXISTS "socialUrls" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Alleen een reeds normaal adres wordt als formattedAddress overgenomen.
UPDATE "Lead"
SET "formattedAddress" = "streetAddress"
WHERE "formattedAddress" IS NULL
  AND "streetAddress" !~ '\([-+]?[0-9]+\.[0-9]+,\s*[-+]?[0-9]+\.[0-9]+\)';

CREATE INDEX IF NOT EXISTS "Lead_language_country_province_idx" ON "Lead"("language", "country", "province");

CREATE TABLE IF NOT EXISTS "GeocodingCache" (
  "cacheKey" TEXT NOT NULL,
  "latitude" DECIMAL(10,7) NOT NULL,
  "longitude" DECIMAL(10,7) NOT NULL,
  "formattedAddress" TEXT NOT NULL,
  "street" TEXT,
  "houseNumber" TEXT,
  "postalCode" TEXT,
  "city" TEXT NOT NULL,
  "municipality" TEXT,
  "province" TEXT,
  "country" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'NOMINATIM',
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GeocodingCache_pkey" PRIMARY KEY ("cacheKey")
);
CREATE INDEX IF NOT EXISTS "GeocodingCache_expiresAt_idx" ON "GeocodingCache"("expiresAt");

-- Waalse en Duitstalige dekking blijft bewaard, maar wordt niet meer doorzocht.
UPDATE "CoverageArea"
SET "status" = 'PAUSED', "errorMessage" = 'Uitgesloten: buiten Nederlandstalig België'
WHERE "country" = 'BE'
  AND "region" NOT IN ('Antwerpen', 'Limburg', 'Oost-Vlaanderen', 'Vlaams-Brabant', 'West-Vlaanderen', 'Brussel');
