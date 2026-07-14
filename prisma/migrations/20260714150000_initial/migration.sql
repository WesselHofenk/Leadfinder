-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CALLED', 'NO_ANSWER', 'QUOTE_SENT', 'INVOICED', 'DO_NOT_CONTACT', 'FILTERED');

-- CreateEnum
CREATE TYPE "LeadType" AS ENUM ('NO_WEBSITE', 'OUTDATED_WEBSITE');

-- CreateEnum
CREATE TYPE "BusinessStatus" AS ENUM ('OPERATIONAL', 'CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CoverageStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETE', 'FAILED', 'PAUSED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('DISCOVERY', 'REVERIFY', 'EXPORT', 'WEBSITE_ANALYSIS');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('GOOGLE_PLACES');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "externalPlaceId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "normalizedCompanyName" TEXT NOT NULL,
    "contactPersonName" TEXT,
    "email" TEXT,
    "phoneNumber" TEXT NOT NULL,
    "normalizedPhoneNumber" TEXT NOT NULL,
    "internationalPhoneNumber" TEXT,
    "category" TEXT NOT NULL,
    "subCategory" TEXT,
    "country" TEXT NOT NULL,
    "province" TEXT,
    "municipality" TEXT,
    "city" TEXT NOT NULL,
    "postalCode" TEXT,
    "streetAddress" TEXT NOT NULL,
    "normalizedAddress" TEXT NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "googleMapsUrl" TEXT NOT NULL,
    "website" TEXT,
    "websiteUrl" TEXT,
    "leadType" "LeadType" NOT NULL DEFAULT 'NO_WEBSITE',
    "opportunityScore" INTEGER NOT NULL DEFAULT 0,
    "conversionQualityScore" INTEGER,
    "isFiltered" BOOLEAN NOT NULL DEFAULT false,
    "filterReason" TEXT,
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "lastWebsiteAnalysisAt" TIMESTAMP(3),
    "businessStatus" "BusinessStatus" NOT NULL,
    "source" "LeadSource" NOT NULL DEFAULT 'GOOGLE_PLACES',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "firstDiscoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteAnalysis" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "websiteUrl" TEXT NOT NULL,
    "opportunityScore" INTEGER NOT NULL,
    "mobileScore" INTEGER,
    "desktopScore" INTEGER,
    "conversionQualityScore" INTEGER,
    "isReachable" BOOLEAN NOT NULL,
    "isMobileFriendly" BOOLEAN,
    "hasContactForm" BOOLEAN,
    "hasClearCta" BOOLEAN,
    "hasBrokenLinks" BOOLEAN,
    "brokenLinkCount" INTEGER NOT NULL DEFAULT 0,
    "hasViewportMeta" BOOLEAN,
    "hasOutdatedCopyright" BOOLEAN,
    "hasPlaceholderContent" BOOLEAN,
    "loadTimeMs" INTEGER,
    "reasons" JSONB NOT NULL,
    "rawSignals" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsiteAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadNote" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "googleType" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExcludedCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExcludedCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadHistory" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "actorId" TEXT,
    "event" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageArea" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "municipality" TEXT,
    "city" TEXT NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "radius" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "status" "CoverageStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "lastScannedAt" TIMESTAMP(3),
    "nextScanAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resultsFound" INTEGER NOT NULL DEFAULT 0,
    "apiCallsUsed" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoverageArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanJob" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "coverageAreaId" TEXT,
    "leadId" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "apiCallsUsed" INTEGER NOT NULL DEFAULT 0,
    "recordsFound" INTEGER NOT NULL DEFAULT 0,
    "recordsStored" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiUsage" (
    "id" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobLock" (
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobLock_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_externalPlaceId_key" ON "Lead"("externalPlaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_normalizedPhoneNumber_key" ON "Lead"("normalizedPhoneNumber");

-- CreateIndex
CREATE INDEX "Lead_isActive_country_createdAt_idx" ON "Lead"("isActive", "country", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_city_idx" ON "Lead"("city");

-- CreateIndex
CREATE INDEX "Lead_postalCode_idx" ON "Lead"("postalCode");

-- CreateIndex
CREATE INDEX "Lead_category_idx" ON "Lead"("category");

-- CreateIndex
CREATE INDEX "Lead_status_isFiltered_leadType_idx" ON "Lead"("status", "isFiltered", "leadType");

-- CreateIndex
CREATE INDEX "Lead_opportunityScore_idx" ON "Lead"("opportunityScore");

-- CreateIndex
CREATE INDEX "Lead_lastVerifiedAt_idx" ON "Lead"("lastVerifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "lead_name_address_unique" ON "Lead"("normalizedCompanyName", "normalizedAddress");

-- CreateIndex
CREATE UNIQUE INDEX "lead_name_coordinates_unique" ON "Lead"("normalizedCompanyName", "latitude", "longitude");

-- CreateIndex
CREATE INDEX "WebsiteAnalysis_leadId_createdAt_idx" ON "WebsiteAnalysis"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadNote_leadId_createdAt_idx" ON "LeadNote"("leadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ExcludedCategory_slug_key" ON "ExcludedCategory"("slug");

-- CreateIndex
CREATE INDEX "LeadHistory_leadId_createdAt_idx" ON "LeadHistory"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "CoverageArea_status_nextScanAt_priority_idx" ON "CoverageArea"("status", "nextScanAt", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "CoverageArea_country_city_category_latitude_longitude_key" ON "CoverageArea"("country", "city", "category", "latitude", "longitude");

-- CreateIndex
CREATE INDEX "ScanJob_status_nextAttemptAt_idx" ON "ScanJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ScanJob_type_createdAt_idx" ON "ScanJob"("type", "createdAt");

-- CreateIndex
CREATE INDEX "ScanJob_leadId_status_idx" ON "ScanJob"("leadId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApiUsage_dateKey_provider_key" ON "ApiUsage"("dateKey", "provider");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteAnalysis" ADD CONSTRAINT "WebsiteAnalysis_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadNote" ADD CONSTRAINT "LeadNote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadNote" ADD CONSTRAINT "LeadNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadHistory" ADD CONSTRAINT "LeadHistory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadHistory" ADD CONSTRAINT "LeadHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_coverageAreaId_fkey" FOREIGN KEY ("coverageAreaId") REFERENCES "CoverageArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
