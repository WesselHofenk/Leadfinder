import type { Candidate } from "./eligibility";
import { normalizeDomain, normalizeEmail, normalizePhone, normalizeText } from "./normalization";

export type DedupeKeys = { externalId: string; phone?: string; email?: string; domain?: string; namePostal?: string; nameCityAddress: string; nameCityCategory: string };

export function candidateDedupeKeys(candidate: Candidate): DedupeKeys {
  const name = normalizeText(candidate.companyName);
  const phone = normalizePhone(candidate.internationalPhoneNumber || candidate.phoneNumber || "", candidate.country) || undefined;
  const domain = normalizeDomain(candidate.website) || undefined;
  const email = normalizeEmail(candidate.email) || undefined;
  return {
    externalId: candidate.externalPlaceId,
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
    ["external", keys.externalId], ["phone", keys.phone], ["email", keys.email], ["domain", keys.domain],
    ["postal", keys.namePostal], ["address", keys.nameCityAddress], ["name_city_category", keys.nameCityCategory],
  ].filter((item): item is [string, string] => Boolean(item[1])).map(([kind, value]) => ({ kind, fingerprint: `${kind}:${value}` }));
}

export class RunDeduplicator {
  private values = new Set<string>();
  hasOrAdd(keys: DedupeKeys) {
    const values = fingerprintValues(keys).map((item) => item.fingerprint);
    if (values.some((value) => this.values.has(value))) return true;
    values.forEach((value) => this.values.add(value));
    return false;
  }
}
