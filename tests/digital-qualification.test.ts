import { describe, expect, it } from "vitest";

import { classifyOwnedWebsite } from "@/lib/leads/digital-qualification";
import type { WebsiteAnalysisResult } from "@/lib/website/analyze";
import type { WebsiteVerificationResult } from "@/lib/leads/website-verification";

const source: WebsiteVerificationResult = {
  status: "WEBSITE_FOUND",
  confidence: 100,
  website: "https://voorbeeld.nl",
  reason: "Website in bron",
  evidence: [],
};

function analysis(overrides: Partial<WebsiteAnalysisResult> = {}): WebsiteAnalysisResult {
  return {
    websiteUrl: "https://voorbeeld.nl",
    opportunityScore: 20,
    mobileScore: 90,
    desktopScore: 90,
    conversionQualityScore: 80,
    classification: "USABLE",
    isReachable: true,
    isMobileFriendly: true,
    hasContactForm: true,
    hasClearCta: true,
    hasBrokenLinks: false,
    brokenLinkCount: 0,
    hasViewportMeta: true,
    hasOutdatedCopyright: false,
    hasPlaceholderContent: false,
    loadTimeMs: 200,
    hasHttps: true,
    hasInvalidSsl: false,
    hasBrokenImages: false,
    brokenImageCount: 0,
    hasLegacyTechnology: false,
    hasTinyText: false,
    httpStatus: 200,
    failureKind: null,
    reasons: [],
    rawSignals: {},
    ...overrides,
  };
}

describe("digitale websitekwalificatie", () => {
  it("laat een bruikbare website niet als lead door", () => {
    expect(classifyOwnedWebsite(source, analysis()).status).toBe("WEBSITE_FOUND");
  });

  it("kwalificeert aantoonbaar verouderde en meervoudig verbeterbare websites", () => {
    const reasons = [
      { code: "NO_VIEWPORT", label: "Geen mobiele viewport", weight: 20 },
      { code: "NO_CTA", label: "Geen duidelijke actieknop", weight: 15 },
    ];
    expect(classifyOwnedWebsite(source, analysis({ classification: "OUTDATED", opportunityScore: 85, reasons })).status).toBe("WEBSITE_OUTDATED");
    expect(classifyOwnedWebsite(source, analysis({ classification: "IMPROVABLE", opportunityScore: 60, reasons })).status).toBe("IMPROVABLE_WEBSITE");
  });

  it("beschouwt één timeout nooit als bewijs van een kapotte website", () => {
    expect(classifyOwnedWebsite(source, analysis({
      isReachable: false,
      failureKind: "timeout",
      httpStatus: null,
    })).status).toBe("UNKNOWN");
  });

  it("kwalificeert een blijvende serverfout of ongeldig certificaat als kapot", () => {
    expect(classifyOwnedWebsite(source, analysis({ isReachable: false, httpStatus: 503 })).status).toBe("WEBSITE_BROKEN");
    expect(classifyOwnedWebsite(source, analysis({ isReachable: false, hasInvalidSsl: true, failureKind: "invalid_ssl" })).status).toBe("WEBSITE_BROKEN");
  });
});
