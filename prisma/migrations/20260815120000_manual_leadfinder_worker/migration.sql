ALTER TABLE "LeadfinderTask"
  ALTER COLUMN "enabled" SET DEFAULT false,
  ALTER COLUMN "status" SET DEFAULT 'PAUSED';

UPDATE "LeadfinderTask"
SET
  "enabled" = false,
  "status" = 'PAUSED',
  "currentRunId" = NULL,
  "lastError" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'leadfinder-continuous';

UPDATE "GenerationRun"
SET
  "status" = 'CANCELLED',
  "cancelRequested" = true,
  "continuousRequested" = false,
  "currentPhase" = 'Gepauzeerd',
  "message" = 'De Leadfinder wacht op een handmatige start via de website.',
  "stopReason" = 'Automatische leadgeneratie is uitgeschakeld; handmatig starten is vereist.',
  "finishedAt" = CURRENT_TIMESTAMP,
  "heartbeatAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" IN ('PENDING', 'RUNNING');
