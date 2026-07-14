import { describe, expect, it } from "vitest";
import { getGoogleBusinessUrl } from "@/lib/leads/google-business-url";

describe("Google Maps-bedrijfspagina", () => {
  it("gebruikt de Google Place ID voor een Places-lead", () => {
    expect(getGoogleBusinessUrl({ source: "GOOGLE_PLACES", externalPlaceId: "ChIJ test/1" }))
      .toBe("https://www.google.com/maps/place/?q=place_id:ChIJ%20test%2F1");
  });

  it("gebruikt nooit de OSM-ID en zoekt op bedrijf plus volledig adres", () => {
    expect(getGoogleBusinessUrl({ source: "OPENSTREETMAP", externalPlaceId: "osm:node/123", companyName: "De Goede Schilder", streetAddress: "Dorpsstraat 10", postalCode: "1234 AB", city: "Utrecht", country: "NL" }))
      .toBe("https://www.google.com/maps/search/?api=1&query=De%20Goede%20Schilder%20Dorpsstraat%2010%201234%20AB%20Utrecht%20NL");
  });

  it("bouwt voor iedere lead een eigen gecodeerde zoekopdracht", () => {
    const first = getGoogleBusinessUrl({ companyName: "Café De Markt", address: "Markt 1", postalCode: "2000", city: "Antwerpen", country: "BE" });
    const second = getGoogleBusinessUrl({ companyName: "Garage Jansen & Zn.", address: "Stationsweg 2", postalCode: "3511 AA", city: "Utrecht", country: "NL" });
    expect(first).toContain("Caf%C3%A9%20De%20Markt%20Markt%201%202000%20Antwerpen%20BE");
    expect(second).toContain("Garage%20Jansen%20%26%20Zn.%20Stationsweg%202%203511%20AA%20Utrecht%20NL");
    expect(first).not.toBe(second);
  });
});
