import type { Prisma } from "@prisma/client";
import type { Candidate } from "./eligibility";
import { normalizePhone, normalizeText } from "./normalization";
import { determineWebsiteStatus, type WebsiteStatusDecision } from "./website";

export const GOOGLE_REVIEW_REQUIRED_REASON = "Wacht op verplichte Google Places-websitecontrole";

export function canPublishReconciledGoogleLead(
  current: { filterReason?: string | null; websiteSource?: string | null; isSuppressed?: boolean },
  decision: WebsiteStatusDecision,
) {
  const automaticallyQuarantined = current.filterReason === GOOGLE_REVIEW_REQUIRED_REASON
    || current.websiteSource === "google_reverification_required";
  return decision.status === "no_website" && automaticallyQuarantined && !current.isSuppressed;
}

export const googleVerifiedNoWebsiteWhere = {
  websiteStatus: "NO_OWN_WEBSITE",
  googleWebsitePresent: false,
  googleWebsiteVerifiedAt: { not: null },
  googlePlaceId: { not: null },
} satisfies Prisma.LeadWhereInput;

export type GoogleWebsiteVerification = {
  accepted: boolean;
  decision: WebsiteStatusDecision;
  reason: string;
};

/**
 * Google Places is the authoritative admission gate. A missing website from
 * any other source is never enough to publish a lead.
 */
export function verifyGoogleNoWebsiteCandidate(candidate: Candidate): GoogleWebsiteVerification {
  if (candidate.source !== "GOOGLE_PLACES" || !candidate.externalPlaceId || candidate.externalPlaceId.startsWith("osm:")) {
    return {
      accepted: false,
      decision: determineWebsiteStatus(candidate, { absenceVerified: false }),
      reason: "Kandidaat is niet rechtstreeks door Google Places gecontroleerd",
    };
  }

  const decision = determineWebsiteStatus(candidate, { absenceVerified: true });
  return {
    accepted: decision.status === "no_website",
    decision,
    reason: decision.status === "no_website"
      ? "Google Places bevat geen eigen bedrijfswebsite"
      : "Google Places bevat een eigen website of de website-status is onzeker",
  };
}

function distanceMeters(a: Candidate, b: Candidate) {
  const earthRadius = 6_371_000;
  const toRadians = (value: number) => value * Math.PI / 180;
  const lat1 = toRadians(a.latitude); const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude); const deltaLon = toRadians(b.longitude - a.longitude);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Selects a Google result only when identity evidence is strong; ambiguity fails closed. */
export function selectGoogleBusinessMatch(original: Candidate, results: Candidate[]) {
  const originalName = normalizeText(original.companyName);
  const originalPhone = normalizePhone(original.internationalPhoneNumber || original.phoneNumber || "", original.country);
  const originalPostal = normalizeText(original.postalCode || "");

  const scored = results
    .filter((result) => result.source === "GOOGLE_PLACES")
    .map((result) => {
      const resultPhone = normalizePhone(result.internationalPhoneNumber || result.phoneNumber || "", result.country);
      const samePhone = Boolean(originalPhone && resultPhone && originalPhone === resultPhone);
      const sameName = normalizeText(result.companyName) === originalName;
      const samePostal = Boolean(originalPostal && normalizeText(result.postalCode || "") === originalPostal);
      const nearby = distanceMeters(original, result) <= 750;
      const score = (samePhone ? 100 : 0) + (sameName ? 50 : 0) + (samePostal ? 25 : 0) + (nearby ? 15 : 0);
      return { result, score, samePhone, sameName, samePostal, nearby };
    })
    .filter((item) => item.samePhone || (item.sameName && (item.samePostal || item.nearby)))
    .sort((a, b) => b.score - a.score);

  if (!scored.length || (scored[1] && scored[1].score === scored[0].score)) return null;
  return scored[0].result;
}
