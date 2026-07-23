import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_CANDIDATES_PER_BATCH, MAX_CANDIDATES_PER_RUN } from "@/lib/jobs/generation-config";

describe("begrensde leadgeneratie", () => {
  it("gebruikt één harde limiet van 200 unieke kandidaten en batches van maximaal 10", () => {
    expect(MAX_CANDIDATES_PER_RUN).toBe(200);
    expect(MAX_CANDIDATES_PER_BATCH).toBe(10);
  });

  it("gebruikt 200 als databasedefault zonder historische runs of kandidaten te wijzigen", () => {
    const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
    const migration = readFileSync(resolve("prisma/migrations/20260723234000_limit_generation_candidates/migration.sql"), "utf8");
    expect(schema).toMatch(/maxCandidates\s+Int\s+@default\(200\)/);
    expect(migration).toContain('ALTER COLUMN "maxCandidates" SET DEFAULT 200');
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE)\b/i);
  });

  it("kan niet via een omgevingswaarde terug naar 1.000 kandidaten", () => {
    const environment = readFileSync(resolve("lib/env.ts"), "utf8");
    expect(environment).not.toContain("GENERATION_MAX_CANDIDATES");
    expect(environment).toContain("LEAD_CANDIDATE_BUFFER: z.coerce.number().int().min(50).max(200).default(200)");
  });
});
