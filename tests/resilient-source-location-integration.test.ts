import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { assessSingleLocation } from "@/lib/leads/single-location";
import { searchOverpassHedged } from "@/lib/openstreetmap/overpass";

function response(elements: unknown[]) {
  return new Response(JSON.stringify({ elements }), { status: 200, headers: { "content-type": "application/json" } });
}

const first = {
  type: "node", id: 1, lat: 51.588, lon: 4.776, timestamp: "2026-07-01T10:00:00Z",
  tags: { name: "De Vries Schilders Breda", phone: "+31 76 123 45 67", craft: "painter", "addr:street": "Markt", "addr:housenumber": "1", "addr:postcode": "4811AA", "addr:city": "Breda" },
};

async function runSource(elements: unknown[]) {
  const fetchImpl = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("slow.example")) return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
    return Promise.resolve(response(elements));
  }) as typeof fetch;
  return searchOverpassHedged({
    endpoints: ["https://slow.example/api", "https://healthy.example/api"],
    country: "NL", city: "Breda", latitude: 51.588, longitude: 4.776, radius: 6_000, category: "schilder",
    timeoutMs: 5_000, totalTimeoutMs: 8_000, retriesPerEndpoint: 1, hedgeDelayMs: 250,
    fetchImpl, sleep: async () => undefined,
  });
}

describe("veerkrachtige bron-naar-vestigingscontrole", () => {
  it("ontvangt kandidaten via de fallback en keurt alle filialen op verschillende adressen af", async () => {
    const second = { ...first, id: 2, lat: 51.56, lon: 5.09, tags: { ...first.tags, name: "De Vries Schilders Tilburg", phone: "+31 13 222 33 44", "addr:street": "Heuvel", "addr:housenumber": "8", "addr:postcode": "5038AA", "addr:city": "Tilburg" } };
    const result = await runSource([first, second]);
    expect(result.endpoint).toBe("https://healthy.example/api");
    expect(result.candidates).toHaveLength(2);
    for (const candidate of result.candidates) {
      expect(assessSingleLocation(candidate, result.candidates)).toMatchObject({ status: "MULTIPLE", reason: "zelfde_naam_meerdere_adressen" });
    }
  });

  it("laat een zelfstandige enkele vestiging uit dezelfde fallback door naar verdere kwaliteitscontrole", async () => {
    const result = await runSource([first]);
    expect(result.candidates).toHaveLength(1);
    expect(assessSingleLocation(result.candidates[0], result.candidates)).toMatchObject({ status: "CONFIRMED", reason: "enkele_vestiging_bevestigd" });
  });
});
