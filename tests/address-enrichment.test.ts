import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Candidate } from "@/lib/leads/eligibility";

const mocks = vi.hoisted(() => ({
  cacheFind: vi.fn(),
  cacheUpsert: vi.fn(),
  healthFind: vi.fn(),
  healthUpsert: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {
  geocodingCache: { findFirst: mocks.cacheFind, upsert: mocks.cacheUpsert },
  sourceProviderHealth: { findUnique: mocks.healthFind, upsert: mocks.healthUpsert },
  $transaction: mocks.transaction,
} }));

import { enrichCandidateAddress, needsReverseGeocoding } from "@/lib/leads/address-enrichment";

const candidate: Candidate = {
  externalPlaceId: "osm:node/1", source: "OPENSTREETMAP", companyName: "De Kapper", country: "NL", category: "kapper",
  city: "Utrecht", streetAddress: "Utrecht (52.09070, 5.12140)", latitude: 52.0907, longitude: 5.1214,
  googleMapsUrl: "https://www.openstreetmap.org/node/1",
};

describe("adresverrijking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cacheFind.mockResolvedValue(null);
    mocks.healthFind.mockResolvedValue(null);
    mocks.transaction.mockResolvedValue([]);
  });

  it("herkent een coördinatenplaceholder", () => {
    expect(needsReverseGeocoding(candidate)).toBe(true);
    expect(needsReverseGeocoding({ ...candidate, streetAddress: "Oudegracht 10" })).toBe(false);
  });

  it("zet coördinaten via Nominatim om naar een normaal adres en bewaart dit in de cache", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      display_name: "Oudegracht 10, 3511 AA Utrecht, Nederland",
      address: { road: "Oudegracht", house_number: "10", postcode: "3511 AA", city: "Utrecht", state: "Utrecht", country_code: "nl" },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const enriched = await enrichCandidateAddress(candidate, fetchImpl);
    expect(enriched).toMatchObject({
      streetAddress: "Oudegracht 10, 3511 AA Utrecht, Nederland",
      formattedAddress: "Oudegracht 10, 3511 AA Utrecht, Nederland",
      houseNumber: "10", postalCode: "3511 AA", city: "Utrecht", country: "NL",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(mocks.cacheUpsert).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it("gebruikt een geldige cache zonder externe request", async () => {
    mocks.cacheFind.mockResolvedValue({
      formattedAddress: "Oudegracht 10, 3511 AA Utrecht, Nederland", houseNumber: "10", postalCode: "3511 AA",
      city: "Utrecht", municipality: "Utrecht", province: "Utrecht", country: "NL",
    });
    const fetchImpl = vi.fn();
    const enriched = await enrichCandidateAddress(candidate, fetchImpl);
    expect(enriched.formattedAddress).toBe("Oudegracht 10, 3511 AA Utrecht, Nederland");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("behoudt brondata bij een timeout of fout", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("timeout"));
    await expect(enrichCandidateAddress(candidate, fetchImpl)).resolves.toEqual(candidate);
    expect(mocks.healthUpsert).toHaveBeenCalledOnce();
  });
});
