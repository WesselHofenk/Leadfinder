import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isClosedOrInactive,
  isLargeChain,
  normalizePhone,
  qualifyOsmElement,
  type LeadRegion,
  type OsmElement,
} from "@/lib/leads/qualification";
import { generateNewOsmLeads } from "@/lib/providers/openstreetmap-live";

const region: LeadRegion = { name: "Utrecht", province: "Utrecht", bbox: "0,0,1,1" };
const base: OsmElement = {
  type: "node",
  id: 101,
  lat: 52.09,
  lon: 5.12,
  tags: {
    name: "Studio Lokaal",
    shop: "hairdresser",
    phone: "030 - 123 45 67",
    "addr:street": "Voorstraat",
    "addr:housenumber": "10",
    "addr:city": "Utrecht",
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("telefoonvalidatie", () => {
  it("normaliseert een Nederlands nummer naar een blijvende deduplicatiesleutel", () => {
    expect(normalizePhone("030 - 123 45 67")?.normalized).toBe("+31301234567");
  });

  it("weigert placeholders en te korte nummers", () => {
    expect(normalizePhone("0000000000")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
  });
});

describe("harde leadkwalificatie", () => {
  it("laat alleen een actieve zelfstandige zaak zonder website en met telefoon door", () => {
    const result = qualifyOsmElement(base, region);
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.lead.website).toBeUndefined();
      expect(result.lead.phone).toBe("030 - 123 45 67");
      expect(result.lead.source).toBe("openstreetmap");
    }
  });

  it("weigert iedere kandidaat met een websiteveld", () => {
    const result = qualifyOsmElement({ ...base, tags: { ...base.tags, website: "https://voorbeeld.nl" } }, region);
    expect(result).toEqual({ accepted: false, reason: "HAS_WEBSITE" });
  });

  it("weigert permanent gesloten en inactieve zaken", () => {
    expect(isClosedOrInactive({ name: "Zaak", disused: "yes" })).toBe(true);
    expect(qualifyOsmElement({ ...base, tags: { ...base.tags, opening_hours: "closed" } }, region)).toEqual({ accepted: false, reason: "CLOSED_OR_INACTIVE" });
  });

  it("weigert grote franchises en namen met veel vestigingen", () => {
    expect(isLargeChain({ name: "McDonald's Utrecht" })).toBe(true);
    expect(isLargeChain({ name: "Onbekend merk", "brand:wikidata": "Q123" })).toBe(true);
    expect(isLargeChain({ name: "Onbekende formule" }, 3)).toBe(true);
    expect(qualifyOsmElement({ ...base, tags: { ...base.tags, name: "Starbucks Centrum" } }, region)).toEqual({ accepted: false, reason: "FRANCHISE_OR_LARGE_CHAIN" });
  });
});

describe("blijvende unieke generatieruns", () => {
  it("voegt een eerder geziene provider-ID bij de volgende klik niet opnieuw toe", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ elements: [base] }) })));
    const first = await generateNewOsmLeads({ targetCount: 1, maxRegions: 1, seen: { providerIds: [], phoneKeys: [], businessKeys: [] } });
    expect(first.leads).toHaveLength(1);
    const second = await generateNewOsmLeads({
      targetCount: 1,
      maxRegions: 1,
      seen: { providerIds: first.examinedProviderIds, phoneKeys: first.acceptedPhoneKeys, businessKeys: first.acceptedBusinessKeys },
    });
    expect(second.leads).toHaveLength(0);
    expect(second.rejected.ALREADY_SEEN).toBe(1);
  });

  it("weigert twee verschillende bronrecords met hetzelfde telefoonnummer", async () => {
    const duplicate = { ...base, id: 102, tags: { ...base.tags, name: "Andere handelsnaam" } };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ elements: [base, duplicate] }) })));
    const result = await generateNewOsmLeads({ targetCount: 5, maxRegions: 1, seen: { providerIds: [], phoneKeys: [], businessKeys: [] } });
    expect(result.leads).toHaveLength(1);
    expect(result.rejected.DUPLICATE_IN_RUN).toBe(1);
  });
});
