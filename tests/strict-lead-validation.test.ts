import { describe, expect, it } from "vitest";

import type { Candidate } from "@/lib/leads/eligibility";
import { validateStrictLead, validateStrictLeadBeforeLocation } from "@/lib/leads/strict-validation";
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
  phoneNumber: "+31 30 123 45 67",
  email: "info@delokaleschilder.nl",
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
  singleLocationStatus: "CONFIRMED",
  singleLocationReason: "enkele_vestiging_bevestigd",
};

describe("centrale strikte leadvalidatie", () => {
  it("accepteert een actieve Nederlandstalige Google-vermelding zonder website", () => {
    expect(validateStrictLead(base, noWebsite)).toMatchObject({ valid: true, reasons: [] });
  });

  it("wijst een eigen website af", () => {
    const result = validateStrictLead(base, { ...noWebsite, status: "WEBSITE_FOUND", website: "https://voorbeeld.nl" });
    expect(result.reasons).toContain("OWN_WEBSITE_FOUND");
  });

  it("wijst een kandidaat zonder zakelijk e-mailadres af", () => {
    expect(validateStrictLead({ ...base, email: undefined }, noWebsite).reasons).toContain("EMAIL_REQUIRED");
  });

  it.each(["CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"])("wijst status %s af", (businessStatus) => {
    expect(validateStrictLead({ ...base, businessStatus }, noWebsite).reasons).toContain("BUSINESS_CLOSED");
  });

  it("wijst een Franstalig Waals bedrijf af", () => {
    const result = validateStrictLead({ ...base, country: "BE", province: "Luik", city: "Liège", language: "fr", languageConfidence: 95, description: "Entreprise de peinture pour votre maison" }, noWebsite);
    expect(result.reasons).toEqual(expect.arrayContaining(["REGION_NOT_ALLOWED", "LANGUAGE_NOT_DUTCH"]));
  });

  it("wijst een bedrijf zonder aantoonbare openbare bedrijfsvermelding af", () => {
    expect(validateStrictLead({ ...base, source: "OPENSTREETMAP", externalPlaceId: "onbekend", googlePlaceId: undefined, googleBusinessProfileUrl: undefined, googleBusinessProfileVerified: false, googleMapsUrl: "", sourceUrl: undefined }, noWebsite).reasons).toContain("NO_PUBLIC_BUSINESS_PROFILE");
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

  it("wijst een niet bevestigde enkele vestiging af", () => {
    expect(validateStrictLead({ ...base, singleLocationStatus: "UNCERTAIN" }, noWebsite).reasons).toContain("SINGLE_LOCATION_NOT_CONFIRMED");
  });

  it("behoudt alle harde criteria in de voorlopige gate behalve de nog uit te voeren vestigingslookup", () => {
    const candidate = { ...base, singleLocationStatus: undefined };
    expect(validateStrictLeadBeforeLocation(candidate).reasons).not.toContain("SINGLE_LOCATION_NOT_CONFIRMED");
    expect(validateStrictLead(candidate).reasons).toContain("SINGLE_LOCATION_NOT_CONFIRMED");
    expect(validateStrictLeadBeforeLocation({ ...candidate, phoneNumber: undefined }).reasons).toContain("PHONE_REQUIRED");
  });

  it("accepteert een actief Nederlandstalig Vlaams bedrijf", () => {
    const candidate = { ...base, phoneNumber: "+32 3 123 45 67", country: "BE", province: "Antwerpen", city: "Antwerpen", postalCode: "2000", streetAddress: "Meir 1", formattedAddress: "Meir 1, 2000 Antwerpen, België", latitude: 51.2194, longitude: 4.4025 };
    expect(validateStrictLead(candidate, noWebsite)).toMatchObject({ valid: true });
  });

  it("blokkeert Brussel altijd, ook met sterk expliciet Nederlands bewijs", () => {
    const brussels = { ...base, country: "BE", province: "Brussel", city: "Brussel", postalCode: "1000", streetAddress: "Anspachlaan 1", formattedAddress: "Anspachlaan 1, 1000 Brussel, België", latitude: 50.85, longitude: 4.35 };
    expect(validateStrictLead({ ...brussels, language: "fr", languageConfidence: 95, description: "Entreprise de peinture" }, noWebsite).valid).toBe(false);
    expect(validateStrictLead(brussels, noWebsite).reasons).toContain("BLOCKED_BRUSSELS");
  });

  it("blokkeert Gent en deelgemeenten altijd", () => {
    const gent = { ...base, country: "BE", province: "Oost-Vlaanderen", city: "Gentbrugge", postalCode: "9050", streetAddress: "Brusselsesteenweg 1", formattedAddress: "Brusselsesteenweg 1, 9050 Gentbrugge, België" };
    expect(validateStrictLead(gent, noWebsite).reasons).toContain("BLOCKED_GHENT");
  });
});
