
import { isPermanentlyClosed } from "./company-status";
import { extractCompanyWebsite } from "./website";
import type { WebsiteVerificationResult } from "./website-verification";

export type IntakeWebsiteStatus = "QUALIFIED_WEBSITE" | "HAS_WEBSITE" | "NO_WEBSITE_CONFIRMED" | "UNKNOWN";
export type IntakeSkipReason = "SKIPPED_PERMANENTLY_CLOSED" | "SKIPPED_HAS_WEBSITE" | "SKIPPED_WEBSITE_UNKNOWN";

export type IntakeWebsiteDecision = {
  status: IntakeWebsiteStatus;
  website: string | null;
  reason: string;
};

export function determineIntakeWebsiteStatus(company: unknown, verification?: Pick<WebsiteVerificationResult, "status" | "website" | "reason">): IntakeWebsiteDecision {
  const sourceWebsite = extractCompanyWebsite(company);
  if (!verification) return { status: "UNKNOWN", website: null, reason: "Website-afwezigheid is niet bevestigd." };
  if (["WEBSITE_OUTDATED", "WEBSITE_BROKEN", "IMPROVABLE_WEBSITE"].includes(verification.status)) {
    return { status: "QUALIFIED_WEBSITE", website: verification.website ?? sourceWebsite, reason: verification.reason };
  }
  if (verification.status === "WEBSITE_FOUND") {
    return { status: "HAS_WEBSITE", website: verification.website, reason: verification.reason };
  }
  if (verification.status === "NO_WEBSITE_CONFIRMED") {
    if (sourceWebsite) {
      return {
        status: "UNKNOWN",
        website: sourceWebsite,
        reason: "De bron bevat een website, maar de websitecontrole meldt tegenstrijdig dat er geen website is.",
      };
    }
    return { status: "NO_WEBSITE_CONFIRMED", website: null, reason: verification.reason };
  }
  return { status: "UNKNOWN", website: null, reason: verification.reason };
}

export type NewLeadGateDecision =
  | { allowed: true; websiteStatus: "NO_WEBSITE_CONFIRMED" | "QUALIFIED_WEBSITE"; reason: string }
  | { allowed: false; websiteStatus: IntakeWebsiteStatus; reason: IntakeSkipReason; detail: string; website: string | null };

/** Final fail-closed gate. Call this immediately before every new Lead insert. */
export function evaluateNewLeadGate(company: unknown, verification?: Pick<WebsiteVerificationResult, "status" | "website" | "reason">): NewLeadGateDecision {
  if (isPermanentlyClosed(company)) {
    return { allowed: false, websiteStatus: "UNKNOWN", reason: "SKIPPED_PERMANENTLY_CLOSED", detail: "De bron markeert dit bedrijf als permanent gesloten.", website: null };
  }
  const website = determineIntakeWebsiteStatus(company, verification);
  if (website.status === "HAS_WEBSITE") {
    return { allowed: false, websiteStatus: website.status, reason: "SKIPPED_HAS_WEBSITE", detail: website.reason, website: website.website };
  }
  if (website.status === "UNKNOWN") {
    return { allowed: false, websiteStatus: website.status, reason: "SKIPPED_WEBSITE_UNKNOWN", detail: website.reason, website: null };
  }
  return { allowed: true, websiteStatus: website.status, reason: website.reason };
}
