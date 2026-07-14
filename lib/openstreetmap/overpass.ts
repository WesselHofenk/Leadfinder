import "server-only";
import type { Candidate } from "@/lib/leads/eligibility";
import { backoffDelayMs } from "@/lib/jobs/backoff";

type OsmElement = {
  type: "node" | "way" | "relation"; id: number; lat?: number; lon?: number;
  center?: { lat?: number; lon?: number }; tags?: Record<string, string>; timestamp?: string;
};

const businessKeys = "shop|craft|office|amenity|tourism|healthcare";
const permanentSignals = ["disused", "abandoned", "demolished", "removed", "razed", "was"];

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
  return elements.flatMap((element): Candidate[] => {
    const tags = element.tags ?? {};
    const latitude = element.lat ?? element.center?.lat;
    const longitude = element.lon ?? element.center?.lon;
    if (!tags.name || latitude == null || longitude == null) return [];
    const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
    const city = tags["addr:city"] || tags["addr:place"] || tags["addr:municipality"] || "Onbekend";
    const category = tags.shop || tags.craft || tags.office || tags.amenity || tags.tourism || tags.healthcare || "bedrijf";
    const closureSignals = closedSignals(tags);
    return [{
      externalPlaceId: `osm:${element.type}/${element.id}`, source: "OPENSTREETMAP", companyName: tags.name,
      phoneNumber: tags.phone || tags["contact:phone"], internationalPhoneNumber: tags["contact:mobile"],
      email: tags.email || tags["contact:email"], website: tags.website || tags["contact:website"],
      websiteFields: [tags.url, tags["contact:facebook"], tags["contact:instagram"]],
      businessStatus: closureSignals.length ? "CLOSED_PERMANENTLY" : "UNKNOWN", closureSignals,
      sourceUpdatedAt: element.timestamp, country: (tags["addr:country"] || country).toUpperCase(), category,
      subCategory: tags.brand, province: tags["addr:province"] || tags["addr:state"], municipality: tags["addr:municipality"],
      city, postalCode: tags["addr:postcode"], streetAddress: street, houseNumber: tags["addr:housenumber"],
      latitude, longitude, googleMapsUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    }];
  });
}

export async function searchOverpass(params: { endpoints: string[]; country: string; latitude: number; longitude: number; radius: number; timeoutMs?: number }) {
  const radius = Math.min(Math.max(params.radius, 500), 15_000);
  const timeoutMs = Math.min(60_000, Math.max(5_000, params.timeoutMs ?? 30_000));
  const query = `[out:json][timeout:${Math.max(5, Math.floor(timeoutMs / 1000) - 3)}];nwr(around:${radius},${params.latitude},${params.longitude})[~"^(${businessKeys})$"~"."][name][~"^(phone|contact:phone|contact:mobile)$"~"."];out center tags qt;`;
  let lastError = new Error("Overpass is niet bereikbaar");
  for (const endpoint of [...new Set(params.endpoints)]) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(endpoint, {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "SitoraLeadfinder/2.0 (public-business-discovery)" },
          body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(timeoutMs), cache: "no-store",
        });
        if (response.ok) {
          const data = await response.json() as { elements?: OsmElement[] };
          return { candidates: candidatesFrom(data.elements ?? [], params.country), endpoint };
        }
        lastError = new Error(`Overpass weigerde de aanvraag (${response.status})`);
        if (![429, 500, 502, 503, 504].includes(response.status)) break;
      } catch (error) { lastError = error instanceof Error ? error : lastError; }
      await new Promise((resolve) => setTimeout(resolve, backoffDelayMs(attempt, Math.random() * 250)));
    }
  }
  throw lastError;
}
