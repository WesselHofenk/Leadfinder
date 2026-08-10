import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../prisma/migrations/20260810120000_reliable_cold_email_campaign/migration.sql", import.meta.url),
  "utf8",
);

describe("duurzame cold-emailcampagne-migratie", () => {
  it("bewaart startdatum, templatevolgorde en dagelijkse audits in PostgreSQL", () => {
    expect(migration).toContain('CREATE TABLE "ColdEmailCampaign"');
    expect(migration).toContain('"startDayKey" TEXT NOT NULL');
    expect(migration).toContain('"templateSequence" INTEGER NOT NULL DEFAULT 0');
    expect(migration).toContain('CREATE TABLE "ColdEmailRun"');
    expect(migration).toContain("CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Amsterdam'");
  });

  it("voorkomt een tweede duurzame reservering voor dezelfde lead of ontvanger", () => {
    expect(migration).toContain('PARTITION BY "leadId"');
    expect(migration).toContain('PARTITION BY LOWER(TRIM("recipient"))');
    expect(migration).toContain('CREATE UNIQUE INDEX "ColdEmail_dedupeKey_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "ColdEmail_recipientDedupeKey_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "ColdEmailRun_campaignId_dayKey_key"');
  });
});
