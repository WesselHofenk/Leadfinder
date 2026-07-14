import { normalizePhone, normalizeText } from "./normalization";
import { hasOwnWebsite, isNonOwnedWebsite } from "./website";

export type Candidate = {
  externalPlaceId: string; companyName: string; phoneNumber?: string; internationalPhoneNumber?: string;
  website?: string; businessStatus?: string; country: string; category: string; city: string;
  province?: string; municipality?: string; postalCode?: string; streetAddress: string;
  latitude: number; longitude: number; googleMapsUrl: string; subCategory?: string;
  source?: "GOOGLE_PLACES" | "OPENSTREETMAP"; houseNumber?: string;
  websiteFields?: Array<string | null | undefined>;
};

export type EligibleLead = Candidate & { normalizedPhoneNumber: string; normalizedCompanyName: string; normalizedAddress: string; businessStatus: "OPERATIONAL"; leadType: "NO_WEBSITE" | "OUTDATED_WEBSITE" };

export function qualifyCandidate(candidate: Candidate): { ok: true; lead: EligibleLead } | { ok: false; reason: string } {
  if (!candidate.externalPlaceId || !candidate.companyName || !candidate.streetAddress || !candidate.city) return { ok: false, reason: "onvolledig" };
  if (!['NL', 'BE'].includes(candidate.country.toUpperCase())) return { ok: false, reason: "buiten_gebied" };
  if (candidate.businessStatus !== "OPERATIONAL") return { ok: false, reason: "niet_operationeel" };
  if (isLikelyChain(candidate.companyName)) return { ok: false, reason: "keten_of_franchise" };
  if (hasOwnWebsite(candidate.website, ...(candidate.websiteFields ?? []))) return { ok: false, reason: "eigen_website" };
  const normalizedPhoneNumber = normalizePhone(candidate.internationalPhoneNumber || candidate.phoneNumber || "", candidate.country);
  if (!normalizedPhoneNumber) return { ok: false, reason: "ongeldig_nummer" };
  return { ok: true, lead: { ...candidate, website: isNonOwnedWebsite(candidate.website) ? undefined : candidate.website, country: candidate.country.toUpperCase(), normalizedPhoneNumber, normalizedCompanyName: normalizeText(candidate.companyName), normalizedAddress: normalizeText(candidate.streetAddress), businessStatus: "OPERATIONAL", leadType: "NO_WEBSITE" } };
}

const chainNames = ["mcdonalds","burger king","subway","dominos","kfc","starbucks","hema","action","aldi","lidl","jumbo","ah to go","albert heijn","kruidvat","etos","gamma","praxis","kwikfit","basic fit","anytime fitness","van der valk","fletcher hotels","ibis hotel"];
export function isLikelyChain(name: string) { const normalized = normalizeText(name).replaceAll(" ", ""); return chainNames.some((chain) => normalized.includes(normalizeText(chain).replaceAll(" ", ""))); }
