import { isLikelyChain, type Candidate } from "./eligibility";
import { normalizeEmails, normalizePhones, normalizeText } from "./normalization";

export type SingleLocationReason =
  | "meerdere_vestigingen"
  | "vermoedelijke_keten"
  | "franchise"
  | "merk_of_netwerk"
  | "zelfde_naam_meerdere_adressen"
  | "zelfde_telefoon_meerdere_adressen"
  | "onzeker_aantal_vestigingen"
  | "dubbele_vermelding_zelfde_vestiging"
  | "enkele_vestiging_bevestigd";

export type SingleLocationDecision = {
  status: "CONFIRMED" | "MULTIPLE" | "UNCERTAIN";
  reason: SingleLocationReason;
  evidence: string[];
  duplicateExternalIds: string[];
};

const legalForms = new Set(["bv", "b.v", "vof", "v.o.f", "nv", "n.v", "eenmanszaak", "maatschap", "cv", "stichting"]);
const branchWords = new Set(["vestiging", "filiaal", "locatie", "centrum", "center", "shop", "winkel", "salon", "praktijk"]);
const genericNames = new Set(["studio", "salon", "praktijk", "service", "diensten", "bouw", "zorg", "advies", "consultancy", "kapper", "garage", "shop", "winkel"]);
const explicitMultiplePattern = /\b(?:vestigingen|filialen|meerdere locaties|onze winkels|onze salons|onze praktijken|hoofdvestiging|nevenvestiging|onderdeel van|winkelketen|landelijke keten|regionale keten)\b/i;
const franchisePattern = /\bfranchis(?:e|er|ing|enemer|evestiging)\b/i;

function rawRecord(candidate: Candidate) {
  return candidate.rawData && typeof candidate.rawData === "object" ? candidate.rawData as Record<string, unknown> : {};
}

function rawStrings(value: unknown, depth = 0): string[] {
  if (depth > 5 || value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => rawStrings(item, depth + 1));
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap((item) => rawStrings(item, depth + 1));
  return [];
}

export function organizationNameKey(name: string, city?: string) {
  const cityTokens = new Set(normalizeText(city ?? "").split(" ").filter(Boolean));
  const withoutSplitLegalForms = normalizeText(name).replace(/\b(?:b v|v o f|n v|c v)\b/g, " ");
  let tokens = withoutSplitLegalForms.split(" ").filter(Boolean)
    .filter((token) => !legalForms.has(token));
  while (tokens.length > 1 && (branchWords.has(tokens.at(-1)!) || cityTokens.has(tokens.at(-1)!))) tokens = tokens.slice(0, -1);
  return tokens.join(" ");
}

function informativeName(key: string) {
  const tokens = key.split(" ").filter(Boolean);
  return key.length >= 5 && tokens.some((token) => token.length >= 4 && !genericNames.has(token));
}

export function similarOrganizationName(left: Candidate, right: Candidate) {
  const a = organizationNameKey(left.companyName, left.city);
  const b = organizationNameKey(right.companyName, right.city);
  if (!informativeName(a) || !informativeName(b)) return false;
  if (a === b) return true;
  const aTokens = new Set(a.split(" "));
  const bTokens = new Set(b.split(" "));
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return aTokens.size >= 2 && bTokens.size >= 2 && intersection / Math.max(1, union) >= 0.8;
}

function addressKey(candidate: Candidate) {
  return normalizeText([candidate.streetAddress, candidate.postalCode, candidate.city].filter(Boolean).join(" "));
}

function distanceMeters(left: Candidate, right: Candidate) {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(right.latitude - left.latitude);
  const dLon = radians(right.longitude - left.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function samePhysicalLocation(left: Candidate, right: Candidate) {
  const exactAddress = addressKey(left) && addressKey(left) === addressKey(right);
  const samePostal = Boolean(left.postalCode && right.postalCode && normalizeText(left.postalCode) === normalizeText(right.postalCode));
  const near = [left.latitude, left.longitude, right.latitude, right.longitude].every(Number.isFinite) && distanceMeters(left, right) <= 40;
  return Boolean(exactAddress || (samePostal && near));
}

function phones(candidate: Candidate) {
  return new Set(normalizePhones([candidate.phoneNumber, candidate.internationalPhoneNumber, ...(candidate.phoneNumbers ?? [])], candidate.country));
}

function emails(candidate: Candidate) {
  return new Set(normalizeEmails([candidate.email, ...(candidate.emailAddresses ?? [])]));
}

function intersects(left: Set<string>, right: Set<string>) {
  return [...left].some((value) => right.has(value));
}

function externalOrganizationIds(candidate: Candidate) {
  const raw = rawRecord(candidate);
  return new Set([candidate.brandWikidata, raw["brand:wikidata"], raw["operator:wikidata"], raw["network:wikidata"], raw["franchise:id"]]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim().toLowerCase()));
}

export function directSingleLocationSignal(candidate: Candidate): SingleLocationDecision | null {
  const raw = rawRecord(candidate);
  const combined = [candidate.companyName, candidate.description, candidate.contactText, ...rawStrings(raw)].filter(Boolean).join(" ");
  if (isLikelyChain(candidate.companyName, candidate.brand, candidate.operator)) {
    return { status: "MULTIPLE", reason: "vermoedelijke_keten", evidence: ["Bekende ketennaam of ketenoperator gevonden."], duplicateExternalIds: [] };
  }
  if (franchisePattern.test(combined) || Object.keys(raw).some((key) => /franchise/i.test(key))) {
    return { status: "MULTIPLE", reason: "franchise", evidence: ["Franchiseveld of franchisesignaal gevonden."], duplicateExternalIds: [] };
  }
  const distinctOperator = candidate.operator && normalizeText(candidate.operator) !== normalizeText(candidate.companyName) ? candidate.operator : undefined;
  const organizationFields = [candidate.brand, candidate.brandWikidata, distinctOperator, raw["brand:wikipedia"], raw.network, raw["network:wikidata"], raw.branch, raw["operator:wikidata"]]
    .filter((value) => typeof value === "string" && Boolean(value.trim()));
  if (organizationFields.length) {
    return { status: "MULTIPLE", reason: "merk_of_netwerk", evidence: ["Merk-, netwerk-, branch- of organisatieveld is ingevuld."], duplicateExternalIds: [] };
  }
  if (explicitMultiplePattern.test(combined)) {
    return { status: "MULTIPLE", reason: "meerdere_vestigingen", evidence: ["Expliciete tekst over filialen of meerdere locaties gevonden."], duplicateExternalIds: [] };
  }
  const locationSocialPages = (candidate.socialUrls ?? []).filter((url) => /(?:vestiging|filiaal|locations?|locaties|stores?)[\/_-]/i.test(url));
  if (locationSocialPages.length > 1) {
    return { status: "MULTIPLE", reason: "meerdere_vestigingen", evidence: ["Meerdere locatiepagina's in openbare sociale profielen gevonden."], duplicateExternalIds: [] };
  }
  return null;
}

export function assessSingleLocation(candidate: Candidate, related: Candidate[], lookupCompleted = true): SingleLocationDecision {
  const direct = directSingleLocationSignal(candidate);
  if (direct) return direct;
  if (!lookupCompleted) {
    return { status: "UNCERTAIN", reason: "onzeker_aantal_vestigingen", evidence: ["De gratis identiteitscontrole kon niet volledig worden uitgevoerd."], duplicateExternalIds: [] };
  }

  const duplicateExternalIds: string[] = [];
  for (const other of related) {
    if (!other?.externalPlaceId || other.externalPlaceId === candidate.externalPlaceId) continue;
    const sameLocation = samePhysicalLocation(candidate, other);
    const samePhone = intersects(phones(candidate), phones(other));
    const sameEmail = intersects(emails(candidate), emails(other));
    const sameOrganization = similarOrganizationName(candidate, other);
    const sameExternalOrganization = intersects(externalOrganizationIds(candidate), externalOrganizationIds(other));
    if (sameLocation && (samePhone || sameOrganization || sameExternalOrganization)) {
      duplicateExternalIds.push(other.externalPlaceId);
      continue;
    }
    if (!sameLocation && samePhone) {
      return { status: "MULTIPLE", reason: "zelfde_telefoon_meerdere_adressen", evidence: [`Telefoonnummer komt ook voor bij ${other.streetAddress}, ${other.city}.`], duplicateExternalIds };
    }
    if (!sameLocation && sameOrganization) {
      return { status: "MULTIPLE", reason: "zelfde_naam_meerdere_adressen", evidence: [`Dezelfde organisatie komt ook voor bij ${other.streetAddress}, ${other.city}.`], duplicateExternalIds };
    }
    if (!sameLocation && (sameEmail || sameExternalOrganization)) {
      return { status: "MULTIPLE", reason: "meerdere_vestigingen", evidence: ["Gedeeld e-mailadres of externe organisatie-ID op verschillende adressen."], duplicateExternalIds };
    }
  }

  return {
    status: "CONFIRMED",
    reason: duplicateExternalIds.length ? "dubbele_vermelding_zelfde_vestiging" : "enkele_vestiging_bevestigd",
    evidence: duplicateExternalIds.length
      ? ["Dubbele bronvermeldingen wijzen op exact dezelfde fysieke vestiging en worden samengevoegd."]
      : ["Geen merk-, franchise-, keten-, naam-, telefoon- of adresbewijs voor een tweede vestiging gevonden."],
    duplicateExternalIds,
  };
}

export function applySingleLocationDecision(candidate: Candidate, decision: SingleLocationDecision): Candidate {
  return {
    ...candidate,
    singleLocationStatus: decision.status,
    singleLocationReason: decision.reason,
    locationEvidence: decision.evidence,
    duplicateListingIds: decision.duplicateExternalIds,
  };
}
