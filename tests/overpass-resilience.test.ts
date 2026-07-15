import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { buildOverpassQuery, categoryFilters, clearOverpassCircuitState, overpassTile, searchOverpass, type OverpassEvent } from "@/lib/openstreetmap/overpass";

const element = {
  type: "node" as const,
  id: 42,
  lat: 52.37,
  lon: 4.9,
  tags: {
    name: "Testbedrijf",
    phone: "+31201234567",
    shop: "hairdresser",
    "addr:street": "Teststraat",
    "addr:housenumber": "1",
    "addr:city": "Amsterdam",
    "addr:postcode": "1011AA",
  },
};

function jsonResponse(elements: unknown[] = [element], status = 200) {
  return new Response(JSON.stringify({ elements }), { status, headers: { "content-type": "application/json" } });
}

const base = {
  endpoints: ["https://one.example/api", "https://two.example/api"],
  country: "NL",
  latitude: 52.3676,
  longitude: 4.9041,
  radius: 12_000,
  category: "kapper",
  retriesPerEndpoint: 1,
  timeoutMs: 5_000,
  totalTimeoutMs: 8_000,
  sleep: async () => undefined,
  random: () => 0,
};

beforeEach(() => clearOverpassCircuitState());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); clearOverpassCircuitState(); });

describe("gerichte Overpass-query", () => {
  it("maakt een kleine geldige tegelquery voor de gekozen branche", () => {
    const tile = overpassTile(52.3676, 4.9041, 12_000, 0);
    const query = buildOverpassQuery({ ...tile, category: "kapper", timeoutSeconds: 10 });
    expect(tile.radius).toBe(1_500);
    expect(categoryFilters("kapper")).toEqual(['["shop"~"^(hairdresser|beauty|massage|cosmetics)$"]']);
    expect(query).toContain("hairdresser");
    expect(query).toContain('["phone"]');
    expect(query).toContain('["contact:phone"]');
    expect(query).not.toContain('[~"^(phone');
    expect(query).toContain("out center tags qt 100");
    expect(overpassTile(52.3676, 4.9041, 12_000, 1).id).toBe("t1");
    expect(overpassTile(52.3676, 4.9041, 12_000, 1).longitude).not.toBe(tile.longitude);
  });

  it("verwerkt een geldige locatie en response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse());
    const result = await searchOverpass({ ...base, fetchImpl: fetchImpl as typeof fetch });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ externalPlaceId: "osm:node/42", companyName: "Testbedrijf" });
  });

  it("bewaart ruwe velden en markeert meertalige sluiting plus websites vóór ingestie", async () => {
    const closedWithWebsite = { ...element, tags: { ...element.tags, description: "Définitivement fermé", "contact:website": "bruna.nl" } };
    const result = await searchOverpass({ ...base, fetchImpl: vi.fn(async () => jsonResponse([closedWithWebsite])) as typeof fetch });
    expect(result.candidates[0]).toMatchObject({ businessStatus: "CLOSED_PERMANENTLY", website: "bruna.nl", rawData: { description: "Définitivement fermé" } });
  });

  it("herkent een expliciet website=no-bronveld zonder het als URL te behandelen", async () => {
    const noWebsite = { ...element, tags: { ...element.tags, website: "no" } };
    const result = await searchOverpass({ ...base, fetchImpl: vi.fn(async () => jsonResponse([noWebsite])) as typeof fetch });
    expect(result.candidates[0]).toMatchObject({ website: undefined, websiteAbsenceConfirmed: true });
  });

  it("verwerkt een lege response zonder te blijven wachten", async () => {
    const result = await searchOverpass({ ...base, fetchImpl: vi.fn(async () => jsonResponse([])) as typeof fetch });
    expect(result.candidates).toEqual([]);
  });

  it("laat een loggingfout nooit een geldige bronresponse blokkeren", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await searchOverpass({
      ...base,
      fetchImpl: vi.fn(async () => jsonResponse()) as typeof fetch,
      onEvent: () => { throw new Error("log database tijdelijk onbeschikbaar"); },
    });
    expect(result.candidates).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("logging_failed"));
  });

  it("weigert een ongeldige locatie voordat een netwerkrequest start", async () => {
    const fetchImpl = vi.fn();
    await expect(searchOverpass({ ...base, latitude: Number.NaN, fetchImpl: fetchImpl as typeof fetch })).rejects.toThrow("locatie");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("timeouts, retries en fallback", () => {
  it("roteert na HTTP 429 naar het volgende endpoint", async () => {
    const events: OverpassEvent[] = [];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "content-type": "text/plain" } }))
      .mockResolvedValueOnce(jsonResponse());
    const result = await searchOverpass({ ...base, fetchImpl, onEvent: (event) => { events.push(event); } });
    expect(result.endpoint).toBe("https://two.example/api");
    expect(events[0]).toMatchObject({ statusCode: 429, errorType: "http_429" });
  });

  it.each([502, 503, 504])("behandelt HTTP %s als tijdelijke bronfout", async (status) => {
    const fetchImpl = vi.fn(async () => new Response("temporary", { status }));
    await expect(searchOverpass({ ...base, endpoints: [base.endpoints[0]], fetchImpl: fetchImpl as typeof fetch })).rejects.toThrow("Alle OpenStreetMap-servers");
  });

  it("breekt een hangend request hard af", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new DOMException("aborted", "AbortError")), { once: true });
    })) as typeof fetch;
    const pending = searchOverpass({ ...base, endpoints: [base.endpoints[0]], fetchImpl });
    const assertion = expect(pending).rejects.toThrow(/timeout|seconden/i);
    await vi.advanceTimersByTimeAsync(5_100);
    await assertion;
  });

  it("herkent een HTML-foutpagina en gebruikt een fallback", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("<html>gateway error</html>", { status: 200, headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(jsonResponse());
    const result = await searchOverpass({ ...base, fetchImpl });
    expect(result.endpoint).toBe("https://two.example/api");
  });

  it("geeft een concrete fout wanneer alle endpoints falen", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("network unavailable"); });
    await expect(searchOverpass({ ...base, fetchImpl: fetchImpl as typeof fetch })).rejects.toThrow("Alle OpenStreetMap-servers zijn mislukt");
  });

  it("retryt een permanente 404 niet op hetzelfde endpoint", async () => {
    const fetchImpl = vi.fn(async () => new Response("not found", { status: 404 }));
    await expect(searchOverpass({ ...base, endpoints: [base.endpoints[0]], retriesPerEndpoint: 2, fetchImpl: fetchImpl as typeof fetch })).rejects.toThrow("HTTP 404");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("breekt een te grote bronresponse af voordat JSON wordt verwerkt", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ elements: [] }), { headers: { "content-type": "application/json", "content-length": "250000" } }));
    await expect(searchOverpass({ ...base, endpoints: [base.endpoints[0]], maxResponseBytes: 100_000, fetchImpl: fetchImpl as typeof fetch })).rejects.toThrow("groter dan");
  });
});
