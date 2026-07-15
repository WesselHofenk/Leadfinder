import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Candidate } from "@/lib/leads/eligibility";
import type { WebsiteVerificationResult } from "@/lib/leads/website-verification";

vi.mock("server-only", () => ({}));
const { leadCreate } = vi.hoisted(() => ({ leadCreate: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { lead: { create: leadCreate } } }));

import { storeNewLead } from "@/lib/jobs/generation";

const base: Candidate = {
  externalPlaceId: "source-1", companyName: "Nieuw bedrijf", phoneNumber: "0201234567", businessStatus: "OPERATIONAL",
  country: "NL", category: "winkel", city: "Amsterdam", postalCode: "1011AA", streetAddress: "Damrak 1",
  latitude: 52.37, longitude: 4.89, googleMapsUrl: "https://maps.google.com/?q=1",
};
const confirmed: WebsiteVerificationResult = { status: "NO_WEBSITE_CONFIRMED", confidence: 95, website: null, reason: "Bevestigd", evidence: [] };
const unknown: WebsiteVerificationResult = { status: "UNKNOWN", confidence: 40, website: null, reason: "Timeout", evidence: [] };

describe("laatste databasebarrière voor nieuwe leads", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [{ ...base, businessStatus: "CLOSED_PERMANENTLY" }, confirmed, "SKIPPED_PERMANENTLY_CLOSED"],
    [{ ...base, rawData: { officialWebsite: "bruna.nl" } }, confirmed, "SKIPPED_HAS_WEBSITE"],
    [base, unknown, "SKIPPED_WEBSITE_UNKNOWN"],
  ] as const)("maakt geen Lead-record voor %s", async (candidate, verification, reason) => {
    await expect(storeNewLead(candidate, verification)).resolves.toMatchObject({ stored: false, reason });
    expect(leadCreate).not.toHaveBeenCalled();
  });
});
