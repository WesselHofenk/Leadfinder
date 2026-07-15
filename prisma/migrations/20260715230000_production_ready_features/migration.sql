-- This migration is deliberately additive: existing users, leads and run history
-- remain untouched while the production workflow gains its review and CRM fields.

ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'NEEDS_REVIEW';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'VERIFIED';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'CALL_BACK';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'INTERESTED';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'APPOINTMENT';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'WON';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'LOST';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'HAS_WEBSITE';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'PERMANENTLY_CLOSED';

ALTER TYPE "BusinessStatus" ADD VALUE IF NOT EXISTS 'FUTURE_OPENING';

ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'OPEN_DATA';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'PUBLIC_WEBSITE';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'MANUAL';

ALTER TYPE "WebsiteStatus" ADD VALUE IF NOT EXISTS 'NO_WEBSITE_CONFIRMED';
ALTER TYPE "WebsiteStatus" ADD VALUE IF NOT EXISTS 'NO_WEBSITE_LIKELY';
ALTER TYPE "WebsiteStatus" ADD VALUE IF NOT EXISTS 'SOCIAL_ONLY';
ALTER TYPE "WebsiteStatus" ADD VALUE IF NOT EXISTS 'WEBSITE_FOUND';
ALTER TYPE "WebsiteStatus" ADD VALUE IF NOT EXISTS 'WEBSITE_OUTDATED';
ALTER TYPE "WebsiteStatus" ADD VALUE IF NOT EXISTS 'WEBSITE_BROKEN';
ALTER TYPE "WebsiteStatus" ADD VALUE IF NOT EXISTS 'MANUAL_REVIEW_REQUIRED';

ALTER TABLE "Lead"
  ADD COLUMN "websiteConfidence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sourceUrl" TEXT,
  ADD COLUMN "sourceFetchedAt" TIMESTAMP(3),
  ADD COLUMN "lastContactAt" TIMESTAMP(3),
  ADD COLUMN "nextFollowUpAt" TIMESTAMP(3),
  ADD COLUMN "contactPerson" TEXT,
  ADD COLUMN "conversationSummary" TEXT,
  ADD COLUMN "rejectionReason" TEXT,
  ADD COLUMN "quoteAmountCents" INTEGER,
  ADD COLUMN "expectedRevenueCents" INTEGER,
  ADD COLUMN "wonRevenueCents" INTEGER;

ALTER TABLE "Lead" ALTER COLUMN "source" SET DEFAULT 'OPENSTREETMAP';

ALTER TABLE "GenerationRun"
  ADD COLUMN "manualReview" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "currentPhase" TEXT NOT NULL DEFAULT 'Wachten',
  ADD COLUMN "currentSource" TEXT,
  ADD COLUMN "currentRegion" TEXT,
  ADD COLUMN "stopReason" TEXT,
  ADD COLUMN "warnings" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE "LeadExclusion" (
  "id" TEXT NOT NULL,
  "identityKey" TEXT NOT NULL,
  "source" TEXT,
  "sourceRecordId" TEXT,
  "phoneNormalized" TEXT,
  "domainNormalized" TEXT,
  "nameNormalized" TEXT,
  "postalCode" TEXT,
  "reason" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeadExclusion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceRecord" (
  "id" TEXT NOT NULL,
  "leadId" TEXT,
  "source" TEXT NOT NULL,
  "sourceRecordId" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rawName" TEXT,
  "rawAddress" TEXT,
  "rawPhone" TEXT,
  "rawWebsite" TEXT,
  "rawBusinessStatus" TEXT,
  "payload" JSONB,
  CONSTRAINT "SourceRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VerificationEvidence" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "checkType" TEXT NOT NULL,
  "result" TEXT NOT NULL,
  "confidence" INTEGER NOT NULL,
  "evidenceUrl" TEXT,
  "shortExplanation" TEXT NOT NULL,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerificationEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadActivity" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "actorId" TEXT,
  "type" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadActivity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadExclusion_identityKey_key" ON "LeadExclusion"("identityKey");
CREATE INDEX "LeadExclusion_source_sourceRecordId_idx" ON "LeadExclusion"("source", "sourceRecordId");
CREATE INDEX "LeadExclusion_phoneNormalized_idx" ON "LeadExclusion"("phoneNormalized");
CREATE INDEX "LeadExclusion_domainNormalized_idx" ON "LeadExclusion"("domainNormalized");
CREATE INDEX "LeadExclusion_expiresAt_idx" ON "LeadExclusion"("expiresAt");

CREATE UNIQUE INDEX "SourceRecord_source_sourceRecordId_key" ON "SourceRecord"("source", "sourceRecordId");
CREATE INDEX "SourceRecord_leadId_fetchedAt_idx" ON "SourceRecord"("leadId", "fetchedAt");
CREATE INDEX "SourceRecord_source_fetchedAt_idx" ON "SourceRecord"("source", "fetchedAt");

CREATE INDEX "VerificationEvidence_leadId_checkedAt_idx" ON "VerificationEvidence"("leadId", "checkedAt");
CREATE INDEX "VerificationEvidence_checkType_result_idx" ON "VerificationEvidence"("checkType", "result");
CREATE INDEX "LeadActivity_leadId_createdAt_idx" ON "LeadActivity"("leadId", "createdAt");
CREATE INDEX "LeadActivity_type_createdAt_idx" ON "LeadActivity"("type", "createdAt");

CREATE INDEX "Lead_websiteConfidence_websiteStatus_idx" ON "Lead"("websiteConfidence", "websiteStatus");
CREATE INDEX "Lead_source_sourceFetchedAt_idx" ON "Lead"("source", "sourceFetchedAt");
CREATE INDEX "Lead_nextFollowUpAt_idx" ON "Lead"("nextFollowUpAt");

ALTER TABLE "SourceRecord" ADD CONSTRAINT "SourceRecord_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VerificationEvidence" ADD CONSTRAINT "VerificationEvidence_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
