import { describe, expect, it } from "vitest";
import { candidateQualityScore } from "@/lib/leads/candidate-score";
import type { Candidate } from "@/lib/leads/eligibility";

const candidate: Candidate = {
  externalPlaceId: "osm:node/1",
  companyName: "Jansen Schilderwerken",
  phoneNumber: "+31 6 12345678",
  businessStatus: "OPERATIONAL",
  country: "NL",
  category: "schilder",
  city: "Zwolle",
  postalCode: "8011 AB",
  streetAddress: "Stationsweg 1",
  latitude: 52.51,
  longitude: 6.09,
  googleMapsUrl: "https://www.openstreetmap.org/node/1",
  source: "OPENSTREETMAP",
  sourceUpdatedAt: "2026-07-01T00:00:00.000Z",
  sourceWebsiteFieldsChecked: true,
};

describe("kandidaatprioritering", () => {
  it("geeft complete lokale kandidaten voorrang", () => {
    expect(candidateQualityScore(candidate)).toBeGreaterThan(candidateQualityScore({ ...candidate, phoneNumber: undefined, postalCode: undefined, businessStatus: "UNKNOWN" }));
  });

  it("laat een score nooit een zichtbare website verhullen", () => {
    expect(candidateQualityScore({ ...candidate, website: "https://jansen.nl" })).toBeLessThan(0);
  });
});
