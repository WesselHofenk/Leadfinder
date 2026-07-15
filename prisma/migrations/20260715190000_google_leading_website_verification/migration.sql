-- Google Places is the authoritative website source. Existing NO_OWN_WEBSITE
-- rows predate explicit proof storage and are quarantined until reverified.
ALTER TABLE "Lead"
  ADD COLUMN "googlePlaceId" TEXT,
  ADD COLUMN "googleWebsiteVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "googleWebsitePresent" BOOLEAN;

ALTER TABLE "Lead" ALTER COLUMN "websiteStatus" SET DEFAULT 'UNKNOWN';

UPDATE "Lead"
SET
  "websiteStatus" = 'UNKNOWN',
  "websiteStatusReason" = 'Oude lead mist expliciet bewijs van een Google Places-websitecontrole',
  "websiteSource" = 'google_reverification_required',
  "isActive" = false,
  "isFiltered" = true,
  "filterReason" = 'Wacht op verplichte Google Places-websitecontrole',
  "status" = CASE WHEN "status" = 'DO_NOT_CONTACT' THEN "status" ELSE 'FILTERED' END
WHERE "websiteStatus" = 'NO_OWN_WEBSITE';

CREATE UNIQUE INDEX "Lead_googlePlaceId_key" ON "Lead"("googlePlaceId");
CREATE INDEX "Lead_googleWebsitePresent_googleWebsiteVerifiedAt_idx"
  ON "Lead"("googleWebsitePresent", "googleWebsiteVerifiedAt");

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_no_website_requires_google_proof"
CHECK (
  "websiteStatus" <> 'NO_OWN_WEBSITE'
  OR (
    "googlePlaceId" IS NOT NULL
    AND "googleWebsiteVerifiedAt" IS NOT NULL
    AND "googleWebsitePresent" = false
  )
);
