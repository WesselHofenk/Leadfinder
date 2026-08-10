import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("doorlopende leadgeneratie", () => {
  it("bewaart de Start/Stop-keuze duurzaam en hervat via de watchdog", () => {
    const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
    const source = readFileSync(resolve("lib/jobs/generation.ts"), "utf8");
    expect(schema).toContain("continuousRequested Boolean");
    expect(source).toContain("where: { continuousRequested: true }");
    expect(source).toContain("createGenerationRun({ continuousRequested: true })");
  });

  it("publiceert een gekwalificeerde lead direct in Nieuw", () => {
    const source = readFileSync(resolve("lib/jobs/generation.ts"), "utf8");
    expect(source).toContain("await storeNewLead(candidate, verification, runId)");
    expect(source).toContain("stats.stored += 1");
    expect(source).toContain('status: "NEW"');
  });

  it("toont één duidelijke singleton-taak zonder browserworker", () => {
    const component = readFileSync(resolve("components/generation-button.tsx"), "utf8");
    expect(component.match(/Leadfinder doorlopend zoeken/g)).toHaveLength(1);
    expect(component).not.toContain('method: "PATCH"');
    expect(component).toContain("backend draait zelfstandig");
  });
});
