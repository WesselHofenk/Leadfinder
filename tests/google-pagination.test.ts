import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { searchPlaces } from "@/lib/google/places";

describe("Google Places pagination", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("stuurt het ontvangen page token mee in de volgende zoekopdracht", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ places: [], nextPageToken: "volgende-pagina" }), { status: 200 }));
    const params = { apiKey: "test", query: "kapper", city: "Utrecht", country: "NL", latitude: 52.09, longitude: 5.12, radius: 5000 };
    const first = await searchPlaces(params); await searchPlaces({ ...params, pageToken: first.nextPageToken });
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(first.nextPageToken).toBe("volgende-pagina"); expect(secondBody.pageToken).toBe("volgende-pagina");
  });
});
