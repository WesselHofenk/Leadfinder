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
  city?: string;
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
  queryOverride?: string;
  queryTypeOverride?: string;
  tileLabelOverride?: string;
};

export type OverpassElementStrategy = "node" | "way" | "relation";
export type OverpassContactStrategy =
  | "phone" | "contact:phone" | "mobile" | "contact:mobile" | "telephone" | "contact:telephone"
  | "email" | "contact:email" | "any";

const permanentSignals = ["disused", "abandoned", "demolished", "removed", "razed", "was"];
const tileOffsets = Array.from({ length: 5 }, (_, row) => Array.from({ length: 5 }, (_, column) => [row - 2, column - 2] as const))
  .flat().sort(([rowA, columnA], [rowB, columnB]) => (rowA ** 2 + columnA ** 2) - (rowB ** 2 + columnB ** 2) || rowA - rowB || columnA - columnB);
export const OSM_TILE_COUNT = tileOffsets.length;
const elementStrategies: readonly OverpassElementStrategy[] = ["node", "way", "relation"];
const contactStrategies: readonly OverpassContactStrategy[] = [
  "phone", "contact:phone", "email", "contact:email", "mobile", "contact:mobile", "telephone", "contact:telephone", "any",
];
export const OSM_SEARCH_CURSOR_COUNT = OSM_TILE_COUNT * elementStrategies.length * contactStrategies.length;

export function initialOverpassSearchCursor(_country: string, _city: string, _category: string) {
  // Most named local businesses in OSM are mapped as nodes. New combinations
  // start with the broad contact-complete strategy so differences between
  // `phone` and `contact:phone` (or `email` and `contact:email`) cannot hide an
  // otherwise qualified candidate. Persisted cursors continue through the
  // exact tag, way and relation strategies afterwards.
  return contactStrategies.indexOf("any") * elementStrategies.length;
}

export function overpassSearchPlan(cursor = 0) {
  const normalized = ((cursor % OSM_SEARCH_CURSOR_COUNT) + OSM_SEARCH_CURSOR_COUNT) % OSM_SEARCH_CURSOR_COUNT;
  const strategyIndex = normalized % elementStrategies.length;
  const contactIndex = Math.floor(normalized / elementStrategies.length) % contactStrategies.length;
  const tileCursor = Math.floor(normalized / (elementStrategies.length * contactStrategies.length));
  const strategy = elementStrategies[strategyIndex];
  const contact = contactStrategies[contactIndex];
  return { cursor: normalized, tileCursor, strategy, contact, id: `t${tileCursor}-${strategy}-${contact.replace(":", "-")}` };
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

function explicitGoogleProfile(tags: Record<string, string>) {
  const placeId = tags["google:place_id"] || tags.google_place_id || tags["contact:google:place_id"];
  const urls = [tags["google:maps"], tags.google_maps, tags["contact:google"], tags["contact:google_maps"], tags["google:business"]]
    .filter((value): value is string => Boolean(value?.trim()));
  const profileUrl = urls.find((value) => /^https:\/\/(?:(?:www\.)?(?:google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)|maps\.app\.goo\.gl)(?:\/|\?|$)/i.test(value));
  return { placeId, profileUrl, verified: Boolean(placeId || profileUrl) };
}

function candidatesFrom(elements: OsmElement[], country: string, searchCity?: string): Candidate[] {
  const candidates = elements.flatMap((element): Candidate[] => {
    const tags = element.tags ?? {};
    const latitude = element.lat ?? element.center?.lat;
    const longitude = element.lon ?? element.center?.lon;
    if (!tags.name || latitude == null || longitude == null) return [];
    const city = tags["addr:city"] || tags["addr:place"] || tags["addr:municipality"] || tags["addr:suburb"] || searchCity || "Onbekend";
    const street = tags["addr:full"]
      || [tags["addr:street"] || tags["contact:street"], tags["addr:housenumber"]].filter(Boolean).join(" ")
      || `${city} (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`;
    const category = tags.shop || tags.craft || tags.office || tags.amenity || tags.tourism || tags.healthcare || "bedrijf";
    const formattedAddress = [
      tags["addr:full"] || [tags["addr:street"] || tags["contact:street"], tags["addr:housenumber"]].filter(Boolean).join(" "),
      [tags["addr:postcode"], city].filter(Boolean).join(" "),
      (tags["addr:country"] || country).toUpperCase(),
    ].filter(Boolean).join(", ");
    const closureSignals = closedSignals(tags);
    const googleProfile = explicitGoogleProfile(tags);
    const rawWebsiteValues = [tags.website, tags["contact:website"], tags.url, tags["contact:url"], tags["operator:website"], tags["brand:website"]].filter((value): value is string => Boolean(value));
    const noWebsiteValues = new Set(["no", "none", "nee", "geen", "n.v.t.", "nvt"]);
    const positiveWebsite = rawWebsiteValues.find((value) => !noWebsiteValues.has(value.trim().toLowerCase()));
    const websiteAbsenceConfirmed = !positiveWebsite && rawWebsiteValues.some((value) => noWebsiteValues.has(value.trim().toLowerCase()));
    const phoneNumbers = [tags.phone, tags["contact:phone"], tags.mobile, tags["contact:mobile"], tags.telephone, tags["contact:telephone"]].filter((value): value is string => Boolean(value));
    const emailAddresses = [tags.email, tags["contact:email"]].filter((value): value is string => Boolean(value));
    const sourceDates = [element.timestamp, tags.check_date, tags["contact:check_date"], tags["opening_hours:check_date"], tags["survey:date"]]
      .filter((value): value is string => Boolean(value)).map((value) => ({ value, time: Date.parse(value) })).filter(({ time }) => Number.isFinite(time)).sort((a, b) => b.time - a.time);
    const activitySignals = ["opening_hours", "check_date", "contact:check_date", "opening_hours:check_date", "survey:date", "phone", "contact:phone", "mobile", "contact:mobile", "email", "contact:email", "facebook", "contact:facebook", "instagram", "contact:instagram"]
      .filter((key) => Boolean(tags[key]));
    const socialUrls = [tags.facebook, tags.instagram, tags["contact:facebook"], tags["contact:instagram"], tags["contact:linkedin"], tags["contact:tiktok"]]
      .filter((value): value is string => Boolean(value));
    const explicitStatus = [tags.business_status, tags.status, tags["contact:status"]].map((value) => value?.toLowerCase()).find(Boolean);
    return [{
      externalPlaceId: `osm:${element.type}/${element.id}`,
      source: "OPENSTREETMAP",
      companyName: tags.name,
      phoneNumber: phoneNumbers[0],
      internationalPhoneNumber: tags["contact:mobile"] || tags.mobile,
      phoneNumbers,
      email: emailAddresses[0],
      emailAddresses,
      emailSource: "OPENSTREETMAP",
      emailSourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      emailPubliclyListed: emailAddresses.length > 0,
      website: positiveWebsite,
      websiteFields: [tags["contact:url"], tags["operator:website"], tags["brand:website"], tags.facebook, tags.instagram, tags["contact:facebook"], tags["contact:instagram"], tags["contact:linkedin"], tags["contact:tiktok"]],
      websiteAbsenceConfirmed,
      sourceWebsiteFieldsChecked: true,
      businessStatus: closureSignals.length || isPermanentlyClosed(tags)
        ? "CLOSED_PERMANENTLY"
        : explicitStatus && /^(operational|open|active|actief|geopend)$/.test(explicitStatus) ? "OPERATIONAL" : "UNKNOWN",
      closureSignals,
      activitySignals,
      rawData: tags,
      description: tags["description:nl"] || tags.description,
      contactText: [tags.note, tags.operator, tags["contact:phone"], tags["contact:email"]].filter(Boolean).join(" "),
      language: tags["name:nl"] || tags["description:nl"] ? "nl" : tags["name:fr"] || tags["description:fr"] ? "fr" : undefined,
      languageConfidence: tags["name:nl"] || tags["description:nl"] || tags["name:fr"] || tags["description:fr"] ? 95 : undefined,
      googlePlaceId: googleProfile.placeId,
      googleBusinessProfileUrl: googleProfile.profileUrl,
      googleBusinessProfileVerified: googleProfile.verified,
      socialUrls,
      sourceUpdatedAt: sourceDates[0]?.value,
      country: (tags["addr:country"] || country).toUpperCase(),
      category,
      subCategory: tags.brand,
      brand: tags.brand,
      brandWikidata: tags["brand:wikidata"],
      operator: tags.operator,
      province: tags["addr:province"] || tags["addr:state"],
      municipality: tags["addr:municipality"],
      locality: tags["addr:locality"],
      town: tags["addr:town"],
      village: tags["addr:village"],
      suburb: tags["addr:suburb"],
      district: tags["addr:district"],
      county: tags["addr:county"],
      region: tags["addr:region"] || tags["is_in:region"],
      city,
      postalCode: tags["addr:postcode"],
      streetAddress: street,
      formattedAddress: formattedAddress || undefined,
      houseNumber: tags["addr:housenumber"],
      latitude,
      longitude,
      googleMapsUrl: googleProfile.profileUrl || `https://www.openstreetmap.org/${element.type}/${element.id}`,
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
  if (/kapper|barbier|coiffeur|schoonheid|estheticienne|nagel|wellness/.test(value)) return ['["shop"~"^(hairdresser|beauty|massage|cosmetics)$"]'];
  if (/fysio|personal trainer|coach|opleiding|kinderopvang/.test(value)) return ['["healthcare"]', '["amenity"~"^(doctors|clinic|kindergarten|training)$"]'];
  if (/garage|autobedrijf|rijschool/.test(value)) return ['["shop"~"^(car|car_repair|tyres)$"]', '["amenity"="driving_school"]'];
  if (/makelaar|boekhouder|accountant|comptable|consultant/.test(value)) return ['["office"~"^(estate_agent|accountant|consulting|company)$"]'];
  if (/schilder|peintre/.test(value)) return ['["craft"="painter"]'];
  if (/stukadoor|platrier/.test(value)) return ['["craft"="plasterer"]'];
  if (/tegel/.test(value)) return ['["craft"="tiler"]'];
  if (/dakdekker|couvreur|toiture/.test(value)) return ['["craft"="roofer"]'];
  if (/loodgieter|plombier|installatie/.test(value)) return ['["craft"~"^(plumber|hvac)$"]'];
  if (/elektricien|electricien/.test(value)) return ['["craft"="electrician"]'];
  if (/hovenier|jardinier/.test(value)) return ['["craft"~"^(gardener|landscaper)$"]'];
  if (/fotograaf|photographe/.test(value)) return ['["craft"="photographer"]'];
  if (/aannemer|klus/.test(value)) return ['["craft"~"^(builder|carpenter|handicraft)$"]', '["office"="company"]'];
  if (/schoonmaak|nettoyage/.test(value)) return ['["craft"="cleaning"]', '["office"="company"]'];
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

export function buildOverpassQuery(params: { latitude: number; longitude: number; radius: number; category?: string; timeoutSeconds: number; strategy?: OverpassElementStrategy; contact?: OverpassContactStrategy }) {
  const filters = categoryFilters(params.category);
  const strategy = params.strategy ?? "node";
  const contact = params.contact ?? "phone";
  const noOfficialWebsite = '[!"website"][!"contact:website"][!"url"][!"contact:url"][!"operator:website"][!"brand:website"]';
  const around = `${strategy}(around:${params.radius},${params.latitude.toFixed(7)},${params.longitude.toFixed(7)})`;
  const anyPhone = '[~"^(phone|contact:phone|mobile|contact:mobile|telephone|contact:telephone)$"~"."]';
  const anyEmail = '[~"^(email|contact:email)$"~"."]';
  // A lead is only useful after both public contact channels are confirmed.
  // Requiring both at discovery time prevents phone-only candidates from
  // consuming the validation budget and then endlessly cycling through the
  // e-mail enrichment queue. Exact strategies stay in place for stable cursor
  // compatibility; the complementary contact channel is added as a constraint.
  const contactConstraint = contact === "any"
    ? `${anyPhone}${anyEmail}`
    : contact === "email" || contact === "contact:email"
      ? `["${contact}"]${anyPhone}`
      : `["${contact}"]${anyEmail}`;
  const statements = filters
    .map((filter) => `${around}${filter}[name]${contactConstraint}${noOfficialWebsite};`)
    .join("");
  const center = strategy === "node" ? "" : " center";
  return `[out:json][timeout:${params.timeoutSeconds}];(${statements});out meta${center} qt;`;
}

function qlLiteral(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ").trim();
}

export function buildOverpassIdentityQuery(candidate: Candidate, timeoutSeconds = 7) {
  const raw = candidate.rawData && typeof candidate.rawData === "object" ? candidate.rawData as Record<string, unknown> : {};
  const contactKeys: OverpassContactStrategy[] = ["phone", "contact:phone", "mobile", "contact:mobile", "telephone", "contact:telephone"];
  const statements = new Set<string>();
  // Exact indexed tag lookups inside both allowed countries are materially
  // cheaper and more complete than the former 250 km around-query.
  const areas = 'area["ISO3166-1"~"^(NL|BE)$"][admin_level="2"]->.allowedCountries;';
  const insideAllowedCountries = "nwr(area.allowedCountries)";
  statements.add(`${insideAllowedCountries}["name"="${qlLiteral(candidate.companyName)}"];`);
  for (const key of contactKeys) {
    const rawValue = typeof raw[key] === "string" ? raw[key].trim() : "";
    if (rawValue) statements.add(`${insideAllowedCountries}["${key}"="${qlLiteral(rawValue)}"];`);
  }
  return `[out:json][timeout:${Math.min(8, Math.max(4, timeoutSeconds))}];${areas}(${[...statements].join("")});out meta center qt;`;
}

function errorType(error: unknown) {
  if (error instanceof Error && /hedged_request_cancelled|zoekrun geannuleerd/i.test(error.message)) return "cancelled";
  if (error instanceof SyntaxError) return "invalid_json";
  if (error instanceof Error && /html|content-type/i.test(error.message)) return "invalid_content_type";
  if (error instanceof Error && /abort|timeout|reageerde niet binnen/i.test(`${error.name} ${error.message}`)) return "timeout";
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
  const timeoutMs = Math.min(15_000, Math.max(2_500, params.timeoutMs ?? 10_000));
  const totalTimeoutMs = Math.min(18_000, Math.max(4_000, params.totalTimeoutMs ?? 18_000));
  const maxResponseBytes = Math.min(4_000_000, Math.max(100_000, params.maxResponseBytes ?? 2_000_000));
  const retries = Math.min(2, Math.max(1, params.retriesPerEndpoint ?? 2));
  const plan = overpassSearchPlan(params.tileCursor);
  const tile = overpassTile(params.latitude, params.longitude, params.radius, plan.tileCursor);
  const queryType = params.queryTypeOverride ?? `${normalizedCategory(params.category) || "alle_bruikbare_bedrijven"}:${plan.strategy}:${plan.contact}`;
  const query = params.queryOverride ?? buildOverpassQuery({ ...tile, category: params.category, strategy: plan.strategy, contact: plan.contact, timeoutSeconds: Math.max(5, Math.floor(timeoutMs / 1000) - 1) });
  const tileLabel = params.tileLabelOverride ?? plan.id;
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
          await emitEvent(params.onEvent, { endpoint, queryType, tile: tileLabel, attempt, durationMs: Date.now() - started, statusCode: response.status, errorType: `http_${response.status}`, message: lastError.message });
          if (!isRetryableStatus(response.status)) break;
        } else {
          const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
          if (!contentType.includes("json") || /^\s*</.test(raw)) throw new Error("OpenStreetMap gaf HTML of een ongeldig content-type terug.");
          const data = JSON.parse(raw) as { elements?: OsmElement[] };
          if (!Array.isArray(data.elements)) throw new SyntaxError("OpenStreetMap-response bevat geen geldige elementenlijst.");
          const candidates = candidatesFrom(data.elements, params.country, params.city);
          recordEndpointSuccess(endpoint);
          await emitEvent(params.onEvent, { endpoint, queryType, tile: tileLabel, attempt, durationMs: Date.now() - started, statusCode: response.status, resultCount: candidates.length, message: `${candidates.length} openbare bedrijfsvermeldingen ontvangen.` });
          return { candidates, endpoint, query, tile: { ...tile, id: tileLabel }, queryType };
        }
      } catch (error) {
        lastError = error instanceof Error ? error : lastError;
        const failureType = errorType(error);
        if (failureType !== "cancelled") recordEndpointFailure(endpoint, Date.now());
        await emitEvent(params.onEvent, { endpoint, queryType, tile: tileLabel, attempt, durationMs: Date.now() - started, errorType: failureType, message: lastError.message });
        if (failureType === "cancelled") throw lastError;
        // A timeout consumed this host's fair share; retrying it would starve the
        // independent fallback. Fast HTTP failures can still use normal retries.
        if (failureType === "timeout") break;
      }
      if (attempt < retries && deadline - Date.now() > 500) await sleep(Math.min(backoffDelayMs(attempt - 1, random() * 250), Math.max(0, deadline - Date.now() - 250)));
    }
  }
  throw new Error(`Alle OpenStreetMap-servers zijn mislukt. Laatste fout: ${lastError.message}`);
}

export async function searchOverpassHedged(params: SearchParams & { hedgeDelayMs?: number }) {
  const endpoints = [...new Set(params.endpoints.map((endpoint) => endpoint.trim()).filter(Boolean))];
  if (!endpoints.length) throw new Error("Er zijn geen OpenStreetMap-servers geconfigureerd.");
  if (endpoints.length === 1) return searchOverpass({ ...params, endpoints });

  const hedgeDelayMs = Math.min(3_000, Math.max(250, params.hedgeDelayMs ?? 1_250));
  const controllers = endpoints.map(() => new AbortController());
  const parentAbort = () => controllers.forEach((controller) => controller.abort(params.signal?.reason ?? new Error("De zoekrun is geannuleerd.")));
  params.signal?.addEventListener("abort", parentAbort, { once: true });
  let winner = false;

  const attempts = endpoints.map(async (endpoint, index) => {
    if (index) await (params.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))))(index * hedgeDelayMs);
    if (winner) throw new Error("hedged_request_cancelled");
    return searchOverpass({ ...params, endpoints: [endpoint], signal: controllers[index].signal });
  });

  try {
    const result = await Promise.any(attempts);
    winner = true;
    controllers.forEach((controller) => controller.abort(new Error("hedged_request_cancelled")));
    return result;
  } catch (error) {
    const messages = error instanceof AggregateError
      ? error.errors.map((item) => item instanceof Error ? item.message : String(item))
      : [error instanceof Error ? error.message : String(error)];
    throw new Error(`Alle onafhankelijke OpenStreetMap-fallbacks zijn mislukt. ${messages.join(" | ")}`);
  } finally {
    params.signal?.removeEventListener("abort", parentAbort);
  }
}
