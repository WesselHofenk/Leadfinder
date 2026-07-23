import type { Candidate } from "./eligibility";
import { hasRecentSourceEvidence } from "./eligibility";
import { isPermanentlyClosed, isTemporarilyClosed, normalizeBusinessStatusText } from "./company-status";
import type { WebsiteVerificationResult } from "./website-verification";
import { detectBlockedLocation } from "./blocked-location";
import { normalizeEmails, normalizePhones } from "./normalization";

export type StrictLeadReason =
  | "BLOCKED_BRUSSELS" | "BLOCKED_GHENT" | "PHONE_REQUIRED" | "EMAIL_REQUIRED" | "NO_PUBLIC_BUSINESS_PROFILE" | "REGION_NOT_ALLOWED" | "LANGUAGE_NOT_DUTCH"
  | "BUSINESS_NOT_CONFIRMED_ACTIVE" | "BUSINESS_CLOSED" | "ADDRESS_NOT_USABLE"
  | "WEBSITE_NOT_CONFIRMED_ABSENT" | "OWN_WEBSITE_FOUND" | "SINGLE_LOCATION_NOT_CONFIRMED";

const flemishRegions = new Set(["antwerpen", "limburg", "oost vlaanderen", "vlaams brabant", "west vlaanderen"]);
const dutchWords = /\b(de|het|een|en|voor|van|met|winkel|bedrijf|kapper|schilder|loodgieter|open|gesloten|afspraak|contact|welkom)\b/gi;
const frenchWords = /\b(le|la|les|des|une|et|pour|avec|entreprise|magasin|coiffeur|peintre|plombier|ouvert|ferme|rendez vous)\b/gi;

function normalized(value?: string) {
  return (value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function rawText(candidate: Candidate) {
  const raw = candidate.rawData && typeof candidate.rawData === "object" ? candidate.rawData as Record<string, unknown> : {};
  const explicitDutch = [raw["name:nl"], raw["description:nl"], raw["contact:nl"], raw["language:nl"]].filter((value) => typeof value === "string").join(" ");
  const explicitFrench = [raw["name:fr"], raw["description:fr"], raw["contact:fr"], raw["language:fr"]].filter((value) => typeof value === "string").join(" ");
  const general = [candidate.companyName, candidate.description, candidate.contactText, ...(candidate.reviewSnippets ?? []), ...Object.entries(raw)
    .filter(([key, value]) => typeof value === "string" && /name|description|contact|note|operator|brand/.test(key))
    .map(([, value]) => String(value))].join(" ");
  return { explicitDutch, explicitFrench, general };
}

export function detectDutchBusinessLanguage(candidate: Candidate) {
  if (candidate.language && (candidate.languageConfidence ?? 0) >= 80) {
    return { language: candidate.language.toLowerCase(), confidence: candidate.languageConfidence ?? 80 };
  }
  const text = rawText(candidate);
  if (text.explicitDutch && !text.explicitFrench) return { language: "nl", confidence: 95 };
  if (text.explicitFrench && !text.explicitDutch) return { language: "fr", confidence: 95 };
  const content = normalized(text.general);
  const nl = content.match(dutchWords)?.length ?? 0;
  const fr = content.match(frenchWords)?.length ?? 0;
  if (nl >= 2 && nl >= fr + 1) return { language: "nl", confidence: Math.min(90, 65 + nl * 5) };
  if (fr >= 2 && fr >= nl + 1) return { language: "fr", confidence: Math.min(90, 65 + fr * 5) };
  const phone = normalizePhones([candidate.internationalPhoneNumber, candidate.phoneNumber, ...(candidate.phoneNumbers ?? [])], candidate.country)[0];
  const region = normalized(candidate.province || candidate.regionLanguage || "");
  if (fr === 0 && candidate.country.toUpperCase() === "NL" && phone?.startsWith("+31")) return { language: "nl", confidence: 80 };
  if (fr === 0 && candidate.country.toUpperCase() === "BE" && phone?.startsWith("+32") && flemishRegions.has(region)) return { language: "nl", confidence: 75 };
  return { language: "unknown", confidence: 0 };
}

export function allowedDutchRegion(candidate: Candidate) {
  const country = candidate.country.toUpperCase();
  if (country === "NL") return true;
  if (country !== "BE") return false;
  const region = normalized(candidate.province || candidate.regionLanguage || candidate.municipality || "");
  if (flemishRegions.has(region)) return true;
  return false;
}

export function hasVerifiedPublicBusinessProfile(candidate: Candidate) {
  const url = candidate.googleBusinessProfileUrl?.trim();
  const validUrl = Boolean(url && /^https:\/\/(?:(?:www\.)?(?:google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)|maps\.app\.goo\.gl)(?:\/|\?|$)/i.test(url));
  const explicitPlaceId = Boolean(candidate.googlePlaceId?.trim());
  const google = Boolean(
    (candidate.source === "GOOGLE_PLACES" && explicitPlaceId)
    || (candidate.googleBusinessProfileVerified && (validUrl || explicitPlaceId)),
  );
  const osm = candidate.source === "OPENSTREETMAP"
    && /^osm:(?:node|way|relation)\//.test(candidate.externalPlaceId)
    && /^https:\/\/www\.openstreetmap\.org\/(?:node|way|relation)\//.test(candidate.sourceUrl || candidate.googleMapsUrl);
  return google || osm;
}

export function confirmedActiveStatus(candidate: Candidate) {
  if (isPermanentlyClosed(candidate) || isTemporarilyClosed(candidate)) return { active: false, confidence: 100, status: "closed" as const };
  const status = normalizeBusinessStatusText(candidate.businessStatus);
  const sourceStatusConfirmed = candidate.source === "GOOGLE_PLACES" || candidate.googleBusinessStatusVerified === true || candidate.source === "OPENSTREETMAP";
  const sourceTime = candidate.sourceUpdatedAt ? Date.parse(candidate.sourceUpdatedAt) : Number.NaN;
  const currentSource = candidate.source !== "OPENSTREETMAP" || (Number.isFinite(sourceTime) && Date.now() - sourceTime <= 2 * 365.25 * 86_400_000);
  if (sourceStatusConfirmed && currentSource && ["operational", "open", "active", "actief", "geopend"].includes(status) && hasRecentSourceEvidence(candidate)) return { active: true, confidence: 95, status: "active" as const };
  const positiveSignals = new Set(candidate.activitySignals ?? []);
  const hasCurrentActivity = [...positiveSignals].some((signal) => /opening_hours|check_date|survey|phone|email|facebook|instagram/.test(signal));
  if (sourceStatusConfirmed && currentSource && hasCurrentActivity && hasRecentSourceEvidence(candidate)) return { active: true, confidence: 80, status: "likely_active" as const };
  return { active: false, confidence: 0, status: "insufficient" as const };
}

export function hasReadableAddress(candidate: Candidate) {
  const address = (candidate.formattedAddress || candidate.streetAddress || "").trim();
  return address.length >= 8 && !/\([-+]?\d+\.\d+,\s*[-+]?\d+\.\d+\)/.test(address)
    && !/^onbekend$/i.test(address) && Boolean(candidate.city?.trim());
}

export function validateStrictLead(
  candidate: Candidate,
  verification?: WebsiteVerificationResult,
  options: { requireSingleLocation?: boolean; requirePhone?: boolean; requireEmail?: boolean } = {},
) {
  const reasons: StrictLeadReason[] = [];
  const blocked = detectBlockedLocation(candidate as Candidate & Record<string, unknown>);
  const language = detectDutchBusinessLanguage(candidate);
  const active = confirmedActiveStatus(candidate);
  if (blocked.area === "BRUSSELS") reasons.push("BLOCKED_BRUSSELS");
  if (blocked.area === "GHENT") reasons.push("BLOCKED_GHENT");
  if (options.requirePhone !== false && !normalizePhones([candidate.internationalPhoneNumber, candidate.phoneNumber, ...(candidate.phoneNumbers ?? [])], candidate.country).length) reasons.push("PHONE_REQUIRED");
  if (options.requireEmail !== false && !normalizeEmails([candidate.email, ...(candidate.emailAddresses ?? [])]).length) reasons.push("EMAIL_REQUIRED");
  if (!hasVerifiedPublicBusinessProfile(candidate)) reasons.push("NO_PUBLIC_BUSINESS_PROFILE");
  if (!allowedDutchRegion(candidate)) reasons.push("REGION_NOT_ALLOWED");
  if (language.language !== "nl" || language.confidence < 70) reasons.push("LANGUAGE_NOT_DUTCH");
  if (active.status === "closed") reasons.push("BUSINESS_CLOSED");
  else if (!active.active) reasons.push("BUSINESS_NOT_CONFIRMED_ACTIVE");
  if (!hasReadableAddress(candidate)) reasons.push("ADDRESS_NOT_USABLE");
  if (options.requireSingleLocation !== false && candidate.singleLocationStatus !== "CONFIRMED") reasons.push("SINGLE_LOCATION_NOT_CONFIRMED");
  if (verification) {
    if (["WEBSITE_FOUND", "WEBSITE_OUTDATED", "WEBSITE_BROKEN"].includes(verification.status)) reasons.push("OWN_WEBSITE_FOUND");
    else if (verification.status !== "NO_WEBSITE_CONFIRMED") reasons.push("WEBSITE_NOT_CONFIRMED_ABSENT");
  }
  return { valid: reasons.length === 0, reasons, language, active, blocked };
}

/** Cheap, deterministic quality gate used before the remote location-count lookup. */
export function validateStrictLeadBeforeLocation(candidate: Candidate) {
  return validateStrictLead(candidate, undefined, { requireSingleLocation: false });
}

/** Rejects closed, blocked, non-Dutch and otherwise unusable records before
 * spending enrichment requests on missing contact data. */
export function validateStrictLeadBeforeContactEnrichment(candidate: Candidate) {
  return validateStrictLead(candidate, undefined, { requireSingleLocation: false, requirePhone: false, requireEmail: false });
}
