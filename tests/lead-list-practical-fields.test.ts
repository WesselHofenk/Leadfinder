import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.join(process.cwd(), "app", "(app)", "leads", "page.tsx"), "utf8");

describe("praktische hoofdweergave van leads", () => {
  it.each(["Bedrijf", "Telefoon", "Adres", "Plaats", "Branche", "Land", "Bedrijfsstatus", "Website", "Taal", "Bron", "Pipeline"])("toont kolom %s", (column) => {
    expect(source).toContain(`<th>${column}</th>`);
  });

  it("maakt telefoon en kaartadres klikbaar en toont geen coördinaten als hoofdadres", () => {
    expect(source).toMatch(/href=\{`tel:\$\{lead\.normalizedPhoneNumber\s*\|\|\s*lead\.phoneNumber\}`\}/);
    expect(source).toContain('target="_blank"');
    expect(source).not.toContain("lead.latitude.toString()");
  });
});
