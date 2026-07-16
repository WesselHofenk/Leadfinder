import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { buildOverpassIdentityQuery, buildOverpassQuery, categoryFilters, clearOverpassCircuitState, nextOverpassTileCursor, OSM_SEARCH_CURSOR_COUNT, OSM_TILE_COUNT, overpassSearchPlan, overpassTile, searchOverpass, searchOverpassHedged, type OverpassEvent } from "@/lib/openstreetmap/overpass";

const element = {
  type: "node" as const,
  id: 42,
  lat: 52.37,
  lon: 4.9,
  timestamp: "2026-07-01T10:00:00Z",
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
  city: "Amsterdam",
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
  it("maakt een kleine geen-websitegerichte tegelquery voor de gekozen branche", () => {
    const tile = overpassTile(52.3676, 4.9041, 12_000, 0);
    const query = buildOverpassQuery({ ...tile, category: "kapper", timeoutSeconds: 10 });
    expect(tile.radius).toBe(2_400);
    expect(categoryFilters("kapper")).toEqual(['["shop"~"^(hairdresser|beauty|massage|cosmetics)$"]']);
    expect(query).toContain("hairdresser");
    expect(query).toContain('["phone"]');
    expect(query).not.toContain('["contact:phone"]');
    expect(query).toContain('[!"website"][!"contact:website"]');
    expect(query).not.toContain('~"^(opening_hours|check_date');
    expect(query).not.toContain('["website"~');
    expect(query).toContain("node(around:");
    expect(query.match(/node\(around:/g)).toHaveLength(1);
    expect(query).not.toContain("nwr(around:");
    expect(query).toContain("out meta qt;");
    expect(query).not.toMatch(/out\s+meta\s+center\s+qt\s+\d+/);
    expect(overpassTile(52.3676, 4.9041, 12_000, 1).id).toBe("t1");
    expect(overpassTile(52.3676, 4.9041, 12_000, 1).latitude).not.toBe(tile.latitude);
    expect(buildOverpassQuery({ ...tile, category: "kapper", timeoutSeconds: 10, contact: "contact:mobile" })).toContain('["contact:mobile"]');
  });

  it("verwerkt een geldige locatie en response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse());
    const result = await searchOverpass({ ...base, fetchImpl: fetchImpl as typeof fetch });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ externalPlaceId: "osm:node/42", companyName: "Testbedrijf" });
  });

  it("verwerkt ook ways en relations en behoudt alle bruikbare contactvelden", async () => {
    const way = { ...element, type: "way" as const, id: 43, lat: undefined, lon: undefined, center: { lat: 52.38, lon: 4.91 }, tags: {
      ...element.tags, phone: "ongeldig; +31 20 765 43 21", mobile: "+31 6 12345678", email: "info@voorbeeld.nl; sales@voorbeeld.nl", website: "no",
    } };
    const relation = { ...way, type: "relation" as const, id: 44, center: { lat: 52.39, lon: 4.92 } };
    const result = await searchOverpass({ ...base, fetchImpl: vi.fn(async () => jsonResponse([way, relation])) as typeof fetch });
    expect(result.candidates.map((candidate) => candidate.externalPlaceId)).toEqual(["osm:way/43", "osm:relation/44"]);
    expect(result.candidates[0]).toMatchObject({
      phoneNumbers: ["ongeldig; +31 20 765 43 21", "+31 6 12345678"],
      emailAddresses: ["info@voorbeeld.nl; sales@voorbeeld.nl"],
      websiteAbsenceConfirmed: true,
      sourceWebsiteFieldsChecked: true,
      sourceUpdatedAt: "2026-07-01T10:00:00Z",
    });
  });

  it("gebruikt branchespecifieke OSM-tags in plaats van alle ambachten", () => {
    expect(categoryFilters("schilder")).toEqual(['["craft"="painter"]']);
    expect(categoryFilters("elektricien")).toEqual(['["craft"="electrician"]']);
    expect(categoryFilters("loodgieter")).toEqual(['["craft"~"^(plumber|hvac)$"]']);
  });

  it("voorkomt dat een tijdelijke bronfout dezelfde tegel oneindig blijft herhalen", () => {
    expect(nextOverpassTileCursor(4)).toBe(5);
    expect(nextOverpassTileCursor(OSM_SEARCH_CURSOR_COUNT - 1)).toBe(0);
  });

  it("verdeelt iedere tegel over losse node-, way- en relation-strategieën", () => {
    expect(OSM_SEARCH_CURSOR_COUNT).toBe(OSM_TILE_COUNT * 3 * 6);
    expect(overpassSearchPlan(0)).toMatchObject({ tileCursor: 0, strategy: "node", contact: "phone", id: "t0-node-phone" });
    expect(overpassSearchPlan(1)).toMatchObject({ tileCursor: 0, strategy: "way", contact: "phone", id: "t0-way-phone" });
    expect(overpassSearchPlan(2)).toMatchObject({ tileCursor: 0, strategy: "relation", contact: "phone", id: "t0-relation-phone" });
    expect(overpassSearchPlan(3)).toMatchObject({ tileCursor: 0, strategy: "node", contact: "contact:phone", id: "t0-node-contact-phone" });
    expect(overpassSearchPlan(18)).toMatchObject({ tileCursor: 1, strategy: "node", contact: "phone", id: "t1-node-phone" });
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

  it("bouwt een kleine exacte identiteitsquery zonder websitefilter", () => {
    const query = buildOverpassIdentityQuery({ ...base, externalPlaceId: "osm:node/42", companyName: 'Kapper "De Hoek"', phoneNumber: "+31201234567", streetAddress: "Teststraat 1", googleMapsUrl: "https://www.openstreetmap.org/node/42", rawData: { phone: "+31 20 123 45 67" } });
    expect(query).toContain('nwr(around:250000');
    expect(query).toContain('["name"="Kapper \\"De Hoek\\""]');
    expect(query).toContain('["phone"="+31 20 123 45 67"]');
    expect(query).not.toContain('[!"website"]');
  });

  it("neemt alleen een expliciete Google-verwijzing over en verzint geen verificatie", async () => {
    const withGoogle = { ...element, tags: { ...element.tags, "google:place_id": "ChIJ-explicit", "google:maps": "https://www.google.com/maps/place/Testbedrijf", "name:nl": "Testbedrijf", business_status: "operational" } };
    const result = await searchOverpass({ ...base, fetchImpl: vi.fn(async () => jsonResponse([withGoogle])) as typeof fetch });
    expect(result.candidates[0]).toMatchObject({
      googlePlaceId: "ChIJ-explicit",
      googleBusinessProfileUrl: "https://www.google.com/maps/place/Testbedrijf",
      googleBusinessProfileVerified: true,
      language: "nl",
    });
    expect(result.candidates[0].googleBusinessStatusVerified).not.toBe(true);
  });

  it("gebruikt de gecontroleerde zoekstad wanneer een OSM-object geen addr:city heeft", async () => {
    const withoutCity = { ...element, id: 99, tags: { ...element.tags, "addr:city": undefined } };
    const result = await searchOverpass({ ...base, city: "Brugge", country: "BE", latitude: 51.2093, longitude: 3.2247, fetchImpl: vi.fn(async () => jsonResponse([withoutCity])) as typeof fetch });
    expect(result.candidates[0]).toMatchObject({ city: "Brugge", country: "BE" });
  });

  it("retryt een tijdelijke bronfout met backoff voordat dezelfde bron wordt opgegeven", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse());
    const result = await searchOverpass({ ...base, endpoints: [base.endpoints[0]], retriesPerEndpoint: 2, fetchImpl, sleep });
    expect(result.candidates).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("breekt een hangend request hard af", async () => {
    vi.useFakeTimers();
    const events: OverpassEvent[] = [];
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new DOMException("aborted", "AbortError")), { once: true });
    })) as typeof fetch;
    const pending = searchOverpass({ ...base, endpoints: [base.endpoints[0]], fetchImpl, onEvent: (event) => { events.push(event); } });
    const assertion = expect(pending).rejects.toThrow(/timeout|seconden/i);
    await vi.advanceTimersByTimeAsync(5_100);
    await assertion;
    expect(events.at(-1)?.errorType).toBe("timeout");
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

  it("laat een volgende zoekquery doorgaan nadat alle endpoints voor één query faalden", async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error("host one unavailable"))
      .mockRejectedValueOnce(new Error("host two unavailable"))
      .mockResolvedValueOnce(jsonResponse());
    await expect(searchOverpass({ ...base, fetchImpl })).rejects.toThrow("Alle OpenStreetMap-servers zijn mislukt");
    await expect(searchOverpass({ ...base, fetchImpl })).resolves.toMatchObject({ candidates: [expect.objectContaining({ companyName: "Testbedrijf" })] });
  });

  it("laat een snelle onafhankelijke fallback winnen zonder op de hangende primaire host te wachten", async () => {
    let primaryAborted = false;
    const fetchImpl = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("one.example")) return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => { primaryAborted = true; reject(init.signal?.reason); }, { once: true });
      });
      return Promise.resolve(jsonResponse());
    }) as typeof fetch;
    const result = await searchOverpassHedged({ ...base, fetchImpl, hedgeDelayMs: 250, sleep: async () => undefined });
    expect(result.endpoint).toBe("https://two.example/api");
    expect(primaryAborted).toBe(true);
  });

  it("voert maximaal één request tegelijk uit per openbare OSM-host", async () => {
    let active = 0;
    let maximum = 0;
    const fetchImpl = vi.fn(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return jsonResponse();
    });
    await Promise.all([
      searchOverpass({ ...base, endpoints: [base.endpoints[0]], fetchImpl: fetchImpl as typeof fetch }),
      searchOverpass({ ...base, endpoints: [base.endpoints[0]], fetchImpl: fetchImpl as typeof fetch }),
    ]);
    expect(maximum).toBe(1);
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
