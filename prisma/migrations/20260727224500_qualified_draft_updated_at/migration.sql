-- Een eerder experimenteel concepttabelletje kon al bestaan voordat de
-- formele migratie werd uitgevoerd. Maak de Prisma @updatedAt-kolom daarom
-- expliciet additief, ook wanneer CREATE TABLE IF NOT EXISTS werd overgeslagen.
ALTER TABLE "QualifiedLeadDraft"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
