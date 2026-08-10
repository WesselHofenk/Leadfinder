CREATE TABLE IF NOT EXISTS "LeadfinderTask" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "currentRunId" TEXT,
  "lastRunId" TEXT,
  "lastHeartbeatAt" TIMESTAMP(3),
  "lastError" TEXT,
  "settings" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadfinderTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LeadfinderTask_singleton" CHECK ("id" = 'leadfinder-continuous')
);

CREATE UNIQUE INDEX IF NOT EXISTS "LeadfinderTask_name_key" ON "LeadfinderTask"("name");

INSERT INTO "LeadfinderTask" ("id", "name", "enabled", "status", "updatedAt")
VALUES ('leadfinder-continuous', 'Leadfinder doorlopend zoeken', true, 'ACTIVE', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "ColdEmailCampaign"
  ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL DEFAULT 'Cold emails automatisch versturen',
  ADD COLUMN IF NOT EXISTS "enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "lastHeartbeatAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastSuccessfulSentAt" TIMESTAMP(3);

INSERT INTO "ColdEmailCampaign" (
  "id", "name", "enabled", "status", "startDayKey", "templateSequence", "createdAt", "updatedAt"
)
VALUES (
  'sitora-cold-email', 'Cold emails automatisch versturen', true, 'ACTIVE', '2026-08-10', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

UPDATE "ColdEmailCampaign"
SET "templateSequence" = GREATEST(
  "templateSequence",
  COALESCE((SELECT MAX("templateSequence") FROM "ColdEmailCampaign"), 0)
)
WHERE "id" = 'sitora-cold-email';

UPDATE "ColdEmail"
SET "campaignId" = 'sitora-cold-email'
WHERE "campaignId" IS NOT NULL AND "campaignId" <> 'sitora-cold-email';

DELETE FROM "ColdEmailRun" WHERE "campaignId" <> 'sitora-cold-email';
DELETE FROM "ColdEmailCampaign" WHERE "id" <> 'sitora-cold-email';

UPDATE "ColdEmailCampaign"
SET
  "name" = 'Cold emails automatisch versturen',
  "enabled" = true,
  "status" = 'ACTIVE',
  "startDayKey" = '2026-08-10',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'sitora-cold-email';

CREATE UNIQUE INDEX IF NOT EXISTS "ColdEmailCampaign_name_key" ON "ColdEmailCampaign"("name");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ColdEmailCampaign_singleton') THEN
    ALTER TABLE "ColdEmailCampaign"
      ADD CONSTRAINT "ColdEmailCampaign_singleton" CHECK ("id" = 'sitora-cold-email');
  END IF;
END $$;

WITH ranked_active AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "updatedAt" DESC, "createdAt" DESC, "id") AS position
  FROM "GenerationRun"
  WHERE "status" IN ('PENDING', 'RUNNING')
)
UPDATE "GenerationRun"
SET
  "status" = 'CANCELLED',
  "cancelRequested" = true,
  "continuousRequested" = false,
  "currentPhase" = 'Dubbele achtergrondrun opgeruimd',
  "message" = 'Veilig beëindigd tijdens consolidatie naar één permanente Leadfinder-taak.',
  "stopReason" = 'Dubbele achtergrondrun veilig beëindigd.',
  "finishedAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (SELECT "id" FROM ranked_active WHERE position > 1);

UPDATE "GenerationRun"
SET "continuousRequested" = false
WHERE "status" NOT IN ('PENDING', 'RUNNING') AND "continuousRequested" = true;

UPDATE "GenerationRun"
SET "continuousRequested" = true, "cancelRequested" = false
WHERE "id" = (
  SELECT "id" FROM "GenerationRun"
  WHERE "status" IN ('PENDING', 'RUNNING')
  ORDER BY "updatedAt" DESC, "createdAt" DESC, "id"
  LIMIT 1
);

UPDATE "LeadfinderTask"
SET
  "currentRunId" = (
    SELECT "id" FROM "GenerationRun"
    WHERE "status" IN ('PENDING', 'RUNNING')
    ORDER BY "updatedAt" DESC, "createdAt" DESC, "id"
    LIMIT 1
  ),
  "lastRunId" = (SELECT "id" FROM "GenerationRun" ORDER BY "createdAt" DESC, "id" LIMIT 1),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'leadfinder-continuous';
