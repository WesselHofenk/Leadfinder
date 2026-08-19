import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("doorlopende leadgeneratie", () => {
  it("staat standaard stil en bewaart de handmatige Start/Stop-keuze duurzaam", () => {
    const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
    const source = readFileSync(resolve("lib/jobs/generation.ts"), "utf8");
    expect(schema).toContain("continuousRequested");
    expect(schema).toContain("model LeadfinderTask");
    expect(schema).toMatch(/enabled\s+Boolean\s+@default\(false\)/);
    expect(source).toContain("createGenerationRun({ continuousRequested: true })");
    expect(source).toContain('reason: "buffer_ready"');
    expect(source.match(/!await leadfinderSearchAllowed\(runId\)/g)).toHaveLength(3);
    expect(source).toContain("handmatig gestopt vóór een nieuwe bronzoekopdracht");
    expect(source).toContain("handmatig gestopt vóór nieuwe vestigingscontroles");
    expect(source).toContain("handmatig gestopt vóór nieuwe websitecontroles");
  });

  it("publiceert een gekwalificeerde lead direct in Nieuw", () => {
    const source = readFileSync(resolve("lib/jobs/generation.ts"), "utf8");
    expect(source).toContain("await stageQualifiedLead(runId, candidate, verification)");
    expect(source).toContain("publishQualifiedDrafts");
    expect(source).toContain("NEW_PIPELINE_STAGE_ID");
  });

  it("toont één duidelijke singleton-taak met echte operationele toestanden", () => {
    const component = readFileSync(resolve("components/generation-button.tsx"), "utf8");
    expect(component.match(/Leadfinder doorlopend zoeken/g)).toHaveLength(1);
    expect(component).not.toContain('method: "PATCH"');
    expect(component).toContain("Nieuwe kandidaten zoeken");
    expect(component).toContain("Worker herstellen");
    expect(component).toContain("traceerbare uitkomst");
    expect(component).toContain("Nieuw-buffer gevuld");
  });
});
