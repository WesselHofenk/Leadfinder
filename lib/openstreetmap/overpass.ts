import "server-only";

import type { Candidate } from "@/lib/leads/eligibility";
import { backoffDelayMs, isRetryableStatus } from "@/lib/jobs/backoff";
import { isPermanentlyClosed } from "@/lib/leads/company-status";

type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
  timestamp?: string;
};

export type OverpassEvent = {
  endpoint: string;
  queryType: string;
  tile: string;
  attempt: number;
  durationMs: number;
  statusCode?: number;
  resultCount?: number;
  errorType?: string;
  message: string;
};

type SearchParams = {
  endpoints: string[];
  country: string;
  latitude: number;
  longitude: number;
  radius: number;
  category?: string;
  tileCursor?: number;
  timeoutMs?: number;
  totalTimeoutMs?: number;
  maxResponseBytes?: number;
  retriesPerEndpoint?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onEvent?: (event: OverpassEvent) => void | Promise<void>;
};

export type OverpassElementStrategy = "node" | "way" | "relation";

const permanentSignals = ["disused", "abandoned", "demolished", "removed", "razed", "was"];
const tileOffsets = Array.from({ length: 5 }, (_, row) => Array.from({ length: 5 }, (_, column) => [row - 2, column - 2] as const))
  .flat().sort(([rowA, columnA], [rowB, columnB]) => (rowA ** 2 + columnA ** 2) - (rowB ** 2 + columnB ** 2) || rowA - rowB || columnA - columnB);
export const OSM_TILE_COUNT = tileOffsets.length;
const elementStrategies: readonly OverpassElementStrategy[] = ["node", "way", "relation"];
export const OSM_SEARCH_CURSOR_COUNT = OSM_TILE_COUNT * elementStrategies.length;

export function overpassSearchPlan(cursor = 0) {
  const normalized = ((cursor % OSM_SEARCH_CURSOR_COUNT) + OSM_SEARCH_CURSOR_COUNT) % OSM_SEARCH_CURSOR_COUNT;
  const strategyIndex = normalized % elementStrategies.length;
  const tileCursor = Math.floor(normalized / elementStrategies.length);
  const strategy = elementStrategies[strategyIndex];
  return { cursor: normalized, tileCursor, strategy, id: `t${tileCursor}-${strategy}` };
}

export function nextOverpassTileCursor(current: number) {
  const normalized = ((current % OSM_SEARCH_CURSOR_COUNT) + OSM_SEARCH_CURSOR_COUNT) % OSM_SEARCH_CURSOR_COUNT;
  // A failed query must not pin a search combination to the same expensive tile forever.
  // The failure is logged separately, so moving on loses no evidence and avoids a retry loop.
  return (normalized + 1) % OSM_SEARCH_CURSOR_COUNT;
}

const endpointHealth = new Map<string, { failures: number; openUntil: number }>();
const endpointLocks = new Map<string, Promise<void>>();
const circuitFailureThreshold = 2;
const circuitCooldownMs = 30_000;

export function clearOverpassCircuitState() { endpointHealth.clear(); }

async function withEndpointLock<T>(endpoint: string, task: () => Promise<T>) {
  const host = new URL(endpoint).host;
  const previous = endpointLocks.get(host) ?? Promise.resolve();
  let releaseGate: () => void = () => {};
  const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
  const tail = previous.catch(() => undefined).then(() => gate);
  endpointLocks.set(host, tail);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    releaseGate();
    if (endpointLocks.get(host) === tail) endpointLocks.delete(host);
  }
}

function healthyEndpoints(endpoints: string[], now: number) {
  const available = endpoints.filter((endpoint) => (endpointHealth.get(endpoint)?.openUntil ?? 0) <= now);
  return available.length ? available : endpoints;
}

function recordEndpointFailure(endpoint: string, now: number) {
  const current = endpointHealth.get(endpoint) ?? { failures: 0, openUntil: 0 };
  const failures = current.failures + 1;
  endpointHealth.set(endpoint, { failures, openUntil: failures >= circuitFailureThreshold ? now + circuitCooldownMs : 0 });
}

function recordEndpointSuccess(endpoint: string) { endpointHealth.delete(endpoint); }

function closedSignals(tags: Record<string, string>) {
  const signals: string[] = [];
  for (const key of permanentSignals) {
    if (tags[key] || Object.keys(tags).some((tag) => tag.startsWith(`${key}:`))) signals.push(key);
  }
  if (tags.end_date && /^\d{4}/.test(tags.end_date) && Number(tags.end_date.slice(0, 4)) <= new Date().getFullYear()) signals.push("end_date");
  if (["closed", "permanently_closed"].includes(tags.opening_hours?.toLowerCase())) signals.push("opening_hours");
  return signals;
}

function candidatesFrom(elements: OsmElement[], country: string): Candidate[] {
  const candidates = elements.flatMap((element): Candidate[] => {
    const tags = element.tags ?? {};
    const latitude = element.lat ?? element.center?.lat;
    const longitude = element.lon ?? element.center?.lon;
    if (!tags.name || latitude == null || longitude == null) return [];
    const street = tags["addr:full"] || [tags["addr:street"] || tags["contact:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
    const city = tags["addr:city"] || tags["addr:place"] || tags["addr:municipality"] || tags["addr:suburb"] || "Onbekend";
    const category = tags.shop || tags.craft || tags.office || tags.amenity || tags.tourism || tags.healthcare || "bedrijf";
    const closureSignals = closedSignals(tags);
    const rawWebsiteValues = [tags.website, tags["contact:website"], tags.url, tags["contact:url"], tags["operator:website"], tags["brand:website"]].filter((value): value is string => Boolean(value));
    const noWebsiteValues = new Set(["no", "none", "nee", "geen", "n.v.t.", "nvt"]);
    const positiveWebsite = rawWebsiteValues.find((value) => !noWebsiteValues.has(value.trim().toLowerCase()));
    const websiteAbsenceConfirmed = !positiveWebsite && rawWebsiteValues.some((value) => noWebsiteValues.has(value.trim().toLowerCase()));
    const phoneNumbers = [tags.phone, tags["contact:phone"], tags.mobile, tags["contact:mobile"], tags.telephone, tags["contact:telephone"]].filter((value): value is string => Boolean(value));
    const emailAddresses = [tags.email, tags["contact:email"]].filter((value): value is string => Boolean(value));
    const sourceDates = [element.timestamp, tags.check_date, tags["contact:check_date"], tags["opening_hours:check_date"], tags["survey:date"]]
      .filter((value): value is string => Boolean(value)).map((value) => ({ value, time: Date.parse(value) })).filter(({ time }) => Number.isFinite(time)).sort((a, b) => b.time - a.time);
    const activitySignals = ["opening_hours", "check_date", "contact:check_date", "opening_hours:check_date", "survey:date", "email", "contact:email", "facebook", "contact:facebook", "instagram", "contact:instagram"]
      .filter((key) => Boolean(tags[key]));
    return [{
      externalPlaceId: `osm:${element.type}/${element.id}`,
      source: "OPENSTREETMAP",
      companyName: tags.name,
      phoneNumber: phoneNumbers[0],
      internationalPhoneNumber: tags["contact:mobile"] || tags.mobile,
      phoneNumbers,
      email: emailAddresses[0],
      emailAddresses,
      website: positiveWebsite,
      websiteFields: [tags["contact:url"], tags["operator:website"], tags["brand:website"], tags.facebook, tags.instagram, tags["contact:facebook"], tags["contact:instagram"], tags["contact:linkedin"], tags["contact:tiktok"]],
      websiteAbsenceConfirmed,
      businessStatus: closureSignals.length || isPermanentlyClosed(tags) ? "CLOSED_PERMANENTLY" : "UNKNOWN",
      closureSignals,
      activitySignals,
      rawData: tags,
      sourceUpdatedAt: sourceDates[0]?.value,
      country: (tags["addr:country"] || country).toUpperCase(),
      category,
      subCategory: tags.brand,
      brand: tags.brand,
      brandWikidata: tags["brand:wikidata"],
      operator: tags.operator,
      province: tags["addr:province"] || tags["addr:state"],
      municipality: tags["addr:municipality"],
      city,
      postalCode: tags["addr:postcode"],
      streetAddress: street,
      houseNumber: tags["addr:housenumber"],
      latitude,
      longitude,
      googleMapsUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      fetchedAt: new Date().toISOString(),
    }];
  });
  return [...new Map(candidates.map((candidate) => [candidate.externalPlaceId, candidate])).values()];
}

function normalizedCategory(category = "") {
  return category.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function categoryFilters(category?: string) {
  const value = normalizedCategory(category);
  if (/restaurant|lunchroom|cafe|catering/.test(value)) return ['["amenity"~"^(restaurant|cafe|fast_food|food_court)$"]'];
  if (/hotel|bed and breakfast/.test(value)) return ['["tourism"~"^(hotel|guest_house|hostel|apartment)$"]'];
  if (/kapper|schoonheid|nagel|wellness/.test(value)) return ['["shop"~"^(hairdresser|beauty|massage|cosmetics)$"]'];
  if (/fysio|personal trainer|coach|opleiding|kinderopvang/.test(value)) return ['["healthcare"]', '["amenity"~"^(doctors|clinic|kindergarten|training)$"]'];
  if (/garage|autobedrijf|rijschool/.test(value)) return ['["shop"~"^(car|car_repair|tyres)$"]', '["amenity"="driving_school"]'];
  if (/makelaar|boekhouder|consultant/.test(value)) return ['["office"~"^(estate_agent|accountant|consulting|company)$"]'];
  if (/schilder/.test(value)) return ['["craft"="painter"]'];
  if (/stukadoor/.test(value)) return ['["craft"="plasterer"]'];
  if (/tegel/.test(value)) return ['["craft"="tiler"]'];
  if (/dakdekker/.test(value)) return ['["craft"="roofer"]'];
  if (/loodgieter|installatie/.test(value)) return ['["craft"~"^(plumber|hvac)$"]'];
  if (/elektricien/.test(value)) return ['["craft"="electrician"]'];
  if (/hovenier/.test(value)) return ['["craft"~"^(gardener|landscaper)$"]'];
  if (/fotograaf/.test(value)) return ['["craft"="photographer"]'];
  if (/aannemer|klus/.test(value)) return ['["craft"~"^(builder|carpenter|handicraft)$"]', '["office"="company"]'];
  if (/schoonmaak/.test(value)) return ['["craft"="cleaning"]', '["office"="company"]'];
  if (/verhuis/.test(value)) return ['["office"~"^(moving_company|company)$"]'];
  if (/interieur|keuken/.test(value)) return ['["craft"~"^(cabinet_maker|interior_decorator)$"]', '["shop"="kitchen"]'];
  if (/videograaf|drukkerij/.test(value)) return ['["craft"~"^(photographer|printer)$"]', '["office"="company"]'];
  if (/honden/.test(value)) return ['["shop"="pet_grooming"]', '["amenity"~"^(animal_boarding|animal_breeding)$"]'];
  if (/verhuur/.test(value)) return ['["shop"="rental"]', '["office"="company"]'];
  if (/speciaalzaak|groothandel/.test(value)) return ['["shop"]', '["office"="wholesale"]'];
  return ['["shop"]', '["craft"]', '["office"]', '["amenity"~"^(restaurant|cafe|clinic|doctors)$"]', '["tourism"~"^(hotel|guest_house)$"]', '["healthcare"]'];
}

export function overpassTile(latitude: number, longitude: number, radius: number, cursor = 0) {
  const index = Math.abs(cursor) % tileOffsets.length;
  const [row, column] = tileOffsets[index];
  const tileRadius = Math.min(3_000, Math.max(1_500, Math.round(radius / 5)));
  const north = (row * tileRadius * 1.85) / 111_320;
  const east = (column * tileRadius * 1.85) / (111_320 * Math.max(0.2, Math.cos(latitude * Math.PI / 180)));
  return { latitude: latitude + north, longitude: longitude + east, radius: tileRadius, id: `t${index}` };
}

export function buildOverpassQuery(params: { latitude: number; longitude: number; radius: number; category?: string; timeoutSeconds: number; strategy?: OverpassElementStrategy }) {
  const filters = categoryFilters(params.category);
  const strategy = params.strategy ?? "node";
  const contactFilter = '[~"^(phone|contact:phone|mobile|contact:mobile|telephone|contact:telephone)$"~"."]';
  const noOfficialWebsite = '[!"website"][!"contact:website"][!"url"][!"contact:url"][!"operator:website"][!"brand:website"]';
  const around = `${strategy}(around:${params.radius},${params.latitude.toFixed(7)},${params.longitude.toFixed(7)})`;
  const statements = filters
    .map((filter) => `${around}${filter}[name]${contactFilter}${noOfficialWebsite};`)
    .join("");
  const center = strategy === "node" ? "" : " center";
  return `[out:json][timeout:${params.timeoutSeconds}];(${statements});out meta${center} qt;`;
}

function errorType(error: unknown) {
  if (error instanceof SyntaxError) return "invalid_json";
  if (error instanceof Error && /html|content-type/i.test(error.message)) return "invalid_content_type";
  if (error instanceof Error && /abort|timeout/i.test(`${error.name} ${error.message}`)) return "timeout";
  return "network";
}

async function emitEvent(callback: SearchParams["onEvent"], event: OverpassEvent) {
  try {
    await callback?.(event);
  } catch (error) {
    console.warn(JSON.stringify({ step: "overpass_event_logging", errorType: "logging_failed", message: error instanceof Error ? error.message : String(error) }));
  }
}

async function fetchWithTimeout(fetchImpl: typeof fetch, endpoint: string, query: string, timeoutMs: number, parentSignal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(parentSignal?.reason ?? new Error("Zoekrun geannuleerd"));
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(`OpenStreetMap reageerde niet binnen ${Math.ceil(timeoutMs / 1000)} seconden`)), timeoutMs);
  try {
    return await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "SitoraLeadfinder/4.0 (public-business-discovery)" },
      body: new URLSearchParams({ data: query }),
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abort);
  }
}

async function readBoundedText(response: Response, maxBytes: number) {
  const announced = Number(response.headers.get("content-length") || 0);
  if (announced > maxBytes) throw new Error(`OpenStreetMap-response is groter dan ${maxBytes} bytes.`);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel("response_too_large");
        throw new Error(`OpenStreetMap-response is groter dan ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const combined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(combined);
}

export async function searchOverpass(params: SearchParams) {
  if (!Number.isFinite(params.latitude) || !Number.isFinite(params.longitude) || Math.abs(params.latitude) > 90 || Math.abs(params.longitude) > 180) {
    throw new Error("De locatie kon niet worden gevonden of bevat ongeldige coördinaten.");
  }
  const configuredEndpoints = [...new Set(params.endpoints.map((endpoint) => endpoint.trim()).filter(Boolean))];
  const endpoints = healthyEndpoints(configuredEndpoints, Date.now());
  if (!endpoints.length) throw new Error("Er zijn geen OpenStreetMap-servers geconfigureerd.");
  const timeoutMs = Math.min(15_000, Math.max(4_000, params.timeoutMs ?? 10_000));
  const totalTimeoutMs = Math.min(18_000, Math.max(8_000, params.totalTimeoutMs ?? 18_000));
  const maxResponseBytes = Math.min(4_000_000, Math.max(100_000, params.maxResponseBytes ?? 2_000_000));
  const retries = Math.min(2, Math.max(1, params.retriesPerEndpoint ?? 2));
  const plan = overpassSearchPlan(params.tileCursor);
  const tile = overpassTile(params.latitude, params.longitude, params.radius, plan.tileCursor);
  const queryType = `${normalizedCategory(params.category) || "alle_bruikbare_bedrijven"}:${plan.strategy}`;
  const query = buildOverpassQuery({ ...tile, category: params.category, strategy: plan.strategy, timeoutSeconds: Math.max(5, Math.floor(timeoutMs / 1000) - 1) });
  const fetchImpl = params.fetchImpl ?? fetch;
  const sleep = params.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const random = params.random ?? Math.random;
  const deadline = Date.now() + totalTimeoutMs;
  let lastError = new Error("OpenStreetMap is niet bereikbaar.");

  for (let endpointIndex = 0; endpointIndex < endpoints.length; endpointIndex += 1) {
    const endpoint = endpoints[endpointIndex];
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      if (params.signal?.aborted) throw new Error("De zoekrun is geannuleerd.");
      const remaining = deadline - Date.now();
      if (remaining < 500) throw new Error(`Alle OpenStreetMap-servers bereikten de totale timeout van ${Math.ceil(totalTimeoutMs / 1000)} seconden.`);
      // Reserve an equal slice for every remaining fallback. Previously the first
      // three servers consumed all 28 seconds, so the final healthy fallback was
      // never attempted in production.
      const endpointsRemaining = endpoints.length - endpointIndex;
      const fairTimeoutMs = Math.max(1_000, Math.floor(remaining / endpointsRemaining));
      const started = Date.now();
      try {
        const response = await withEndpointLock(endpoint, () => fetchWithTimeout(fetchImpl, endpoint, query, Math.min(timeoutMs, fairTimeoutMs), params.signal));
        const raw = await readBoundedText(response, maxResponseBytes);
        if (!response.ok) {
          lastError = new Error(`OpenStreetMap-server antwoordde met HTTP ${response.status}.`);
          recordEndpointFailure(endpoint, Date.now());
          await emitEvent(params.onEvent, { endpoint, queryType, tile: plan.id, attempt, durationMs: Date.now() - started, statusCode: response.status, errorType: `http_${response.status}`, message: lastError.message });
          if (!isRetryableStatus(response.status)) break;
        } else {
          const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
          if (!contentType.includes("json") || /^\s*</.test(raw)) throw new Error("OpenStreetMap gaf HTML of een ongeldig content-type terug.");
          const data = JSON.parse(raw) as { elements?: OsmElement[] };
          if (!Array.isArray(data.elements)) throw new SyntaxError("OpenStreetMap-response bevat geen geldige elementenlijst.");
          const candidates = candidatesFrom(data.elements, params.country);
          recordEndpointSuccess(endpoint);
          await emitEvent(params.onEvent, { endpoint, queryType, tile: plan.id, attempt, durationMs: Date.now() - started, statusCode: response.status, resultCount: candidates.length, message: `${candidates.length} openbare bedrijfsvermeldingen ontvangen.` });
          return { candidates, endpoint, query, tile: { ...tile, id: plan.id }, queryType };
        }
      } catch (error) {
        lastError = error instanceof Error ? error : lastError;
        recordEndpointFailure(endpoint, Date.now());
        const failureType = errorType(error);
        await emitEvent(params.onEvent, { endpoint, queryType, tile: plan.id, attempt, durationMs: Date.now() - started, errorType: failureType, message: lastError.message });
        // A timeout consumed this host's fair share; retrying it would starve the
        // independent fallback. Fast HTTP failures can still use normal retries.
        if (failureType === "timeout") break;
      }
      if (attempt < retries && deadline - Date.now() > 500) await sleep(Math.min(backoffDelayMs(attempt - 1, random() * 250), Math.max(0, deadline - Date.now() - 250)));
    }
  }
  throw new Error(`Alle OpenStreetMap-servers zijn mislukt. Laatste fout: ${lastError.message}`);
}
