-- Enum additions from the preceding migration must be committed before PostgreSQL
-- permits their use in data updates.
-- UNKNOWN records stay UNKNOWN and therefore remain outside the active lead list.
UPDATE "Lead"
SET "websiteStatus" = 'WEBSITE_FOUND',
    "websiteConfidence" = 100,
    "status" = CASE WHEN "status" = 'DO_NOT_CONTACT' THEN "status" ELSE 'HAS_WEBSITE' END,
    "isActive" = false,
    "isFiltered" = true,
    "filterReason" = COALESCE("filterReason", 'Eigen website bevestigd'),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "websiteStatus" = 'OWN_WEBSITE';

UPDATE "Lead"
SET "websiteStatus" = 'WEBSITE_OUTDATED',
    "websiteConfidence" = GREATEST("websiteConfidence", 80),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "websiteStatus" = 'OUTDATED';

UPDATE "Lead"
SET "websiteStatus" = 'WEBSITE_BROKEN',
    "websiteConfidence" = GREATEST("websiteConfidence", 70),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "websiteStatus" = 'IMPROVABLE';

UPDATE "Lead"
SET "websiteStatus" = 'NO_WEBSITE_CONFIRMED',
    "websiteConfidence" = 100,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "websiteStatus" = 'NO_OWN_WEBSITE'
  AND "googleWebsitePresent" = false
  AND "googleWebsiteVerifiedAt" IS NOT NULL;
