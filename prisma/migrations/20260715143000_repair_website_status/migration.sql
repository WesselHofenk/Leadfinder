ALTER TABLE "Lead"
  ADD COLUMN "websiteStatusReason" TEXT,
  ADD COLUMN "websiteSource" TEXT;

CREATE INDEX "Lead_websiteStatus_isActive_createdAt_idx" ON "Lead"("websiteStatus", "isActive", "createdAt");
