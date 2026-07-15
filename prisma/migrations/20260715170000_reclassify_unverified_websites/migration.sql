-- The old importer discarded source website fields. An empty legacy value is therefore
-- unverified and must never remain classified as proof of NO_OWN_WEBSITE.
UPDATE "Lead"
SET
  "websiteStatus" = 'UNKNOWN',
  "websiteStatusReason" = 'De bron bevat geen websitewaarde, maar afwezigheid is niet opnieuw bevestigd; handmatige controle nodig',
  "websiteSource" = 'legacy_unverified',
  "leadType" = 'IMPROVABLE_WEBSITE',
  "isActive" = false,
  "isFiltered" = true,
  "status" = 'FILTERED',
  "filterReason" = 'Website-afwezigheid niet bevestigd; handmatige controle nodig',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "websiteStatus" = 'NO_OWN_WEBSITE'
  AND NULLIF(BTRIM(COALESCE("website", '')), '') IS NULL
  AND NULLIF(BTRIM(COALESCE("websiteUrl", '')), '') IS NULL;

-- This exact official website was supplied and verified by the operator.
UPDATE "Lead"
SET
  "website" = 'https://byyoel.nl',
  "websiteUrl" = 'https://byyoel.nl',
  "normalizedDomain" = 'byyoel.nl',
  "websiteStatus" = 'OWN_WEBSITE',
  "websiteStatusReason" = 'Geldige eigen bedrijfswebsite gevonden',
  "websiteSource" = 'operator_verified',
  "leadType" = 'IMPROVABLE_WEBSITE',
  "isActive" = false,
  "isFiltered" = true,
  "status" = 'FILTERED',
  "filterReason" = 'Eigen website bevestigd: https://byyoel.nl',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE LOWER(BTRIM("companyName")) = 'by yoel'
  AND LOWER(BTRIM("city")) = 'abcoude';
