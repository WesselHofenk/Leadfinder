import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.join(process.cwd(), "prisma", "migrations", "20260723231000_prioritize_local_categories", "migration.sql"),
  "utf8",
);

describe("standaardprioriteit voor lokale branches", () => {
  it("past alleen de expliciete branches met de onaangeraakte standaardprioriteit aan", () => {
    expect(migration).toContain('UPDATE "Category"');
    expect(migration).toContain('WHERE "priority" = 100');
    expect(migration).toContain("'dakdekker'");
    expect(migration).toContain("'hondenuitlaatservice'");
  });

  it("raakt geen leads, activiteiten, zoekruns of retrykandidaten aan", () => {
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE\s+FROM|TRUNCATE)\s+"?(?:Lead|Activity|GenerationRun|ValidationCandidate)"?/i);
  });
});
