import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("productieconfiguratie voor tienminutenruns", () => {
  it("gebruikt geen betaalde Vercel-cron en houdt alleen de cold-emailqueue als ondersteunende worker", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      env?: Record<string, string>;
      crons?: Array<{ path: string; schedule: string }>;
    };
    expect(config.env).toBeUndefined();
    expect(config.crons).toBeUndefined();
    const workflow = readFileSync(".github/workflows/backend-automations.yml", "utf8");
    expect(workflow).toContain("/api/cron/outreach");
    expect(workflow).toContain("catchUp=1");
    expect(workflow).toContain("status=1");
  });

  it("houdt de databasemigratie additief", () => {
    const migration = readFileSync(
      "prisma/migrations/20260728010000_ten_minute_partial_generation/migration.sql",
      "utf8",
    );
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "validDrafts"');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "retryQueueCount"');
    expect(migration).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i);
  });
});
