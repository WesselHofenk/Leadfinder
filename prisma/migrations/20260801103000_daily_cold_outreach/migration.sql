ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'EMAILED';

CREATE TYPE "OutreachEmailStatus" AS ENUM ('RESERVED', 'SENT', 'FAILED');

CREATE TABLE "OutreachEmail" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "status" "OutreachEmailStatus" NOT NULL DEFAULT 'RESERVED',
  "recipientEmail" TEXT NOT NULL,
  "companyName" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "dateKey" TEXT NOT NULL,
  "messageId" TEXT,
  "lastError" TEXT,
  "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutreachEmail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutreachEmail_leadId_key" ON "OutreachEmail"("leadId");
CREATE UNIQUE INDEX "OutreachEmail_recipientEmail_key" ON "OutreachEmail"("recipientEmail");
CREATE INDEX "OutreachEmail_dateKey_status_idx" ON "OutreachEmail"("dateKey", "status");
CREATE INDEX "OutreachEmail_status_reservedAt_idx" ON "OutreachEmail"("status", "reservedAt");

ALTER TABLE "OutreachEmail"
  ADD CONSTRAINT "OutreachEmail_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
