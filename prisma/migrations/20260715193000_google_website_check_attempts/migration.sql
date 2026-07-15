ALTER TABLE "Lead" ADD COLUMN "googleWebsiteCheckAttemptedAt" TIMESTAMP(3);

CREATE INDEX "Lead_googleWebsiteCheckAttemptedAt_idx"
  ON "Lead"("googleWebsiteCheckAttemptedAt");
