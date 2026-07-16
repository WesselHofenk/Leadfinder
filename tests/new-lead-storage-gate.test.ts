import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Candidate } from "@/lib/leads/eligibility";
import type { WebsiteVerificationResult } from "@/lib/leads/website-verification";

vi.mock("server-only", () => ({}));
const { leadCreate, sourceUpdate, fingerprintUpsert, validationUpdate, prismaTransaction } = vi.hoisted(() => ({
  leadCreate: vi.fn(), sourceUpdate: vi.fn(), fingerprintUpsert: vi.fn(), validationUpdate: vi.fn(), prismaTransaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  lead: { create: leadCreate },
  $transaction: prismaTransaction,
} }));

import { storeNewLead } from "@/lib/jobs/generation";

const base: Candidate = {
  externalPlaceId: "source-1", companyName: "Nieuw bedrijf", phoneNumber: "0201234567", businessStatus: "OPERATIONAL",
  country: "NL", category: "winkel", city: "Amsterdam", postalCode: "1011AA", streetAddress: "Damrak 1",
  latitude: 52.37, longitude: 4.89, googleMapsUrl: "https://maps.google.com/?q=1",
};
const confirmed: WebsiteVerificationResult = { status: "NO_WEBSITE_CONFIRMED", confidence: 95, website: null, reason: "Bevestigd", evidence: [] };
const unknown: WebsiteVerificationResult = { status: "UNKNOWN", confidence: 40, website: null, reason: "Timeout", evidence: [] };

describe("laatste databasebarrière voor nieuwe leads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    leadCreate.mockResolvedValue({ id: "lead-new" });
    prismaTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      lead: { create: leadCreate }, sourceRecord: { upsert: sourceUpdate }, duplicateFingerprint: { upsert: fingerprintUpsert }, validationCandidate: { updateMany: validationUpdate },
    }));
  });

  it.each([
    [{ ...base, businessStatus: "CLOSED_PERMANENTLY" }, confirmed, "SKIPPED_PERMANENTLY_CLOSED"],
    [{ ...base, rawData: { officialWebsite: "bruna.nl" } }, confirmed, "SKIPPED_HAS_WEBSITE"],
    [base, unknown, "SKIPPED_WEBSITE_UNKNOWN"],
  ] as const)("maakt geen Lead-record voor %s", async (candidate, verification, reason) => {
    await expect(storeNewLead(candidate, verification)).resolves.toMatchObject({ stored: false, reason });
    expect(leadCreate).not.toHaveBeenCalled();
  });

  it("slaat een geldige lead atomair op in pipelinefase Nieuw", async () => {
    await expect(storeNewLead(base, confirmed)).resolves.toMatchObject({ stored: true, leadId: "lead-new" });
    expect(prismaTransaction).toHaveBeenCalledOnce();
    expect(leadCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: "NEW", isActive: true, isFiltered: false, websiteStatus: "NO_WEBSITE_CONFIRMED",
    }) }));
    expect(validationUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PROMOTED_TO_LEAD", promotedLeadId: "lead-new" }) }));
    expect(sourceUpdate).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ leadId: "lead-new", decision: "stored" }) }));
  });

  it("slaat ook zonder telefoon op en gebruikt dan een nullable unieke waarde", async () => {
    await expect(storeNewLead({ ...base, phoneNumber: undefined }, confirmed)).resolves.toMatchObject({ stored: true });
    expect(leadCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ phoneNumber: "", normalizedPhoneNumber: null }) }));
  });

  it("slaat een geldig Belgisch bedrijf zonder website eveneens in Nieuw op", async () => {
    const belgian = { ...base, externalPlaceId: "source-be-1", country: "BE", city: "Gent", postalCode: "9000", streetAddress: "Korenmarkt 1", latitude: 51.0543, longitude: 3.7174 };
    await expect(storeNewLead(belgian, confirmed)).resolves.toMatchObject({ stored: true, leadId: "lead-new" });
    expect(leadCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ country: "BE", status: "NEW" }) }));
  });

  it("promoveert de retrykandidaat niet wanneer de leadtransactie faalt", async () => {
    leadCreate.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(storeNewLead(base, confirmed)).rejects.toThrow("database unavailable");
    expect(validationUpdate).not.toHaveBeenCalled();
  });
});
