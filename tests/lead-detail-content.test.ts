import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("praktische leaddetailpagina", () => {
  const source = readFileSync(resolve(process.cwd(), "app/(app)/leads/[id]/page.tsx"), "utf8");

  it("toont praktische contact-, locatie- en leadinformatie", () => {
    expect(source).toContain("Bedrijfsgegevens");
    expect(source).toContain("Volledig adres");
    expect(source).toContain("Google Maps");
    expect(source).toContain("Leadinformatie");
    expect(source).toContain("Geen eigen website gevonden");
  });

  it("bevat geen technische score- of bewijsblokken meer", () => {
    expect(source).not.toContain("Waarom is dit een kans?");
    expect(source).not.toContain("Verificatiebewijs");
    expect(source).not.toContain("Opportunity");
    expect(source).not.toContain("Website-confidence");
    expect(source).not.toContain("Bronrecords");
  });
});
