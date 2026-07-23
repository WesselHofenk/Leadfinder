import type { Lead } from "@/types/lead";
import {
  businessKey,
  normalizeText,
  providerId,
  qualifyOsmElement,
  type LeadRegion,
  type OsmElement,
  type RejectionReason,
} from "@/lib/leads/qualification";

export const LEAD_REGIONS: LeadRegion[] = [
  { name: "Amsterdam", province: "Noord-Holland", bbox: "52.29,4.72,52.43,5.02" },
  { name: "Rotterdam", province: "Zuid-Holland", bbox: "51.82,4.31,52.02,4.65" },
  { name: "Den Haag", province: "Zuid-Holland", bbox: "52.00,4.17,52.15,4.45" },
  { name: "Utrecht", province: "Utrecht", bbox: "52.02,5.00,52.18,5.28" },
  { name: "Eindhoven", province: "Noord-Brabant", bbox: "51.37,5.34,51.53,5.61" },
  { name: "Tilburg", province: "Noord-Brabant", bbox: "51.50,4.92,51.65,5.20" },
  { name: "Breda", province: "Noord-Brabant", bbox: "51.50,4.60,51.69,4.88" },
  { name: "Arnhem", province: "Gelderland", bbox: "51.90,5.75,52.08,6.05" },
  { name: "Nijmegen", province: "Gelderland", bbox: "51.76,5.70,51.91,5.98" },
  { name: "Groningen", province: "Groningen", bbox: "53.14,6.45,53.29,6.75" },
  { name: "Zwolle", province: "Overijssel", bbox: "52.43,6.00,52.58,6.23" },
  { name: "Enschede", province: "Overijssel", bbox: "52.15,6.75,52.30,7.00" },
  { name: "Apeldoorn", province: "Gelderland", bbox: "52.12,5.83,52.30,6.13" },
  { name: "Haarlem", province: "Noord-Holland", bbox: "52.32,4.52,52.45,4.75" },
  { name: "Alkmaar", province: "Noord-Holland", bbox: "52.56,4.62,52.72,4.88" },
  { name: "Leiden", province: "Zuid-Holland", bbox: "52.09,4.38,52.22,4.62" },
  { name: "Dordrecht", province: "Zuid-Holland", bbox: "51.73,4.55,51.89,4.85" },
  { name: "Amersfoort", province: "Utrecht", bbox: "52.08,5.28,52.23,5.52" },
  { name: "Leeuwarden", province: "Friesland", bbox: "53.14,5.68,53.25,5.92" },
  { name: "Assen", province: "Drenthe", bbox: "52.94,6.45,53.07,6.68" },
  { name: "Almere", province: "Flevoland", bbox: "52.28,5.08,52.45,5.36" },
  { name: "Maastricht", province: "Limburg", bbox: "50.78,5.58,50.92,5.82" },
  { name: "Venlo", province: "Limburg", bbox: "51.30,6.05,51.45,6.27" },
  { name: "Middelburg", province: "Zeeland", bbox: "51.44,3.50,51.58,3.76" },
];

const ENDPOINTS = [
  { url: "https://overpass-api.de/api/interpreter", timeoutMs: 30_000 },
  { url: "https://maps.mail.ru/osm/tools/overpass/api/interpreter", timeoutMs: 60_000 },
  { url: "https://lz4.overpass-api.de/api/interpreter", timeoutMs: 30_000 },
];
const BUSINESS_KEY_PATTERN = "^(shop|craft|office|amenity|tourism|healthcare|leisure)$";

export interface SeenLeadKeys {
  providerIds: string[];
  phoneKeys: string[];
  businessKeys: string[];
}

export interface LeadGenerationResult {
  leads: Lead[];
  examinedProviderIds: string[];
  acceptedPhoneKeys: string[];
  acceptedBusinessKeys: string[];
  nextRegionCursor: number;
  regionsQueried: number;
  rejected: Partial<Record<RejectionReason | "ALREADY_SEEN" | "DUPLICATE_IN_RUN", number>>;
}

function buildQuery(region: LeadRegion) {
  const selectors = [
    `node["name"]["phone"][~"${BUSINESS_KEY_PATTERN}"~"."](${region.bbox});`,
    `node["name"]["contact:phone"][~"${BUSINESS_KEY_PATTERN}"~"."](${region.bbox});`,
  ].join("\n");
  return `[out:json][timeout:18];\n(\n${selectors}\n);\nout 350;`;
}

async function fetchRegion(region: LeadRegion): Promise<OsmElement[]> {
  const query = buildQuery(region);
  let lastError: unknown;
  for (const endpoint of ENDPOINTS) {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), endpoint.timeoutMs);
    try {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams({ data: query }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`OpenStreetMap-bron reageerde met ${response.status}`);
      const data = await response.json() as { elements?: OsmElement[] };
      return data.elements || [];
    } catch (error) {
      lastError = error;
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("De openbare bedrijfsbron is tijdelijk niet bereikbaar.");
}

function increment(result: LeadGenerationResult, reason: keyof LeadGenerationResult["rejected"]) {
  result.rejected[reason] = (result.rejected[reason] || 0) + 1;
}

export async function generateNewOsmLeads({
  targetCount = 20,
  regionCursor = 0,
  seen,
  maxRegions = 4,
}: {
  targetCount?: number;
  regionCursor?: number;
  seen: SeenLeadKeys;
  maxRegions?: number;
}): Promise<LeadGenerationResult> {
  const result: LeadGenerationResult = {
    leads: [], examinedProviderIds: [], acceptedPhoneKeys: [], acceptedBusinessKeys: [],
    nextRegionCursor: regionCursor, regionsQueried: 0, rejected: {},
  };
  const seenIds = new Set(seen.providerIds);
  const seenPhones = new Set(seen.phoneKeys);
  const seenBusinesses = new Set(seen.businessKeys);
  const runIds = new Set<string>();
  const runPhones = new Set<string>();
  const runBusinesses = new Set<string>();

  for (let offset = 0; offset < Math.min(maxRegions, LEAD_REGIONS.length) && result.leads.length < targetCount; offset++) {
    const regionIndex = (regionCursor + offset) % LEAD_REGIONS.length;
    const region = LEAD_REGIONS[regionIndex];
    const elements = await fetchRegion(region);
    result.regionsQueried += 1;
    result.nextRegionCursor = (regionIndex + 1) % LEAD_REGIONS.length;
    const nameCounts = elements.reduce<Record<string, number>>((counts, element) => {
      const name = normalizeText(element.tags?.name);
      if (name) counts[name] = (counts[name] || 0) + 1;
      return counts;
    }, {});

    for (const element of elements) {
      const id = providerId(element);
      if (runIds.has(id)) continue;
      runIds.add(id);
      result.examinedProviderIds.push(id);
      if (seenIds.has(id)) {
        increment(result, "ALREADY_SEEN");
        continue;
      }
      const tags = element.tags || {};
      const qualified = qualifyOsmElement(element, region, nameCounts[normalizeText(tags.name)] || 1);
      if (!qualified.accepted) {
        increment(result, qualified.reason);
        continue;
      }
      const candidateBusinessKey = businessKey(tags, region);
      if (
        seenPhones.has(qualified.phoneKey) || seenBusinesses.has(candidateBusinessKey)
        || runPhones.has(qualified.phoneKey) || runBusinesses.has(candidateBusinessKey)
      ) {
        increment(result, "DUPLICATE_IN_RUN");
        continue;
      }
      result.leads.push(qualified.lead);
      result.acceptedPhoneKeys.push(qualified.phoneKey);
      result.acceptedBusinessKeys.push(qualified.businessKey);
      runPhones.add(qualified.phoneKey);
      runBusinesses.add(qualified.businessKey);
      if (result.leads.length >= targetCount) break;
    }
  }
  return result;
}
