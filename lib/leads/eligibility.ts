import { confidenceLevel, excludedBusinessValues } from "./config";
import { normalizeDomain, normalizeEmail, normalizePhone, normalizeText } from "./normalization";
import { determineWebsiteStatus, isNonOwnedWebsite } from "./website";

export type Candidate = {
  externalPlaceId: string; companyName: string; phoneNumber?: string; internationalPhoneNumber?: string;
  website?: string; websiteUrl?: string; website_url?: string; domain?: string; url?: string; businessWebsite?: string;
  googleMapsWebsite?: string; externalWebsite?: string; businessStatus?: string; country: string; category: string; city: string;
  province?: string; municipality?: string; postalCode?: string; streetAddress: string;
  latitude: number; longitude: number; googleMapsUrl: string; subCategory?: string;
  source?: "GOOGLE_PLACES" | "OPENSTREETMAP"; houseNumber?: string;
  websiteFields?: Array<string | null | undefined>;
  email?: string; closureSignals?: string[]; sourceUpdatedAt?: string;
};

export type EligibleBase = Candidate & {
  normalizedPhoneNumber: string; normalizedCompanyName: string; normalizedAddress: string;
  normalizedDomain: string | null; email?: string; businessStatus: "OPERATIONAL" | "UNKNOWN";
  confidenceScore: number; confidenceLevel: "LOW" | "MEDIUM" | "HIGH";
};
export type EligibleLead = EligibleBase & { leadType: "NO_WEBSITE" };

export function validateCandidateBasics(candidate: Candidate): { ok: true; lead: EligibleBase } | { ok: false; reason: string } {
  if (!candidate.externalPlaceId || !candidate.companyName || !candidate.streetAddress || !candidate.city) return { ok: false, reason: "onvolledig" };
  if (!["NL", "BE"].includes(candidate.country.toUpperCase())) return { ok: false, reason: "buiten_gebied" };
  if (["CLOSED_PERMANENTLY", "PERMANENTLY_CLOSED"].includes(candidate.businessStatus ?? "")) return { ok: false, reason: "niet_operationeel" };
  if (["CLOSED_TEMPORARILY", "TEMPORARILY_CLOSED"].includes(candidate.businessStatus ?? "")) return { ok: false, reason: "niet_operationeel" };
  if (candidate.closureSignals?.length) return { ok: false, reason: "niet_operationeel" };
  if (isLikelyChain(candidate.companyName) || excludedBusinessValues.has(candidate.category.toLowerCase())) return { ok: false, reason: "keten_of_uitgesloten" };
  const normalizedPhoneNumber = normalizePhone(candidate.internationalPhoneNumber || candidate.phoneNumber || "", candidate.country);
  if (!normalizedPhoneNumber) return { ok: false, reason: "ongeldig_nummer" };
  const status = candidate.businessStatus === "OPERATIONAL" ? "OPERATIONAL" : "UNKNOWN";
  if (status === "UNKNOWN" && (!candidate.postalCode || candidate.streetAddress.length < 6)) return { ok: false, reason: "onbetrouwbare_status" };
  let confidenceScore = candidate.source === "GOOGLE_PLACES" ? 90 : 74;
  if (status === "UNKNOWN") confidenceScore -= 10;
  if (candidate.postalCode && candidate.houseNumber) confidenceScore += 5;
  if (candidate.email) confidenceScore += 3;
  if (isNonOwnedWebsite(candidate.website)) confidenceScore += 6;
  confidenceScore = Math.max(0, Math.min(100, confidenceScore));
  const websiteDecision = determineWebsiteStatus(candidate);
  return { ok: true, lead: {
    ...candidate, country: candidate.country.toUpperCase(), businessStatus: status,
    normalizedPhoneNumber, normalizedCompanyName: normalizeText(candidate.companyName),
    normalizedAddress: normalizeText(candidate.streetAddress), normalizedDomain: normalizeDomain(websiteDecision.normalizedUrl),
    email: normalizeEmail(candidate.email) ?? undefined, confidenceScore, confidenceLevel: confidenceLevel(confidenceScore),
  } };
}

export function qualifyCandidate(candidate: Candidate): { ok: true; lead: EligibleLead } | { ok: false; reason: string } {
  const basic = validateCandidateBasics(candidate);
  if (!basic.ok) return basic;
  const websiteDecision = determineWebsiteStatus(candidate);
  if (websiteDecision.status === "has_website" || websiteDecision.status === "outdated_website") return { ok: false, reason: "eigen_website" };
  if (websiteDecision.status === "unknown") return { ok: false, reason: "website_onzeker" };
  return { ok: true, lead: { ...basic.lead, website: isNonOwnedWebsite(candidate.website) ? undefined : candidate.website, normalizedDomain: null, leadType: "NO_WEBSITE" } };
}

const chainNames = ["mcdonalds","burger king","subway","dominos","kfc","starbucks","hema","action","aldi","lidl","jumbo","ah to go","albert heijn","kruidvat","etos","gamma","praxis","kwikfit","basic fit","anytime fitness","van der valk","fletcher hotels","ibis hotel"];
export function isLikelyChain(name: string) { const normalized = normalizeText(name).replaceAll(" ", ""); return chainNames.some((chain) => normalized.includes(normalizeText(chain).replaceAll(" ", ""))); }
