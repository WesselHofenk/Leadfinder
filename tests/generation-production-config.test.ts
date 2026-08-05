import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("productieconfiguratie voor tienminutenruns", () => {
  it("zet de Vercel-omgeving op tien minuten zonder een betaald croninterval te vereisen", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      env?: Record<string, string>;
      crons?: Array<{ path: string; schedule: string }>;
    };
    expect(config.env?.GENERATION_MAX_RUN_MINUTES).toBe("10");
    expect(config.crons).not.toContainEqual({ path: "/api/cron/generation", schedule: "* * * * *" });
    expect(config.crons).toContainEqual({ path: "/api/cron/cold-email", schedule: "0 7 * * *" });
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
