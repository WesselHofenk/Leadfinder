import type { Lead } from "@/types/lead";

export type OsmElementType = "node" | "way" | "relation";

export interface OsmElement {
  type: OsmElementType;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface LeadRegion {
  name: string;
  province: string;
  bbox: string;
}

export type RejectionReason =
  | "NO_NAME"
  | "NO_BUSINESS_CATEGORY"
  | "HAS_WEBSITE"
  | "NO_VALID_PHONE"
  | "CLOSED_OR_INACTIVE"
  | "FRANCHISE_OR_LARGE_CHAIN"
  | "NO_COORDINATES";

const WEBSITE_KEYS = ["website", "contact:website", "url", "contact:url", "website:1"];
const PHONE_KEYS = ["phone", "contact:phone", "mobile", "contact:mobile"];
const BUSINESS_KEYS = ["shop", "craft", "office", "amenity", "tourism", "healthcare", "leisure"];
const CLOSED_LIFECYCLE_KEYS = ["disused", "abandoned", "demolished", "razed", "removed", "destroyed", "vacant"];
const CLOSED_VALUES = new Set(["vacant", "closed", "disused", "abandoned", "demolished", "no"]);

const ALLOWED_AMENITIES = new Set([
  "animal_boarding", "animal_breeding", "bar", "biergarten", "bureau_de_change", "cafe",
  "car_rental", "car_repair", "childcare", "clinic", "college", "dentist", "doctors",
  "driving_school", "fast_food", "language_school", "marketplace", "music_school", "pharmacy",
  "photo_booth", "pub", "restaurant", "social_facility", "studio", "veterinary",
]);
const ALLOWED_TOURISM = new Set(["apartment", "camp_site", "chalet", "guest_house", "hostel", "hotel", "motel"]);
const ALLOWED_LEISURE = new Set(["fitness_centre"]);
const ALLOWED_OFFICES = new Set([
  "accountant", "advertising_agency", "architect", "company", "consulting", "employment_agency",
  "estate_agent", "financial", "financial_advisor", "graphic_design", "insurance", "it", "lawyer",
  "logistics", "notary", "property_management", "tax_advisor", "telecommunication", "travel_agent",
]);

const LARGE_CHAIN_NAMES = [
  "action", "albert heijn", "aldi", "anytime fitness", "basic fit", "bastion hotels", "beter bed",
  "blokker", "bp", "burger king", "c a", "coop", "coolblue", "dekama", "dekamarkt", "dirk",
  "dominos", "domino s pizza", "esso", "etos", "febo", "fit for free", "fletcher hotels",
  "gall gall", "gamma", "hema", "h m", "hans anders", "hornbach", "hotel ibis", "ibis",
  "ikea", "intertoys", "jan linders", "jumbo", "karwei", "kfc", "kruidvat", "kwantum",
  "la place", "leen bakker", "lidl", "makro", "mcdonalds", "media markt", "mediamarkt",
  "new york pizza", "nh hotels", "odido", "pathé", "pathe", "pearle", "plus", "praxis",
  "primark", "rituals", "shell", "spar", "sportcity", "starbucks", "subway", "tango",
  "total energies", "totalenergies", "van der valk", "vodafone", "zeeman", "zara",
];

const BRANCH_LABELS: Record<string, string> = {
  bakery: "Bakkerij", beauty: "Schoonheid", butcher: "Slagerij", cafe: "Café", car_repair: "Autogarage",
  childcare: "Kinderopvang", clinic: "Kliniek", company: "Zakelijke dienstverlening", dentist: "Tandarts",
  hairdresser: "Kapper", hotel: "Hotel", insurance: "Verzekeringen", lawyer: "Advocaat", restaurant: "Restaurant",
  travel_agent: "Reisbureau", veterinary: "Dierenarts",
};

export function normalizeText(value: string | undefined) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " en ")
    .replace(/['’]/g, "")
    .replace(/\b(bv|b v|vof|v o f|nv|n v|holding|nederland)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizePhone(value: string | undefined): { display: string; normalized: string } | null {
  if (!value) return null;
  const first = value.split(";")[0]?.trim().replace(/^tel:/i, "");
  if (!first || /[a-z]/i.test(first)) return null;
  let compact = first.replace(/[^\d+]/g, "");
  if ((compact.match(/\+/g) || []).length > 1 || (compact.includes("+") && !compact.startsWith("+"))) return null;
  if (compact.startsWith("00")) compact = `+${compact.slice(2)}`;
  else if (compact.startsWith("31")) compact = `+${compact}`;
  else if (compact.startsWith("0")) compact = `+31${compact.slice(1)}`;
  if (!compact.startsWith("+")) return null;
  const digits = compact.slice(1);
  if (digits.length < 9 || digits.length > 15 || /^(\d)\1+$/.test(digits)) return null;
  return { display: first, normalized: compact };
}

export function hasOwnWebsite(tags: Record<string, string>) {
  return WEBSITE_KEYS.some(key => Boolean(tags[key]?.trim()));
}

export function getValidPhone(tags: Record<string, string>) {
  for (const key of PHONE_KEYS) {
    const phone = normalizePhone(tags[key]);
    if (phone) return phone;
  }
  return null;
}

export function isClosedOrInactive(tags: Record<string, string>) {
  if (CLOSED_LIFECYCLE_KEYS.some(key => key in tags)) return true;
  if (Object.keys(tags).some(key => /^(disused|abandoned|demolished|razed|removed|destroyed):/.test(key))) return true;
  if (CLOSED_VALUES.has((tags.shop || "").toLowerCase())) return true;
  if (tags.opening_hours?.toLowerCase() === "closed") return true;
  return /\b(permanent gesloten|permanently closed|definitief gesloten|failliet|opgeheven)\b/i.test(tags.name || "");
}

function isBusinessCategory(tags: Record<string, string>) {
  if (tags.shop && !CLOSED_VALUES.has(tags.shop.toLowerCase())) return true;
  if (tags.craft || tags.healthcare) return true;
  if (tags.office && ALLOWED_OFFICES.has(tags.office)) return true;
  if (tags.amenity && ALLOWED_AMENITIES.has(tags.amenity)) return true;
  if (tags.tourism && ALLOWED_TOURISM.has(tags.tourism)) return true;
  return Boolean(tags.leisure && ALLOWED_LEISURE.has(tags.leisure));
}

export function isLargeChain(tags: Record<string, string>, repeatedNameCount = 1) {
  const identities = [tags.name, tags.brand, tags.operator, tags["official_name"]].map(normalizeText).filter(Boolean);
  if (tags["brand:wikidata"] || tags.network || tags["network:wikidata"]) return true;
  if (tags.franchise && tags.franchise.toLowerCase() !== "no") return true;
  if (repeatedNameCount >= 3) return true;
  return identities.some(identity => LARGE_CHAIN_NAMES.some(chain => identity === chain || identity.startsWith(`${chain} `)));
}

export function providerId(element: OsmElement) {
  return `${element.type[0]}:${element.id}`;
}

export function businessKey(tags: Record<string, string>, region: LeadRegion) {
  const address = [tags["addr:street"], tags["addr:housenumber"], tags["addr:postcode"], tags["addr:city"] || region.name].filter(Boolean).join(" ");
  return `${normalizeText(tags.name)}|${normalizeText(address)}`;
}

function branchLabel(tags: Record<string, string>) {
  for (const key of BUSINESS_KEYS) {
    const value = tags[key];
    if (value) return BRANCH_LABELS[value] || value.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
  }
  return "Lokaal bedrijf";
}

export function qualifyOsmElement(
  element: OsmElement,
  region: LeadRegion,
  repeatedNameCount = 1,
): { accepted: true; lead: Lead; phoneKey: string; businessKey: string } | { accepted: false; reason: RejectionReason } {
  const tags = element.tags || {};
  if (!tags.name?.trim()) return { accepted: false, reason: "NO_NAME" };
  if (!isBusinessCategory(tags)) return { accepted: false, reason: "NO_BUSINESS_CATEGORY" };
  if (hasOwnWebsite(tags)) return { accepted: false, reason: "HAS_WEBSITE" };
  const phone = getValidPhone(tags);
  if (!phone) return { accepted: false, reason: "NO_VALID_PHONE" };
  if (isClosedOrInactive(tags)) return { accepted: false, reason: "CLOSED_OR_INACTIVE" };
  if (isLargeChain(tags, repeatedNameCount)) return { accepted: false, reason: "FRANCHISE_OR_LARGE_CHAIN" };
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;
  if (latitude === undefined || longitude === undefined) return { accepted: false, reason: "NO_COORDINATES" };

  const street = [tags["addr:street"] || tags["addr:place"], tags["addr:housenumber"]].filter(Boolean).join(" ");
  const city = tags["addr:city"] || tags["addr:place"] || region.name;
  const email = tags.email || tags["contact:email"] || undefined;
  const key = businessKey(tags, region);
  const branch = branchLabel(tags);
  const lead: Lead = {
    id: `osm-${element.type}-${element.id}`,
    name: tags.name.trim(),
    branch,
    description: `${branch} in ${city}. In de geraadpleegde OpenStreetMap-vermelding staat geen eigen website, maar wel een telefoonnummer.`,
    address: street || "Adres niet volledig vermeld",
    postalCode: tags["addr:postcode"] || "",
    city,
    province: region.province,
    phone: phone.display,
    email,
    mapsUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    rating: 0,
    reviewCount: 0,
    openingHours: tags.opening_hours || "Niet vermeld",
    latitude,
    longitude,
    source: "openstreetmap",
    foundAt: new Date().toISOString(),
    status: "Nieuw",
    notes: "",
    tags: ["Geen website vermeld", "Telefoon aanwezig", "Geen groot ketensignaal"],
    websiteScore: 0,
    leadScore: 90,
    scoreReasons: ["Geen website vermeld", "Telefonisch bereikbaar", "Geen groot ketensignaal"],
    verification: { phone: "openbare bron", email: email ? "openbare bron" : "niet geverifieerd", website: "openbare bron" },
  };
  return { accepted: true, lead, phoneKey: phone.normalized, businessKey: key };
}
