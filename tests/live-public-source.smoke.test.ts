import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { searchOverpassHedged } from "@/lib/openstreetmap/overpass";

describe("live openbare-bron-smoketest", () => {
  it.runIf(process.env.LIVE_SOURCE_SMOKE === "true")("ontvangt echte OSM-data via een onafhankelijke providerfallback", async () => {
    const result = await searchOverpassHedged({
      endpoints: [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.private.coffee/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
      ],
      country: "NL", city: "Amsterdam", latitude: 52.3676, longitude: 4.9041,
      radius: 12_000, category: "kapper", timeoutMs: 8_000,
      totalTimeoutMs: 12_000, retriesPerEndpoint: 2, hedgeDelayMs: 1_250,
    });
    console.info(JSON.stringify({ endpoint: result.endpoint, tile: result.tile.id, queryType: result.queryType, candidates: result.candidates.length }));
    expect(result.endpoint).toMatch(/^https:\/\//);
    expect(Array.isArray(result.candidates)).toBe(true);
  }, 20_000);
});
