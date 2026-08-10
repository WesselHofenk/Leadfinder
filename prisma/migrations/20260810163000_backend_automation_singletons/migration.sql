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
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "updatedAt" = CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "ColdEmailTask" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "timeZone" TEXT NOT NULL DEFAULT 'Europe/Amsterdam',
  "windowStartHour" INTEGER NOT NULL DEFAULT 9,
  "windowEndHour" INTEGER NOT NULL DEFAULT 17,
  "rampStartDate" TEXT NOT NULL DEFAULT '2026-08-10',
  "startDailyLimit" INTEGER NOT NULL DEFAULT 20,
  "weeklyIncrement" INTEGER NOT NULL DEFAULT 10,
  "maximumDailyLimit" INTEGER NOT NULL DEFAULT 100,
  "lastHeartbeatAt" TIMESTAMP(3),
  "lastSuccessfulSentAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ColdEmailTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ColdEmailTask_singleton" CHECK ("id" = 'cold-email-continuous')
);

CREATE UNIQUE INDEX IF NOT EXISTS "ColdEmailTask_name_key" ON "ColdEmailTask"("name");

INSERT INTO "ColdEmailTask" ("id", "name", "enabled", "status", "updatedAt")
VALUES ('cold-email-continuous', 'Cold emails automatisch versturen', true, 'ACTIVE', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "OutreachEmail"
  ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "providerAcceptedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sentMailbox" TEXT;

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
