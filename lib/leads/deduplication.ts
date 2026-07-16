import type { Candidate } from "./eligibility";
import { normalizeDomain, normalizeEmail, normalizePhone, normalizeText } from "./normalization";
import { determineWebsiteStatus } from "./website";

export type DedupeKeys = { externalId: string; googlePlaceId?: string; phone?: string; email?: string; domain?: string; namePostal?: string; nameCityAddress: string; nameCityCategory: string };

export function candidateDedupeKeys(candidate: Candidate): DedupeKeys {
  const name = normalizeText(candidate.companyName);
  const phone = normalizePhone(candidate.internationalPhoneNumber || candidate.phoneNumber || "", candidate.country) || undefined;
  const domain = normalizeDomain(determineWebsiteStatus(candidate).normalizedUrl) || undefined;
  const email = normalizeEmail(candidate.email) || undefined;
  return {
    externalId: candidate.externalPlaceId,
    googlePlaceId: candidate.googlePlaceId?.trim() || undefined,
    phone,
    domain,
    email,
    namePostal: candidate.postalCode ? `${name}|${normalizeText(candidate.postalCode)}` : undefined,
    nameCityAddress: `${name}|${normalizeText(candidate.city)}|${normalizeText(candidate.streetAddress)}`,
    nameCityCategory: `${name}|${normalizeText(candidate.city)}|${normalizeText(candidate.category)}`,
  };
}

export function fingerprintValues(keys: DedupeKeys) {
  return [
    ["external", keys.externalId], ["google_place_id", keys.googlePlaceId], ["phone", keys.phone], ["email", keys.email], ["domain", keys.domain],
    ["postal", keys.namePostal], ["address", keys.nameCityAddress], ["name_city_category", keys.nameCityCategory],
  ].filter((item): item is [string, string] => Boolean(item[1])).map(([kind, value]) => ({ kind, fingerprint: `${kind}:${value}` }));
}

export function strongIdentityFingerprintValues(keys: DedupeKeys) {
  const strongKinds = new Set(["external", "google_place_id", "phone", "email", "address"]);
  return fingerprintValues(keys).filter(({ kind }) => strongKinds.has(kind));
}

export class RunDeduplicator {
  private values = new Map<string, string>();
  matchOrAdd(keys: DedupeKeys) {
    const values = strongIdentityFingerprintValues(keys);
    const matches = values.filter(({ fingerprint }) => this.values.has(fingerprint));
    if (matches.length) return {
      duplicate: true,
      matchedExternalId: this.values.get(matches[0].fingerprint),
      matchedFields: matches.map(({ kind }) => kind),
    };
    values.forEach(({ fingerprint }) => this.values.set(fingerprint, keys.externalId));
    return { duplicate: false, matchedExternalId: undefined, matchedFields: [] as string[] };
  }
  hasOrAdd(keys: DedupeKeys) {
    return this.matchOrAdd(keys).duplicate;
  }
}
