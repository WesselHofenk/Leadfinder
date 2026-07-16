import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve("prisma/migrations/20260717003000_single_location_and_resilient_sources/migration.sql"), "utf8");

describe("veilige één-vestigingsmigratie", () => {
  it("voegt uitsluitend nieuwe velden transactioneel toe", () => {
    expect(sql).toMatch(/^BEGIN;/);
    expect(sql.trim()).toMatch(/COMMIT;$/);
    expect(sql).toContain('ADD COLUMN "singleLocationVerified"');
    expect(sql).toContain('ADD COLUMN "multipleLocationsRejected"');
    expect(sql).toContain('ADD COLUMN "duplicateListingsMerged"');
    expect(sql).not.toMatch(/DELETE|TRUNCATE|DROP\s+(?:TABLE|COLUMN)|UPDATE\s+"Lead"/i);
  });
});
