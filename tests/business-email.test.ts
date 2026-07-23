import { describe, expect, it, vi } from "vitest";

import type { Candidate } from "@/lib/leads/eligibility";
import { candidateBusinessEmails, validatePublicBusinessEmail } from "@/lib/leads/business-email";

const base: Candidate = {
  externalPlaceId: "osm:node/42",
  source: "OPENSTREETMAP",
  sourceUrl: "https://www.openstreetmap.org/node/42",
  companyName: "De Lokale Bakker",
  phoneNumber: "+31 20 123 45 67",
  email: "INFO@DELOKALEBAKKER.NL",
  emailSource: "OPENSTREETMAP",
  emailSourceUrl: "https://www.openstreetmap.org/node/42",
  emailPubliclyListed: true,
  businessStatus: "OPERATIONAL",
  country: "NL",
  category: "bakker",
  city: "Amsterdam",
  streetAddress: "Damrak 1",
  latitude: 52.37,
  longitude: 4.89,
  googleMapsUrl: "https://www.openstreetmap.org/node/42",
};

const mxResolver = vi.fn(async () => [{ exchange: "mail.delokalebakker.nl", priority: 10 }]);

describe("openbaar zakelijk e-mailadres", () => {
  it("accepteert een openbaar adres pas na succesvolle MX-validatie en bewaart de herkomst", async () => {
    const result = await validatePublicBusinessEmail(base, { resolver: mxResolver });
    expect(result).toMatchObject({
      status: "VALID",
      email: "info@delokalebakker.nl",
      source: "OPENSTREETMAP",
      sourceUrl: "https://www.openstreetmap.org/node/42",
      mxVerified: true,
    });
  });

  it("stuurt een kandidaat zonder e-mailadres naar verrijking en genereert geen vermoedelijk adres", async () => {
    mxResolver.mockClear();
    const candidate = { ...base, email: undefined, emailAddresses: undefined };
    expect(candidateBusinessEmails(candidate)).toEqual([]);
    await expect(validatePublicBusinessEmail(candidate, { resolver: mxResolver }))
      .resolves.toMatchObject({ status: "MISSING", retryable: true });
    expect(mxResolver).not.toHaveBeenCalled();
  });

  it.each([
    "geen-adres",
    "info@",
    "@bedrijf.nl",
    "info@bedrijf",
  ])("wijst technisch ongeldig adres %s af", async (email) => {
    await expect(validatePublicBusinessEmail({ ...base, email }, { resolver: mxResolver }))
      .resolves.toMatchObject({ status: "INVALID", reason: "INVALID_EMAIL", retryable: false });
  });

  it.each([
    "info@mailinator.com",
    "info@example.com",
    "info@bedrijf.invalid",
  ])("wijst wegwerp-, voorbeeld- of gereserveerd adres %s af", async (email) => {
    await expect(validatePublicBusinessEmail({ ...base, email }, { resolver: mxResolver }))
      .resolves.toMatchObject({ status: "INVALID", reason: "DISPOSABLE_EMAIL", retryable: false });
  });

  it("wijst een domein zonder MX-record af", async () => {
    const error = Object.assign(new Error("no mx"), { code: "ENODATA" });
    await expect(validatePublicBusinessEmail(base, { resolver: vi.fn(async () => { throw error; }) }))
      .resolves.toMatchObject({ status: "INVALID", reason: "EMAIL_MX_MISSING", retryable: false });
  });

  it("behoudt tijdelijke DNS-storingen voor een latere retry", async () => {
    const error = Object.assign(new Error("timeout"), { code: "ETIMEOUT" });
    await expect(validatePublicBusinessEmail(base, { resolver: vi.fn(async () => { throw error; }) }))
      .resolves.toMatchObject({ status: "RETRY", reason: "EMAIL_MX_CHECK_FAILED", retryable: true });
  });

  it("accepteert geen adres zonder aantoonbare openbare bron", async () => {
    const candidate = {
      ...base,
      source: "GOOGLE_PLACES" as const,
      googleMapsUrl: "https://www.google.com/maps/place/42",
      emailSource: undefined,
      emailSourceUrl: undefined,
      sourceUrl: undefined,
      emailPubliclyListed: false,
    };
    await expect(validatePublicBusinessEmail(candidate, { resolver: mxResolver }))
      .resolves.toMatchObject({ status: "RETRY", retryable: true });
  });
});
