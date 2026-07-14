import type { Candidate } from "./eligibility";
import { normalizePhone, normalizeText } from "./normalization";

export type DedupeKeys = { externalId: string; phone?: string; namePostal?: string; nameCityAddress: string };

export function candidateDedupeKeys(candidate: Candidate): DedupeKeys {
  const name = normalizeText(candidate.companyName);
  const phone = normalizePhone(candidate.internationalPhoneNumber || candidate.phoneNumber || "", candidate.country) || undefined;
  return {
    externalId: candidate.externalPlaceId,
    phone,
    namePostal: candidate.postalCode ? `${name}|${normalizeText(candidate.postalCode)}` : undefined,
    nameCityAddress: `${name}|${normalizeText(candidate.city)}|${normalizeText(candidate.streetAddress)}`,
  };
}

export class RunDeduplicator {
  private values = new Set<string>();
  hasOrAdd(keys: DedupeKeys) {
    const values = [keys.externalId, keys.phone && `phone:${keys.phone}`, keys.namePostal && `postal:${keys.namePostal}`, `address:${keys.nameCityAddress}`].filter(Boolean) as string[];
    if (values.some((value) => this.values.has(value))) return true;
    values.forEach((value) => this.values.add(value));
    return false;
  }
}
