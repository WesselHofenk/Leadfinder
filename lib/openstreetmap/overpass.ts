import "server-only";
import type { Candidate } from "@/lib/leads/eligibility";
import { backoffDelayMs } from "@/lib/jobs/backoff";

type OsmElement = { type: "node" | "way" | "relation"; id: number; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> };
const businessKeys = "shop|craft|office|amenity|tourism|healthcare";

export async function searchOverpass(params: { endpoint: string; country: string; latitude: number; longitude: number; radius: number }) {
  const radius = Math.min(Math.max(params.radius, 500), 12_000);
  const query = `[out:json][timeout:25];nwr(around:${radius},${params.latitude},${params.longitude})[~"^(${businessKeys})$"~"."][name];out center tags;`;
  let lastError = new Error("Overpass is niet bereikbaar");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(params.endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "SitoraLeadfinder/1.0" }, body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(30_000), cache: "no-store" });
      if (response.ok) {
        const data = await response.json() as { elements?: OsmElement[] };
        return (data.elements ?? []).flatMap((element): Candidate[] => {
          const tags = element.tags ?? {};
          if (tags.disused || tags.abandoned || tags["disused:shop"] || tags["abandoned:shop"]) return [];
          const latitude = element.lat ?? element.center?.lat; const longitude = element.lon ?? element.center?.lon;
          if (!tags.name || latitude == null || longitude == null) return [];
          const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
          const city = tags["addr:city"] || tags["addr:place"] || tags["addr:municipality"] || "Onbekend";
          const category = tags.shop || tags.craft || tags.office || tags.amenity || tags.tourism || tags.healthcare || "bedrijf";
          return [{ externalPlaceId: `${element.type}/${element.id}`, source: "OPENSTREETMAP", companyName: tags.name, phoneNumber: tags.phone || tags["contact:phone"], internationalPhoneNumber: tags["contact:mobile"], website: tags.website, websiteFields: [tags["contact:website"], tags.url, tags.sourceWebsite], businessStatus: "OPERATIONAL", country: (tags["addr:country"] || params.country).toUpperCase(), category, subCategory: tags.brand, province: tags["addr:province"] || tags["addr:state"], municipality: tags["addr:municipality"], city, postalCode: tags["addr:postcode"], streetAddress: street || [tags["addr:postcode"], city].filter(Boolean).join(" "), houseNumber: tags["addr:housenumber"], latitude, longitude, googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}` }];
        });
      }
      lastError = new Error(`Overpass weigerde de aanvraag (${response.status})`);
      if (![429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) { lastError = error instanceof Error ? error : lastError; }
    await new Promise((resolve) => setTimeout(resolve, backoffDelayMs(attempt, Math.random() * 250)));
  }
  throw lastError;
}
