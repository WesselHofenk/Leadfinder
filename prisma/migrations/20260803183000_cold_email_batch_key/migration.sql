ALTER TABLE "ColdEmail" ADD COLUMN "batchKey" TEXT;
CREATE UNIQUE INDEX "ColdEmail_batchKey_leadId_key" ON "ColdEmail"("batchKey", "leadId");
