import { describe, expect, it } from "vitest";
import { isPermanentlyClosed, isTemporarilyClosed } from "@/lib/leads/company-status";

describe("centrale permanent-gesloten-detectie", () => {
  it.each([
    "permanently closed", "permanent closed", "permanently_closed", "permanentlyclosed",
    "permanent gesloten", "permanent gesloten bedrijf", "definitief gesloten", "voorgoed gesloten",
    "gesloten permanent", "définitivement fermé", "fermé définitivement", "dauernd geschlossen",
    "dauerhaft geschlossen", "closed permanently", "CLOSED_PERMANENTLY",
  ])("herkent statusvariant %s", (status) => {
    expect(isPermanentlyClosed({ businessStatus: status })).toBe(true);
  });

  it("doorzoekt geneste objecten, arrays, labels en onverwachte structuren", () => {
    expect(isPermanentlyClosed({ sourceData: { details: [{ badges: [null, { label: "Voorgoed gesloten" }] }] } })).toBe(true);
  });

  it.each([
    { permanentlyClosed: true }, { permanently_closed: 1 }, { isPermanentlyClosed: "YES" }, { closed: true },
    { rawData: { "disused:shop": "yes" } }, { closureSignals: ["abandoned"] },
  ])("herkent booleans en structurele sluitingssignalen", (company) => {
    expect(isPermanentlyClosed(company)).toBe(true);
  });

  it("is defensief bij null, cycli, tijdelijke sluiting en ontkennende tekst", () => {
    const cyclic: Record<string, unknown> = { description: "Niet permanent gesloten" };
    cyclic.self = cyclic;
    expect(isPermanentlyClosed(null)).toBe(false);
    expect(isPermanentlyClosed(cyclic)).toBe(false);
    expect(isPermanentlyClosed({ status: "temporarily closed" })).toBe(false);
    expect(isPermanentlyClosed({ openingHours: { monday: { closed: true } } })).toBe(false);
    expect(isTemporarilyClosed({ operational_status: "tijdelijk gesloten" })).toBe(true);
  });
});
