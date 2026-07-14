import { normalizePhone, normalizeText } from "./normalization";

export type Candidate = {
  externalPlaceId: string; companyName: string; phoneNumber?: string; internationalPhoneNumber?: string;
  website?: string; businessStatus?: string; country: string; category: string; city: string;
  province?: string; municipality?: string; postalCode?: string; streetAddress: string;
  latitude: number; longitude: number; googleMapsUrl: string; subCategory?: string;
};

export type EligibleLead = Candidate & { normalizedPhoneNumber: string; normalizedCompanyName: string; normalizedAddress: string; businessStatus: "OPERATIONAL"; leadType: "NO_WEBSITE" | "OUTDATED_WEBSITE" };

export function qualifyCandidate(candidate: Candidate): { ok: true; lead: EligibleLead } | { ok: false; reason: string } {
  if (!candidate.externalPlaceId || !candidate.companyName || !candidate.streetAddress || !candidate.city) return { ok: false, reason: "onvolledig" };
  if (!['NL', 'BE'].includes(candidate.country.toUpperCase())) return { ok: false, reason: "buiten_gebied" };
  if (candidate.businessStatus !== "OPERATIONAL") return { ok: false, reason: "niet_operationeel" };
  const normalizedPhoneNumber = normalizePhone(candidate.internationalPhoneNumber || candidate.phoneNumber || "", candidate.country);
  if (!normalizedPhoneNumber) return { ok: false, reason: "ongeldig_nummer" };
  return { ok: true, lead: { ...candidate, country: candidate.country.toUpperCase(), normalizedPhoneNumber, normalizedCompanyName: normalizeText(candidate.companyName), normalizedAddress: normalizeText(candidate.streetAddress), businessStatus: "OPERATIONAL", leadType: candidate.website?.trim() ? "OUTDATED_WEBSITE" : "NO_WEBSITE" } };
}
