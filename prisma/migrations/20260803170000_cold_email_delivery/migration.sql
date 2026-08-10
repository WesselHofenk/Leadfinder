CREATE TYPE "ColdEmailStatus" AS ENUM (
  'PENDING',
  'SENDING',
  'SENT_PENDING_ARCHIVE',
  'SENT',
  'FAILED',
  'CANCELLED'
);

CREATE TABLE "ColdEmail" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "createdById" TEXT,
  "fromAddress" TEXT NOT NULL DEFAULT 'info@sitora.nl',
  "recipient" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "bodyText" TEXT NOT NULL,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "allowOutsideWindow" BOOLEAN NOT NULL DEFAULT false,
  "status" "ColdEmailStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "archiveAttempts" INTEGER NOT NULL DEFAULT 0,
  "messageId" TEXT,
  "rawMessageBase64" TEXT,
  "smtpAcceptedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ColdEmail_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ColdEmail_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ColdEmail_status_scheduledFor_idx" ON "ColdEmail"("status", "scheduledFor");
CREATE INDEX "ColdEmail_leadId_createdAt_idx" ON "ColdEmail"("leadId", "createdAt");
CREATE INDEX "ColdEmail_smtpAcceptedAt_archivedAt_idx" ON "ColdEmail"("smtpAcceptedAt", "archivedAt");
