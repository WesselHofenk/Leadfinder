CREATE TYPE "ColdEmailTemplate" AS ENUM ('A', 'B');

CREATE TABLE "ColdEmailCampaign" (
  "id" TEXT NOT NULL,
  "startDayKey" TEXT NOT NULL,
  "templateSequence" INTEGER NOT NULL DEFAULT 0,
  "pausedUntil" TIMESTAMP(3),
  "lastProviderError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ColdEmailCampaign_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ColdEmailCampaign" ("id", "startDayKey", "templateSequence", "createdAt", "updatedAt")
VALUES ('sitora-cold-email', TO_CHAR(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Amsterdam', 'YYYY-MM-DD'), 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "ColdEmailRun" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "dayKey" TEXT NOT NULL,
  "weekNumber" INTEGER NOT NULL,
  "dailyLimit" INTEGER NOT NULL,
  "scheduled" INTEGER NOT NULL DEFAULT 0,
  "successful" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "movedToEmailed" INTEGER NOT NULL DEFAULT 0,
  "sentItemsConfirmed" INTEGER NOT NULL DEFAULT 0,
  "remainingNewLeads" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ColdEmailRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ColdEmailRun_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ColdEmailCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "ColdEmail"
  ADD COLUMN "campaignId" TEXT,
  ADD COLUMN "campaignDayKey" TEXT,
  ADD COLUMN "templateKey" "ColdEmailTemplate",
  ADD COLUMN "dedupeKey" TEXT,
  ADD COLUMN "recipientDedupeKey" TEXT,
  ADD COLUMN "sentFolder" TEXT,
  ADD COLUMN "sentUid" TEXT,
  ADD COLUMN "sentItemsConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "failureCategory" TEXT;

ALTER TABLE "ColdEmail"
  ADD CONSTRAINT "ColdEmail_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ColdEmailCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

WITH ranked_leads AS (
  SELECT "id", "leadId",
    ROW_NUMBER() OVER (
      PARTITION BY "leadId"
      ORDER BY CASE WHEN "smtpAcceptedAt" IS NOT NULL THEN 0 WHEN "status" <> 'CANCELLED' THEN 1 ELSE 2 END, "createdAt" ASC
    ) AS rank
  FROM "ColdEmail"
)
UPDATE "ColdEmail" AS email
SET "dedupeKey" = 'lead:' || ranked_leads."leadId"
FROM ranked_leads
WHERE email."id" = ranked_leads."id" AND ranked_leads.rank = 1;

WITH ranked_recipients AS (
  SELECT "id", LOWER(TRIM("recipient")) AS normalized_recipient,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(TRIM("recipient"))
      ORDER BY CASE WHEN "smtpAcceptedAt" IS NOT NULL THEN 0 WHEN "status" <> 'CANCELLED' THEN 1 ELSE 2 END, "createdAt" ASC
    ) AS rank
  FROM "ColdEmail"
)
UPDATE "ColdEmail" AS email
SET "recipientDedupeKey" = 'recipient:' || ranked_recipients.normalized_recipient
FROM ranked_recipients
WHERE email."id" = ranked_recipients."id" AND ranked_recipients.rank = 1;

CREATE UNIQUE INDEX "ColdEmail_dedupeKey_key" ON "ColdEmail"("dedupeKey");
CREATE UNIQUE INDEX "ColdEmail_recipientDedupeKey_key" ON "ColdEmail"("recipientDedupeKey");
CREATE INDEX "ColdEmail_campaignId_campaignDayKey_status_idx" ON "ColdEmail"("campaignId", "campaignDayKey", "status");
CREATE INDEX "ColdEmail_messageId_idx" ON "ColdEmail"("messageId");
CREATE UNIQUE INDEX "ColdEmailRun_campaignId_dayKey_key" ON "ColdEmailRun"("campaignId", "dayKey");
CREATE INDEX "ColdEmailRun_dayKey_status_idx" ON "ColdEmailRun"("dayKey", "status");
