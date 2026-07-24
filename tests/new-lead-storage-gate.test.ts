import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Candidate } from "@/lib/leads/eligibility";
import type { WebsiteVerificationResult } from "@/lib/leads/website-verification";

vi.mock("server-only", () => ({}));
const { leadCreate, leadFindUnique, sourceUpdate, fingerprintCreateMany, fingerprintFindFirst, validationUpdate, combinationUpdate, prismaTransaction } = vi.hoisted(() => ({
  leadCreate: vi.fn(), leadFindUnique: vi.fn(), sourceUpdate: vi.fn(), fingerprintCreateMany: vi.fn(), fingerprintFindFirst: vi.fn(), validationUpdate: vi.fn(), combinationUpdate: vi.fn(), prismaTransaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  lead: { create: leadCreate },
  $transaction: prismaTransaction,
} }));

import { storeNewLead } from "@/lib/jobs/generation";

const base: Candidate = {
  externalPlaceId: "source-1", companyName: "Nieuw bedrijf", phoneNumber: "0201234567",
  email: "info@nieuwbedrijf.nl", emailSource: "OPENSTREETMAP",
  emailSourceUrl: "https://www.openstreetmap.org/node/123", emailPubliclyListed: true,
  emailMxVerified: true, emailVerifiedAt: "2026-07-23T12:00:00.000Z", businessStatus: "OPERATIONAL",
  country: "NL", category: "winkel", city: "Amsterdam", postalCode: "1011AA", streetAddress: "Damrak 1",
  formattedAddress: "Damrak 1, 1011 AA Amsterdam, Nederland", language: "nl", languageConfidence: 95,
  source: "GOOGLE_PLACES", googlePlaceId: "ChIJ-source-1", googleBusinessProfileVerified: true,
  googleBusinessProfileUrl: "https://www.google.com/maps/place/Nieuw-bedrijf",
  latitude: 52.37, longitude: 4.89, googleMapsUrl: "https://www.google.com/maps/place/Nieuw-bedrijf",
  singleLocationStatus: "CONFIRMED", singleLocationReason: "enkele_vestiging_bevestigd",
};
const confirmed: WebsiteVerificationResult = { status: "NO_WEBSITE_CONFIRMED", confidence: 95, website: null, reason: "Bevestigd", evidence: [] };
const unknown: WebsiteVerificationResult = { status: "UNKNOWN", confidence: 40, website: null, reason: "Timeout", evidence: [] };

describe("laatste databasebarrière voor nieuwe leads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    leadCreate.mockResolvedValue({ id: "lead-new" });
    leadFindUnique.mockResolvedValue({
      id: "lead-new",
      pipelineStageId: "pipeline-nieuw",
      isActive: true,
      phoneNumber: "+31201234567",
      email: "info@nieuwbedrijf.nl",
    });
    prismaTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      lead: { create: leadCreate, findUnique: leadFindUnique }, sourceRecord: { upsert: sourceUpdate }, duplicateFingerprint: { createMany: fingerprintCreateMany, findFirst: fingerprintFindFirst }, validationCandidate: { updateMany: validationUpdate }, searchCombination: { updateMany: combinationUpdate },
    }));
  });

  it.each([
    [{ ...base, businessStatus: "CLOSED_PERMANENTLY" }, confirmed, "BUSINESS_CLOSED"],
    [{ ...base, rawData: { officialWebsite: "bruna.nl" } }, confirmed, "SKIPPED_HAS_WEBSITE"],
    [base, unknown, "WEBSITE_NOT_CONFIRMED_ABSENT"],
  ] as const)("maakt geen Lead-record voor %s", async (candidate, verification, reason) => {
    await expect(storeNewLead(candidate, verification)).resolves.toMatchObject({ stored: false, reason });
    expect(leadCreate).not.toHaveBeenCalled();
  });

  it("slaat een geldige lead atomair op in pipelinefase Nieuw", async () => {
    await expect(storeNewLead(base, confirmed)).resolves.toMatchObject({ stored: true, leadId: "lead-new" });
    expect(prismaTransaction).toHaveBeenCalledOnce();
    expect(leadCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      pipelineStageId: "pipeline-nieuw", isActive: true, isFiltered: false, websiteStatus: "NO_WEBSITE_CONFIRMED",
      googleBusinessProfileVerified: true, language: "nl", businessStatus: "OPERATIONAL",
      email: "info@nieuwbedrijf.nl", emailSource: "OPENSTREETMAP", emailMxVerified: true,
    }) }));
    expect(validationUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PROMOTED_TO_LEAD", promotedLeadId: "lead-new" }) }));
    expect(sourceUpdate).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ leadId: "lead-new", decision: "stored" }) }));
    expect(leadFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "lead-new" },
      select: expect.objectContaining({ pipelineStageId: true, phoneNumber: true, email: true }),
    }));
  });

  it("weigert ook vlak voor opslag een kandidaat zonder geldig telefoonnummer", async () => {
    await expect(storeNewLead({ ...base, phoneNumber: undefined }, confirmed)).resolves.toMatchObject({ stored: false, reason: "PHONE_REQUIRED" });
    expect(leadCreate).not.toHaveBeenCalled();
  });

  it("weigert vlak voor opslag een kandidaat zonder geverifieerd openbaar e-mailadres", async () => {
    await expect(storeNewLead({ ...base, email: undefined, emailMxVerified: false }, confirmed))
      .resolves.toMatchObject({ stored: false, reason: "BUSINESS_EMAIL_NOT_VERIFIED" });
    expect(leadCreate).not.toHaveBeenCalled();
  });

  it("weigert vlak voor opslag een kandidaat zonder bevestigde enkele vestiging", async () => {
    await expect(storeNewLead({ ...base, singleLocationStatus: "UNCERTAIN", singleLocationReason: "onzeker_aantal_vestigingen" }, confirmed))
      .resolves.toMatchObject({ stored: false, reviewOnly: true, reason: "onzeker_aantal_vestigingen" });
    expect(leadCreate).not.toHaveBeenCalled();
  });

  it("slaat een geldig Belgisch bedrijf zonder website eveneens in Nieuw op", async () => {
    const belgian = { ...base, externalPlaceId: "source-be-1", googlePlaceId: "ChIJ-source-be-1", phoneNumber: "+32 3 123 45 67", country: "BE", province: "Antwerpen", city: "Antwerpen", postalCode: "2000", streetAddress: "Meir 1", formattedAddress: "Meir 1, 2000 Antwerpen, België", latitude: 51.2194, longitude: 4.4025 };
    await expect(storeNewLead(belgian, confirmed)).resolves.toMatchObject({ stored: true, leadId: "lead-new" });
    expect(leadCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ country: "BE", pipelineStageId: "pipeline-nieuw" }) }));
  });

  it.each([
    [{ ...base, city: "Brussel", postalCode: "1000", streetAddress: "Anspachlaan 1", formattedAddress: "Anspachlaan 1, 1000 Brussel" }, "BLOCKED_BRUSSELS"],
    [{ ...base, city: "Gent", postalCode: "9000", streetAddress: "Korenmarkt 1", formattedAddress: "Korenmarkt 1, 9000 Gent" }, "BLOCKED_GHENT"],
  ] as const)("blokkeert %s opnieuw in de laatste databasebarrière", async (candidate, reason) => {
    await expect(storeNewLead(candidate, confirmed)).resolves.toMatchObject({ stored: false, reason });
    expect(leadCreate).not.toHaveBeenCalled();
  });

  it("promoveert de retrykandidaat niet wanneer de leadtransactie faalt", async () => {
    leadCreate.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(storeNewLead(base, confirmed)).rejects.toThrow("database unavailable");
    expect(validationUpdate).not.toHaveBeenCalled();
  });

  it("rolt terug wanneer de database-readback niet bevestigt dat de lead in Nieuw staat", async () => {
    leadFindUnique.mockResolvedValueOnce({
      id: "lead-new",
      pipelineStageId: "pipeline-belletje-1",
      isActive: true,
      phoneNumber: "+31201234567",
      email: "info@nieuwbedrijf.nl",
    });
    await expect(storeNewLead(base, confirmed)).rejects.toThrow("LEAD_DATABASE_READBACK_FAILED");
  });

  it("draait de promotie in een serialiseerbare transactie met een expliciete timeout", async () => {
    await storeNewLead(base, confirmed);
    expect(prismaTransaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      maxWait: 5_000, timeout: 20_000, isolationLevel: "Serializable",
    }));
  });
});
