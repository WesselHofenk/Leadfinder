BEGIN;

ALTER TABLE "Lead"
  ADD COLUMN "singleLocationVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "singleLocationReason" TEXT,
  ADD COLUMN "singleLocationVerifiedAt" TIMESTAMP(3);

ALTER TABLE "GenerationRun"
  ADD COLUMN "multipleLocationsRejected" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "chainRejected" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "franchiseRejected" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sameNameMultipleAddresses" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "samePhoneMultipleAddresses" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locationCountUncertain" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "duplicateListingsMerged" INTEGER NOT NULL DEFAULT 0;

COMMIT;
