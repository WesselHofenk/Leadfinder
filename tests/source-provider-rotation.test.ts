import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { searchOverpassHedged } = vi.hoisted(() => ({ searchOverpassHedged: vi.fn() }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({
  OSM_SOURCE_ENABLED: true,
  OVERPASS_API_URLS: "https://overpass-api.de/api/interpreter,https://lz4.overpass-api.de/api/interpreter",
  OVERPASS_TIMEOUT_MS: 9_000,
  OVERPASS_TOTAL_TIMEOUT_MS: 28_000,
  OVERPASS_MAX_RESPONSE_BYTES: 2_000_000,
}) }));
vi.mock("@/lib/openstreetmap/overpass", () => ({ searchOverpassHedged }));

import { OpenStreetMapAdapter } from "@/lib/sources/openstreetmap";

const input = { country: "NL", city: "Breda", latitude: 51.57, longitude: 4.77, radius: 12_000, category: "dakdekker" };

describe("rotatie van gratis OSM-providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchOverpassHedged.mockResolvedValue({ candidates: [], endpoint: "https://overpass-api.de/api/interpreter", tile: { id: "t0-node-phone" }, queryType: "dakdekker:node:phone" });
  });

  it("hedget maximaal drie werkelijk onafhankelijke hosts en kapt een oude 28s-config af", async () => {
    const adapter = new OpenStreetMapAdapter();
    await adapter.searchBusinesses({ ...input, tileCursor: 0 });
    expect(searchOverpassHedged).toHaveBeenCalledWith(expect.objectContaining({
      endpoints: ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"],
      totalTimeoutMs: 12_000,
      hedgeDelayMs: 1_250,
    }));
  });

  it("roteert de volgende tegel naar een andere providercombinatie", async () => {
    const adapter = new OpenStreetMapAdapter();
    await adapter.searchBusinesses({ ...input, tileCursor: 1 });
    expect(searchOverpassHedged).toHaveBeenCalledWith(expect.objectContaining({
      endpoints: ["https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass-api.de/api/interpreter"],
    }));
  });
});
