import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.join(process.cwd(), "prisma", "migrations", "20260723223000_qualified_email_generation", "migration.sql"),
  "utf8",
);

describe("veilige e-mailkwalificatiemigratie", () => {
  it("voegt alleen compatibele velden en de toekomstgerichte insertbarrière toe", () => {
    expect(migration).toMatch(/\bBEGIN\b/i);
    expect(migration).toMatch(/\bCOMMIT\b/i);
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "emailSource"');
    expect(migration).toContain("Lead_require_qualified_contact_on_insert");
  });

  it("wijzigt of verwijdert geen bestaande leadgegevens", () => {
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE\s+FROM|TRUNCATE)\s+"?Lead"?/i);
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN)\b/i);
  });
});
