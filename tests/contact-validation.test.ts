import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearContactValidationCache, validatePublicContacts } from "@/lib/leads/contact-validation";
import type { Candidate } from "@/lib/leads/eligibility";

const candidate: Candidate = {
  externalPlaceId: "osm-1", companyName: "Voorbeeldbedrijf", email: "info@voorbeeld.nl", phoneNumber: "020 123 45 67",
  businessStatus: "OPERATIONAL", country: "NL", category: "bedrijf", city: "Amsterdam", streetAddress: "Damrak 1",
  latitude: 52.37, longitude: 4.89, googleMapsUrl: "https://maps.google.com/?q=voorbeeld",
};

describe("publieke contactvalidatie", () => {
  beforeEach(() => clearContactValidationCache());

  it("accepteert alleen gepubliceerd e-mailadres met MX en een normaliseerbaar telefoonnummer", async () => {
    const mxLookup = vi.fn(async () => [{ exchange: "mail.voorbeeld.nl", priority: 10 }]);
    await expect(validatePublicContacts(candidate, { mxLookup })).resolves.toMatchObject({
      ok: true, email: "info@voorbeeld.nl", emailStatus: "DELIVERABLE", phone: "+31201234567", phoneStatus: "VALID",
      emailSource: candidate.googleMapsUrl, phoneSource: candidate.googleMapsUrl,
    });
  });

  it("weigert een ontbrekend zakelijk e-mailadres", async () => {
    await expect(validatePublicContacts({ ...candidate, email: undefined })).resolves.toEqual({ ok: false, reason: "missing_email" });
  });

  it("weigert een domein zonder mailserver", async () => {
    await expect(validatePublicContacts(candidate, { mxLookup: vi.fn(async () => []) })).resolves.toEqual({ ok: false, reason: "email_domain_unreachable" });
  });

  it("zet een tijdelijke DNS-storing apart voor hercontrole en cachet die niet als afwijzing", async () => {
    const mxLookup = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("resolver timeout"), { code: "ETIMEOUT" }))
      .mockResolvedValueOnce([{ exchange: "mail.voorbeeld.nl", priority: 10 }]);
    await expect(validatePublicContacts(candidate, { mxLookup })).resolves.toEqual({ ok: false, reason: "email_validation_unavailable" });
    await expect(validatePublicContacts(candidate, { mxLookup })).resolves.toMatchObject({ ok: true, email: candidate.email });
    expect(mxLookup).toHaveBeenCalledTimes(2);
  });

  it("weigert een ongeldig telefoonnummer", async () => {
    await expect(validatePublicContacts({ ...candidate, phoneNumber: "geen nummer" }, { mxLookup: vi.fn(async () => [{ exchange: "mx", priority: 1 }]) }))
      .resolves.toEqual({ ok: false, reason: "missing_phone" });
  });
});
