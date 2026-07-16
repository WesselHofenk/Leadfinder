import { describe, expect, it } from "vitest";

import type { Candidate } from "@/lib/leads/eligibility";
import { validateStrictLead } from "@/lib/leads/strict-validation";
import type { WebsiteVerificationResult } from "@/lib/leads/website-verification";

const noWebsite: WebsiteVerificationResult = {
  status: "NO_WEBSITE_CONFIRMED",
  confidence: 95,
  website: null,
  reason: "Geen eigen website gevonden",
  evidence: [],
};

const base: Candidate = {
  externalPlaceId: "ChIJ-example",
  source: "GOOGLE_PLACES",
  googlePlaceId: "ChIJ-example",
  googleBusinessProfileUrl: "https://www.google.com/maps/place/Voorbeeldbedrijf",
  googleBusinessProfileVerified: true,
  companyName: "De Lokale Schilder",
  description: "Schilderbedrijf voor onderhoud en renovatie",
  language: "nl",
  languageConfidence: 95,
  businessStatus: "OPERATIONAL",
  country: "NL",
  category: "schilder",
  city: "Utrecht",
  postalCode: "3511 AA",
  streetAddress: "Oudegracht 10",
  formattedAddress: "Oudegracht 10, 3511 AA Utrecht, Nederland",
  latitude: 52.09,
  longitude: 5.12,
  googleMapsUrl: "https://www.google.com/maps/place/Voorbeeldbedrijf",
};

describe("centrale strikte leadvalidatie", () => {
  it("accepteert een actieve Nederlandstalige Google-vermelding zonder website", () => {
    expect(validateStrictLead(base, noWebsite)).toMatchObject({ valid: true, reasons: [] });
  });

  it("wijst een eigen website af", () => {
    const result = validateStrictLead(base, { ...noWebsite, status: "WEBSITE_FOUND", website: "https://voorbeeld.nl" });
    expect(result.reasons).toContain("OWN_WEBSITE_FOUND");
  });

  it.each(["CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"])("wijst status %s af", (businessStatus) => {
    expect(validateStrictLead({ ...base, businessStatus }, noWebsite).reasons).toContain("BUSINESS_CLOSED");
  });

  it("wijst een Franstalig Waals bedrijf af", () => {
    const result = validateStrictLead({ ...base, country: "BE", province: "Luik", city: "Liège", language: "fr", languageConfidence: 95, description: "Entreprise de peinture pour votre maison" }, noWebsite);
    expect(result.reasons).toEqual(expect.arrayContaining(["REGION_NOT_ALLOWED", "LANGUAGE_NOT_DUTCH"]));
  });

  it("wijst een bedrijf zonder bevestigd Google Bedrijfsprofiel af", () => {
    expect(validateStrictLead({ ...base, source: "OPENSTREETMAP", googlePlaceId: undefined, googleBusinessProfileUrl: undefined, googleBusinessProfileVerified: false }, noWebsite).reasons).toContain("NO_GOOGLE_BUSINESS_PROFILE");
  });

  it("accepteert een losse Google-link niet als bevestiging van een actuele Google-status", () => {
    const candidate = { ...base, source: "OPENSTREETMAP" as const, externalPlaceId: "osm:node/12" };
    expect(validateStrictLead(candidate, noWebsite).reasons).toContain("BUSINESS_NOT_CONFIRMED_ACTIVE");
  });

  it("telt Facebook niet als eigen website", () => {
    const candidate = { ...base, websiteFields: ["https://facebook.com/delokaleschilder"], socialUrls: ["https://facebook.com/delokaleschilder"] };
    expect(validateStrictLead(candidate, noWebsite)).toMatchObject({ valid: true });
  });

  it("wijst een onbekende bedrijfsstatus af", () => {
    expect(validateStrictLead({ ...base, businessStatus: "UNKNOWN", activitySignals: [] }, noWebsite).reasons).toContain("BUSINESS_NOT_CONFIRMED_ACTIVE");
  });

  it("accepteert een actief Nederlandstalig Vlaams bedrijf", () => {
    const candidate = { ...base, country: "BE", province: "Oost-Vlaanderen", city: "Gent", postalCode: "9000", streetAddress: "Korenmarkt 1", formattedAddress: "Korenmarkt 1, 9000 Gent, België", latitude: 51.05, longitude: 3.72 };
    expect(validateStrictLead(candidate, noWebsite)).toMatchObject({ valid: true });
  });

  it("laat Brussel alleen toe met sterk expliciet Nederlands bewijs", () => {
    const brussels = { ...base, country: "BE", province: "Brussel", city: "Brussel", postalCode: "1000", streetAddress: "Anspachlaan 1", formattedAddress: "Anspachlaan 1, 1000 Brussel, België", latitude: 50.85, longitude: 4.35 };
    expect(validateStrictLead({ ...brussels, language: "fr", languageConfidence: 95, description: "Entreprise de peinture" }, noWebsite).valid).toBe(false);
    expect(validateStrictLead(brussels, noWebsite).valid).toBe(true);
  });
});
