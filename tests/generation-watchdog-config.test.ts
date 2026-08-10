import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("doorlopende generatieconfiguratie", () => {
  it("begrensst iedere run maar laat de permanente taak daarna doorlopen", () => {
    const env = readFileSync(resolve("lib/env.ts"), "utf8");
    const example = readFileSync(resolve(".env.example"), "utf8");
    const vercel = JSON.parse(readFileSync(resolve("vercel.json"), "utf8")) as { env?: Record<string, string> };
    expect(env).toContain("GENERATION_MAX_RUN_MINUTES");
    expect(example).toContain("GENERATION_MAX_RUN_MINUTES");
    expect(vercel.env).toBeUndefined();
  });

  it("start na een begrensde run automatisch de volgende singletonrun", () => {
    const source = readFileSync(resolve("lib/jobs/generation.ts"), "utf8");
    expect(source).toContain("GENERATION_BATCH_DURATION_SECONDS");
    expect(source).toContain("GENERATION_MAX_RUN_MINUTES");
    expect(source).toContain("createGenerationRun({ continuousRequested: true })");
  });

  it("heeft een onafhankelijke cronroute die de watchdog uitvoert", () => {
    const route = readFileSync(resolve("app/api/cron/generation/route.ts"), "utf8");
    const vercel = JSON.parse(readFileSync(resolve("vercel.json"), "utf8")) as { crons?: Array<{ path: string; schedule: string }> };
    const scheduler = readFileSync(resolve(".github/workflows/backend-automations.yml"), "utf8");
    expect(route).toContain("runGenerationWatchdog");
    expect(route).toContain("CRON_SECRET");
    expect(vercel.crons).toBeUndefined();
    expect(scheduler).toContain('cron: "*/5 * * * *"');
    expect(scheduler).toContain('cron: "*/15 * * * *"');
    expect(scheduler.match(/api\/cron\/generation/g)).toHaveLength(1);
    expect(scheduler.match(/api\/cron\/outreach/g)).toHaveLength(1);
    expect(scheduler).not.toContain("api/cron/sync");
    expect(scheduler).not.toMatch(/api\/cron\/outreach\//);
  });

  it("breidt de database uitsluitend additief uit", () => {
    const migration = readFileSync(resolve("prisma/migrations/20260727235000_ten_minute_partial_generation/migration.sql"), "utf8");
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "validDrafts"');
    expect(migration).not.toMatch(/\b(DROP|TRUNCATE|DELETE)\b/i);
  });
});
