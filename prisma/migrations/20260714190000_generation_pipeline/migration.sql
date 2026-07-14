CREATE TYPE "WebsiteStatus" AS ENUM ('NO_OWN_WEBSITE', 'OWN_WEBSITE', 'UNKNOWN');
ALTER TYPE "LeadSource" ADD VALUE 'OPENSTREETMAP';

ALTER TABLE "Lead"
ADD COLUMN "houseNumber" TEXT,
ADD COLUMN "websiteStatus" "WebsiteStatus" NOT NULL DEFAULT 'NO_OWN_WEBSITE',
ADD COLUMN "employeeCount" INTEGER;

CREATE TABLE "GenerationRun" (
  "id" TEXT NOT NULL,
  "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
  "targetCount" INTEGER NOT NULL DEFAULT 50,
  "candidatesFound" INTEGER NOT NULL DEFAULT 0,
  "candidatesChecked" INTEGER NOT NULL DEFAULT 0,
  "withoutWebsite" INTEGER NOT NULL DEFAULT 0,
  "duplicates" INTEGER NOT NULL DEFAULT 0,
  "rejected" INTEGER NOT NULL DEFAULT 0,
  "stored" INTEGER NOT NULL DEFAULT 0,
  "placesUsed" JSONB NOT NULL DEFAULT '[]',
  "branchesUsed" JSONB NOT NULL DEFAULT '[]',
  "apiErrors" JSONB NOT NULL DEFAULT '[]',
  "exhausted" BOOLEAN NOT NULL DEFAULT false,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GenerationRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GenerationRun_status_createdAt_idx" ON "GenerationRun"("status", "createdAt");
