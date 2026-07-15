import { describe, expect, it } from "vitest";
import type { Candidate } from "@/lib/leads/eligibility";
import { selectGoogleBusinessMatch, verifyGoogleNoWebsiteCandidate } from "@/lib/leads/google-verification";

const pearle: Candidate = {
  externalPlaceId: "ChIJPearleWestwijk",
  source: "GOOGLE_PLACES",
  companyName: "Pearle Opticiens Amstelveen Westwijk",
  phoneNumber: "020 236 2180",
  website: "https://www.pearle.nl/winkels/amstelveen-westwijk",
  businessStatus: "OPERATIONAL",
  country: "NL",
  category: "optician",
  city: "Amstelveen",
  postalCode: "1187 LV",
  streetAddress: "Westwijkplein 94, 1187 LV Amstelveen",
  latitude: 52.274,
  longitude: 4.827,
  googleMapsUrl: "https://maps.google.com/?cid=pearle",
};

describe("Google als leidende websitebron", () => {
  it("sluit Pearle uit wanneer Google pearle.nl teruggeeft", () => {
    expect(verifyGoogleNoWebsiteCandidate(pearle)).toMatchObject({
      accepted: false,
      decision: { status: "has_website", normalizedUrl: "https://pearle.nl/winkels/amstelveen-westwijk" },
    });
  });

  it("accepteert alleen een rechtstreeks Google-resultaat zonder eigen website", () => {
    expect(verifyGoogleNoWebsiteCandidate({ ...pearle, externalPlaceId: "place-zonder-site", companyName: "Lokale Schilder", website: undefined })).toMatchObject({ accepted: true, decision: { status: "no_website" } });
    expect(verifyGoogleNoWebsiteCandidate({ ...pearle, source: "OPENSTREETMAP", externalPlaceId: "osm:node/1", website: undefined })).toMatchObject({ accepted: false });
  });

  it("telt alleen een extern Google-profiel niet als eigen bedrijfswebsite", () => {
    expect(verifyGoogleNoWebsiteCandidate({ ...pearle, website: "https://facebook.com/lokaleschilder" })).toMatchObject({ accepted: true, decision: { status: "no_website" } });
  });

  it("koppelt een legacy lead alleen aan een eenduidige Google-match", () => {
    const original = { ...pearle, source: "OPENSTREETMAP" as const, externalPlaceId: "osm:node/1", website: undefined };
    const exact = { ...pearle, website: undefined };
    const other = { ...pearle, externalPlaceId: "other", companyName: "Andere Opticien", phoneNumber: "020 999 9999", postalCode: "1188 AA", latitude: 52.31 };
    expect(selectGoogleBusinessMatch(original, [other, exact])?.externalPlaceId).toBe(exact.externalPlaceId);
    expect(selectGoogleBusinessMatch(original, [exact, { ...exact, externalPlaceId: "duplicate" }])).toBeNull();
  });
});
