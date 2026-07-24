import { describe, expect, it } from "vitest";

import {
  adaptiveSearchMode,
  lowYieldCooldownMs,
  preferUnusedCities,
  selectAdaptiveSearchArea,
  type SearchAreaCandidate,
  type SearchCombinationMetric,
} from "@/lib/jobs/search-selection";

function area(overrides: Partial<SearchAreaCandidate> = {}): SearchAreaCandidate {
  return {
    id: "area-1",
    country: "NL",
    region: "Noord-Holland",
    municipality: null,
    city: "Amsterdam",
    category: "kapper",
    latitude: 52.37,
    longitude: 4.89,
    radius: 12_000,
    priority: 100,
    lastScannedAt: null,
    nextScanAt: new Date(0),
    ...overrides,
  };
}

function metric(overrides: Partial<SearchCombinationMetric> = {}): SearchCombinationMetric {
  return {
    country: "NL",
    city: "Amsterdam",
    category: "kapper",
    useCount: 1,
    candidatesFound: 1,
    validLeads: 0,
    errorCount: 0,
    lastUsedAt: new Date(0),
    nextEligibleAt: new Date(0),
    ...overrides,
  };
}

const categories = [
  { name: "kapper", priority: 25 },
  { name: "schilder", priority: 100 },
];

describe("adaptieve zoekplanning", () => {
  it("verdeelt iedere tien nieuwe zoeksegmenten in 70% bewezen resultaat en 30% gecontroleerde verkenning", () => {
    const modes = Array.from({ length: 10 }, (_, index) => adaptiveSearchMode(index));
    expect(modes.filter((mode) => mode === "exploit")).toHaveLength(7);
    expect(modes.filter((mode) => mode === "explore")).toHaveLength(3);
  });

  it("kiest in bewezen-resultaatmodus de combinatie met het beste historische rendement", () => {
    const areas = [area({ id: "high" }), area({ id: "low", category: "schilder" })];
    const combinations = [
      metric({ useCount: 10, candidatesFound: 40, validLeads: 12 }),
      metric({ category: "schilder", useCount: 10, candidatesFound: 30, validLeads: 1, errorCount: 2 }),
    ];
    expect(selectAdaptiveSearchArea({ areas, categories, combinations, sequence: 0, now: new Date() })?.id).toBe("high");
  });

  it("geeft in verkenningsmodus voorrang aan een nog niet gebruikte combinatie", () => {
    const areas = [area({ id: "used" }), area({ id: "unseen", city: "Haarlem" })];
    const combinations = [metric({ useCount: 8, candidatesFound: 20, validLeads: 4 })];
    expect(selectAdaptiveSearchArea({ areas, categories, combinations, sequence: 7, now: new Date() })?.id).toBe("unseen");
  });

  it("laat een expliciete beheerprioriteit de gebiedskeuze daadwerkelijk sturen", () => {
    const areas = [
      area({ id: "normal", city: "Haarlem", priority: 100, lastScannedAt: new Date(0) }),
      area({ id: "priority", priority: 1, lastScannedAt: new Date() }),
    ];
    expect(selectAdaptiveSearchArea({ areas, categories, combinations: [], sequence: 0, now: new Date() })?.id)
      .toBe("priority");
  });

  it("laat een expliciete brancheprioriteit de categorie binnen een gebied sturen", () => {
    const areas = [
      area({ id: "normal", category: "schilder", priority: 1, lastScannedAt: new Date(0) }),
      area({ id: "category-priority", category: "kapper", priority: 1, lastScannedAt: new Date() }),
    ];
    expect(selectAdaptiveSearchArea({
      areas,
      categories: [{ name: "kapper", priority: 1 }, { name: "schilder", priority: 100 }],
      combinations: [],
      sequence: 0,
      now: new Date(),
    })?.id).toBe("category-priority");
  });

  it("spreidt opeenvolgende bronverzoeken over verschillende steden", () => {
    const areas = [
      area({ id: "amsterdam-kapper" }),
      area({ id: "amsterdam-schilder", category: "schilder" }),
      area({ id: "haarlem-kapper", city: "Haarlem" }),
    ];
    expect(preferUnusedCities(areas, new Set(["NL:Amsterdam"])).map(({ id }) => id))
      .toEqual(["haarlem-kapper"]);
    expect(preferUnusedCities(areas, new Set(["NL:Amsterdam", "NL:Haarlem"]))).toBe(areas);
  });

  it("slaat een combinatie met een actieve cooldown over", () => {
    const combinations = [metric({ nextEligibleAt: new Date(Date.now() + 60_000) })];
    expect(selectAdaptiveSearchArea({ areas: [area()], categories, combinations, sequence: 0, now: new Date() })).toBeNull();
  });

  it("slaat een categorie over die niet in de actieve categorie-instellingen staat", () => {
    expect(selectAdaptiveSearchArea({
      areas: [area({ category: "uitgeschakeld" })],
      categories,
      combinations: [],
      sequence: 0,
      now: new Date(),
    })).toBeNull();
  });

  it("laat een nulresultaat-combinatie steeds langer afkoelen met een veilige bovengrens", () => {
    expect(lowYieldCooldownMs(0, 0)).toBe(10 * 60 * 1_000);
    expect(lowYieldCooldownMs(8, 0)).toBeLessThanOrEqual(6 * 60 * 60 * 1_000);
    expect(lowYieldCooldownMs(8, 0)).toBeGreaterThan(lowYieldCooldownMs(3, 0));
  });
});
