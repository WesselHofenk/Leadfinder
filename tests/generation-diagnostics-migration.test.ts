import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.join(process.cwd(), "prisma", "migrations", "20260727143000_generation_run_diagnostics", "migration.sql"),
  "utf8",
);

describe("generator diagnostics and Netherlands-only migration", () => {
  it("adds the complete source, filter, database and runtime counters", () => {
    for (const field of [
      "sourceRequests", "sourceSuccesses", "wrongLocationRejected",
      "insufficientDataRejected", "validCandidates", "databaseInsertAttempts",
      "databaseInsertFailures", "totalDurationMs",
    ]) {
      expect(migration).toContain(`"${field}"`);
    }
  });

  it("keeps phone mandatory while making e-mail optional for new active leads", () => {
    expect(migration).toContain('NEW."normalizedPhoneNumber" IS NULL');
    expect(migration).not.toContain('BTRIM(COALESCE(NEW."email"');
    expect(migration).toContain('"Lead_require_qualified_contact_on_insert"');
  });

  it("does not update, delete or suppress existing leads", () => {
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE\s+FROM|TRUNCATE)\s+"?Lead"?/i);
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN)\b/i);
    expect(migration).toContain('WHERE "country" <> \'NL\'');
  });
});
