import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { legacyLeadEmailCandidate, legacyLeadEmailUpdate } from "@/lib/email/legacy-reverification";

const lead = {
  id: "lead-1",
  externalPlaceId: "osm:node/42",
  companyName: "De Lokale Bakker",
  phoneNumber: "+31 20 123 45 67",
  internationalPhoneNumber: "+31 20 123 45 67",
  email: "INFO@LOKALEBAKKER.NL",
  emailSource: null,
  emailSourceUrl: null,
  source: "OPENSTREETMAP" as const,
  sourceUrl: "https://www.openstreetmap.org/node/42",
  sourceFetchedAt: new Date("2026-08-20T10:00:00.000Z"),
  country: "NL",
  category: "bakker",
  city: "Amsterdam",
  streetAddress: "Damrak 1",
  latitude: { toString: () => "52.37" } as never,
  longitude: { toString: () => "4.89" } as never,
  googleMapsUrl: "https://www.openstreetmap.org/node/42",
  website: null,
  websiteUrl: null,
};

describe("veilige MX-herverificatie van historische leads", () => {
  it("behoudt de openbare OSM-herkomst in de validatiekandidaat", () => {
    expect(legacyLeadEmailCandidate(lead)).toMatchObject({
      source: "OPENSTREETMAP",
      sourceUrl: "https://www.openstreetmap.org/node/42",
      email: "INFO@LOKALEBAKKER.NL",
    });
  });

  it("maakt alleen een succesvol openbaar en MX-bevestigd adres verzendbaar", () => {
    expect(legacyLeadEmailUpdate({
      status: "VALID",
      email: "info@lokalebakker.nl",
      domain: "lokalebakker.nl",
      source: "OPENSTREETMAP",
      sourceUrl: "https://www.openstreetmap.org/node/42",
      mxVerified: true,
      checkedAt: "2026-08-22T16:00:00.000Z",
    })).toMatchObject({ emailMxVerified: true, emailValidationStatus: "DELIVERABLE" });
    expect(legacyLeadEmailUpdate({ status: "INVALID", reason: "EMAIL_MX_MISSING", retryable: false }))
      .toMatchObject({ emailMxVerified: false, emailValidationStatus: "INVALID" });
    expect(legacyLeadEmailUpdate({ status: "RETRY", email: "info@lokalebakker.nl", reason: "EMAIL_MX_CHECK_FAILED", retryable: true }))
      .toMatchObject({ emailMxVerified: false, emailValidationStatus: "PENDING" });
  });
});
