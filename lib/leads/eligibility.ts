import { confidenceLevel, excludedBusinessValues } from "./config";
import { isPermanentlyClosed, isTemporarilyClosed } from "./company-status";
import { evaluateNewLeadGate } from "./intake-gate";
import { normalizeDomain, normalizeEmails, normalizePhones, normalizePostalCode, normalizeText } from "./normalization";
import { determineWebsiteStatus, isNonOwnedWebsite } from "./website";

export type Candidate = {
  externalPlaceId: string; companyName: string; phoneNumber?: string; internationalPhoneNumber?: string;
  website?: string; websiteUrl?: string; website_url?: string; domain?: string; url?: string; homepage?: string; homePage?: string;
  companyWebsite?: string; company_website?: string; officialWebsite?: string; official_website?: string; businessWebsite?: string;
  googleMapsWebsite?: string; externalWebsite?: string; businessStatus?: string; country: string; category: string; city: string;
  province?: string; municipality?: string; postalCode?: string; streetAddress: string;
  latitude: number; longitude: number; googleMapsUrl: string; subCategory?: string;
  source?: "GOOGLE_PLACES" | "OPENSTREETMAP"; houseNumber?: string;
  brand?: string; brandWikidata?: string; operator?: string;
  phoneNumbers?: Array<string | null | undefined>; emailAddresses?: Array<string | null | undefined>; activitySignals?: string[];
  websiteFields?: Array<string | null | undefined>;
  links?: unknown; contact?: unknown; contactInfo?: unknown; details?: unknown; attributes?: unknown; externalLinks?: unknown; socialLinks?: unknown;
  rawData?: unknown; sourceData?: unknown; websiteAbsenceConfirmed?: boolean;
  email?: string; closureSignals?: string[]; sourceUpdatedAt?: string; sourceUrl?: string; fetchedAt?: string;
};

export type EligibleBase = Candidate & {
  normalizedPhoneNumber: string; normalizedCompanyName: string; normalizedAddress: string;
  normalizedDomain: string | null; email?: string; businessStatus: "OPERATIONAL" | "UNKNOWN";
  confidenceScore: number; confidenceLevel: "LOW" | "MEDIUM" | "HIGH";
};
export type EligibleLead = EligibleBase & { leadType: "NO_WEBSITE" };

const MAX_OSM_SOURCE_AGE_MS = 6 * 365.25 * 24 * 60 * 60 * 1000;

export function hasPlausibleBusinessLocation(candidate: Candidate) {
  const country = candidate.country.toUpperCase();
  const postalCode = normalizePostalCode(candidate.postalCode || candidate.streetAddress, country);
  const hasHouseNumber = Boolean(candidate.houseNumber?.trim() || /\d/.test(candidate.streetAddress));
  const bounds = country === "NL"
    ? candidate.latitude >= 50.7 && candidate.latitude <= 53.7 && candidate.longitude >= 3.2 && candidate.longitude <= 7.3
    : country === "BE" && candidate.latitude >= 49.4 && candidate.latitude <= 51.6 && candidate.longitude >= 2.4 && candidate.longitude <= 6.5;
  return Boolean(postalCode && hasHouseNumber && candidate.streetAddress.trim().length >= 6 && bounds);
}

export function hasRecentSourceEvidence(candidate: Candidate, now = Date.now()) {
  if (candidate.source !== "OPENSTREETMAP") return true;
  const timestamp = candidate.sourceUpdatedAt ? Date.parse(candidate.sourceUpdatedAt) : Number.NaN;
  return Number.isFinite(timestamp) && timestamp <= now + 86_400_000 && now - timestamp <= MAX_OSM_SOURCE_AGE_MS;
}

export function validateCandidateBasics(candidate: Candidate): { ok: true; lead: EligibleBase } | { ok: false; reason: string } {
  if (!candidate.externalPlaceId || !candidate.companyName || !candidate.streetAddress || !candidate.city) return { ok: false, reason: "onvolledig" };
  if (!["NL", "BE"].includes(candidate.country.toUpperCase())) return { ok: false, reason: "buiten_gebied" };
  if (isPermanentlyClosed(candidate) || isTemporarilyClosed(candidate)) return { ok: false, reason: "niet_operationeel" };
  if (isLikelyChain(candidate.companyName, candidate.brand, candidate.operator) || candidate.brandWikidata || excludedBusinessValues.has(candidate.category.toLowerCase())) return { ok: false, reason: "keten_of_uitgesloten" };
  if (!hasPlausibleBusinessLocation(candidate)) return { ok: false, reason: "onvolledige_locatie" };
  if (!hasRecentSourceEvidence(candidate)) return { ok: false, reason: "verouderde_bron" };
  const normalizedPhoneNumber = normalizePhones([candidate.internationalPhoneNumber, candidate.phoneNumber, ...(candidate.phoneNumbers ?? [])], candidate.country)[0];
  if (!normalizedPhoneNumber) return { ok: false, reason: "ongeldig_nummer" };
  const status = candidate.businessStatus?.toUpperCase() === "OPERATIONAL" ? "OPERATIONAL" : "UNKNOWN";
  if (status === "UNKNOWN" && (!candidate.postalCode || candidate.streetAddress.length < 6)) return { ok: false, reason: "onbetrouwbare_status" };
  let confidenceScore = candidate.source === "OPENSTREETMAP" ? 78 : 74;
  if (status === "UNKNOWN") confidenceScore -= 10;
  const normalizedPostalCode = normalizePostalCode(candidate.postalCode || candidate.streetAddress, candidate.country) ?? undefined;
  const normalizedEmail = normalizeEmails([candidate.email, ...(candidate.emailAddresses ?? [])])[0];
  if (normalizedPostalCode && (candidate.houseNumber || /\d/.test(candidate.streetAddress))) confidenceScore += 5;
  if (normalizedEmail) confidenceScore += 3;
  if (candidate.activitySignals?.length) confidenceScore += Math.min(4, candidate.activitySignals.length);
  if (isNonOwnedWebsite(candidate.website)) confidenceScore += 6;
  confidenceScore = Math.max(0, Math.min(100, confidenceScore));
  const websiteDecision = determineWebsiteStatus(candidate);
  return { ok: true, lead: {
    ...candidate, country: candidate.country.toUpperCase(), postalCode: normalizedPostalCode, businessStatus: status,
    normalizedPhoneNumber, normalizedCompanyName: normalizeText(candidate.companyName),
    normalizedAddress: normalizeText(candidate.streetAddress), normalizedDomain: normalizeDomain(websiteDecision.normalizedUrl),
    email: normalizedEmail, confidenceScore, confidenceLevel: confidenceLevel(confidenceScore),
  } };
}

export function qualifyCandidate(candidate: Candidate, verification?: Parameters<typeof evaluateNewLeadGate>[1]): { ok: true; lead: EligibleLead } | { ok: false; reason: string } {
  const basic = validateCandidateBasics(candidate);
  if (!basic.ok) return basic;
  const gate = evaluateNewLeadGate(candidate, verification);
  if (!gate.allowed) return { ok: false, reason: gate.reason === "SKIPPED_HAS_WEBSITE" ? "eigen_website" : gate.reason === "SKIPPED_PERMANENTLY_CLOSED" ? "niet_operationeel" : "website_onzeker" };
  return { ok: true, lead: { ...basic.lead, website: isNonOwnedWebsite(candidate.website) ? undefined : candidate.website, normalizedDomain: null, leadType: "NO_WEBSITE" } };
}

const chainNames = ["mcdonalds","burger king","subway","dominos","kfc","starbucks","hema","action","aldi","lidl","jumbo","ah to go","albert heijn","kruidvat","etos","gamma","praxis","kwikfit","basic fit","anytime fitness","van der valk","fletcher hotels","ibis hotel"];
export function isLikelyChain(...values: Array<string | undefined>) {
  const normalized = values.map((value) => normalizeText(value ?? "").replaceAll(" ", "")).filter(Boolean);
  return chainNames.some((chain) => normalized.some((value) => value.includes(normalizeText(chain).replaceAll(" ", ""))));
}
