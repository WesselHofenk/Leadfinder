import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260723120000_reset_existing_lead_pipeline",
  "migration.sql",
);
const sql = fs.readFileSync(migrationPath, "utf8");

describe("eenmalige reset van de bestaande leadpipeline", () => {
  it("maakt eerst een volledige, herstelbare snapshot en verwijdert daarna pas leads", () => {
    const backup = sql.indexOf('INSERT INTO "LeadPipelineResetBackup"');
    const deletion = sql.indexOf('DELETE FROM "Lead"');
    const audit = sql.indexOf('INSERT INTO "LeadPipelineResetAudit"');

    expect(sql).toMatch(/^BEGIN;/);
    expect(sql.trim()).toMatch(/COMMIT;$/);
    expect(backup).toBeGreaterThan(-1);
    expect(deletion).toBeGreaterThan(backup);
    expect(audit).toBeGreaterThan(deletion);
    expect(sql).toContain('LOCK TABLE "Lead" IN ACCESS EXCLUSIVE MODE');
    expect(sql).not.toMatch(/TRUNCATE/i);
  });

  it("bewaart alle gekoppelde pipelinegegevens en breekt losse verwijzingen veilig af", () => {
    for (const relation of [
      "WebsiteAnalysis",
      "LeadNote",
      "LeadHistory",
      "VerificationEvidence",
      "LeadActivity",
      "SourceRecord",
      "ScanJob",
      "DuplicateFingerprint",
      "ValidationCandidate",
    ]) {
      expect(sql).toContain(`FROM "${relation}"`);
    }

    expect(sql).toContain('UPDATE "SourceRecord"');
    expect(sql).toContain('UPDATE "ScanJob"');
    expect(sql).toContain('UPDATE "DuplicateFingerprint"');
    expect(sql).toContain('UPDATE "ValidationCandidate"');
  });

  it("sluit sterke identiteiten blijvend uit zodat oude leads niet terugkomen", () => {
    for (const identity of ["external:", "google_place_id:", "phone:", "email:", "address:"]) {
      expect(sql).toContain(`'${identity}'`);
    }

    expect(sql).toContain('INSERT INTO "LeadExclusion"');
    expect(sql).toContain('"expiresAt" = NULL');
    expect(sql).toContain("PIPELINE_RESET_20260723");
  });

  it("breekt de transactie af als de back-up of de lege eindstatus niet klopt", () => {
    expect(sql).toContain("backup_count <> expected_count");
    expect(sql).toContain("remaining_count <> 0");
    expect(sql).toContain("RAISE EXCEPTION");
  });
});
