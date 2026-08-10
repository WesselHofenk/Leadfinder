ALTER TABLE "GenerationRun"
  ADD COLUMN "sourceEmptyResponses" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sourceTechnicalErrors" INTEGER NOT NULL DEFAULT 0;
