import type { Candidate } from "./eligibility";
import { extractCompanyWebsite } from "./website";
import { normalizePhones } from "./normalization";

/**
 * Scheduling score only. Hard eligibility rules are always evaluated separately
 * and can never be overridden by a high score.
 */
export function candidateQualityScore(candidate: Candidate) {
  let score = 0;
  if (normalizePhones([candidate.internationalPhoneNumber, candidate.phoneNumber, ...(candidate.phoneNumbers ?? [])], candidate.country).length) score += 30;
  if (candidate.streetAddress?.trim() && candidate.postalCode?.trim() && candidate.city?.trim()) score += 20;
  if (candidate.businessStatus === "OPERATIONAL") score += 15;
  if (candidate.sourceUpdatedAt && Number.isFinite(Date.parse(candidate.sourceUpdatedAt))) score += 5;
  if (candidate.activitySignals?.length) score += 5;
  if (candidate.googleBusinessProfileVerified) score += 10;
  if (extractCompanyWebsite(candidate)) score -= 100;
  if (candidate.email && !/@(?:gmail|hotmail|outlook|live|icloud|yahoo)\./i.test(candidate.email)) score -= 25;
  return score;
}
