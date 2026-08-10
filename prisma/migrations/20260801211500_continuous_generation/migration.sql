ALTER TABLE "GenerationRun"
  ADD COLUMN IF NOT EXISTS "continuousRequested" BOOLEAN NOT NULL DEFAULT false;
