ALTER TYPE "LeadType" ADD VALUE IF NOT EXISTS 'IMPROVABLE_WEBSITE';
ALTER TYPE "WebsiteStatus" ADD VALUE IF NOT EXISTS 'OUTDATED';
ALTER TYPE "WebsiteStatus" ADD VALUE IF NOT EXISTS 'IMPROVABLE';

CREATE TYPE "ConfidenceLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

ALTER TABLE "Lead"
  ADD COLUMN "normalizedDomain" TEXT,
  ADD COLUMN "confidenceScore" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "confidenceLevel" "ConfidenceLevel" NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN "isSuppressed" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "GenerationRun"
  ADD COLUMN "websitesChecked" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "permanentlyClosed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "temporarilyClosed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "noWebsite" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "outdatedWebsite" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "improvableWebsite" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sourceFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "estimatedCostCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "WebsiteAnalysis"
  ADD COLUMN "hasHttps" BOOLEAN,
  ADD COLUMN "hasInvalidSsl" BOOLEAN,
  ADD COLUMN "hasBrokenImages" BOOLEAN,
  ADD COLUMN "brokenImageCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "hasLegacyTechnology" BOOLEAN,
  ADD COLUMN "hasTinyText" BOOLEAN;

CREATE TABLE "SearchCombination" (
  "id" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "useCount" INTEGER NOT NULL DEFAULT 0,
  "candidatesFound" INTEGER NOT NULL DEFAULT 0,
  "validLeads" INTEGER NOT NULL DEFAULT 0,
  "lastUsedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SearchCombination_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DuplicateFingerprint" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "leadId" TEXT,
  "kind" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DuplicateFingerprint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SuppressedLead" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SuppressedLead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceLog" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "city" TEXT,
  "category" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SearchCombination_country_city_category_source_key" ON "SearchCombination"("country", "city", "category", "source");
CREATE INDEX "SearchCombination_lastUsedAt_source_idx" ON "SearchCombination"("lastUsedAt", "source");
CREATE UNIQUE INDEX "DuplicateFingerprint_fingerprint_key" ON "DuplicateFingerprint"("fingerprint");
CREATE INDEX "DuplicateFingerprint_leadId_idx" ON "DuplicateFingerprint"("leadId");
CREATE UNIQUE INDEX "SuppressedLead_fingerprint_key" ON "SuppressedLead"("fingerprint");
CREATE INDEX "SourceLog_runId_createdAt_idx" ON "SourceLog"("runId", "createdAt");
CREATE INDEX "SourceLog_source_level_createdAt_idx" ON "SourceLog"("source", "level", "createdAt");
CREATE INDEX "Lead_normalizedDomain_idx" ON "Lead"("normalizedDomain");
CREATE INDEX "Lead_email_idx" ON "Lead"("email");
CREATE INDEX "Lead_confidenceScore_idx" ON "Lead"("confidenceScore");

ALTER TABLE "SourceLog" ADD CONSTRAINT "SourceLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "GenerationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
