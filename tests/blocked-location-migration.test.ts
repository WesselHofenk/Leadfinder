import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(process.cwd(), "prisma", "migrations", "20260716233000_block_brussels_ghent", "migration.sql");
const sql = fs.readFileSync(migrationPath, "utf8");

describe("veilige opschoningsmigratie", () => {
  it("maakt een herstelbare snapshot en audit vóór de gerichte leadverwijdering", () => {
    const backup = sql.indexOf('INSERT INTO "BlockedLocationLeadBackup"');
    const deletion = sql.indexOf('DELETE FROM "Lead"');
    const audit = sql.indexOf('INSERT INTO "BlockedLocationCleanupAudit"');
    expect(backup).toBeGreaterThan(-1);
    expect(deletion).toBeGreaterThan(backup);
    expect(audit).toBeGreaterThan(deletion);
    expect(sql).toContain('JOIN "_BlockedLocationsToDelete"');
    expect(sql).not.toMatch(/DELETE\s+FROM\s+"Lead"\s*;/i);
  });

  it("bewaart gerelateerde pipelinegegevens in de snapshot en koppelt externe rijen veilig los", () => {
    for (const relation of ["WebsiteAnalysis", "LeadNote", "LeadHistory", "VerificationEvidence", "LeadActivity", "SourceRecord", "ScanJob"]) {
      expect(sql).toContain(`FROM "${relation}"`);
    }
    expect(sql).toContain('UPDATE "SourceRecord"');
    expect(sql).toContain('UPDATE "DuplicateFingerprint"');
    expect(sql).toContain("cleanup-blocked-brussels-ghent-20260716");
  });

  it("registreert afzonderlijke aantallen en blokkeert achtergebleven zoek- en retryrecords", () => {
    expect(sql).toContain('COUNT(*) FILTER (WHERE area = \'BRUSSELS\')');
    expect(sql).toContain('COUNT(*) FILTER (WHERE area = \'GHENT\')');
    expect(sql).toContain('UPDATE "CoverageArea"');
    expect(sql).toContain('UPDATE "ValidationCandidate"');
  });
});
