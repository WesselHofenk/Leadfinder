import { describe, expect, it } from "vitest";

import { brusselsNames, brusselsPostcodes, detectBlockedLocation, ghentNames, ghentPostcodes, isBlockedLocation, nonBlockedLeadWhere, visibleLeadWhere } from "@/lib/leads/blocked-location";

describe("centrale harde locatieblokkade", () => {
  it.each(brusselsNames)("herkent Brusselse naamvariant %s", (city) => {
    expect(detectBlockedLocation({ city })).toMatchObject({ blocked: true, area: "BRUSSELS" });
  });

  it.each(brusselsPostcodes)("herkent Brusselse postcode %s", (postalCode) => {
    expect(detectBlockedLocation({ city: "Onbekend", postalCode: `B-${postalCode}` })).toMatchObject({ blocked: true, area: "BRUSSELS" });
  });

  it.each(ghentNames)("herkent Gentse naamvariant %s", (city) => {
    expect(detectBlockedLocation({ city })).toMatchObject({ blocked: true, area: "GHENT" });
  });

  it.each(ghentPostcodes)("herkent Gentse postcode %s", (postalCode) => {
    expect(detectBlockedLocation({ city: "Onbekend", postalCode: `${postalCode} BE` })).toMatchObject({ blocked: true, area: "GHENT" });
  });

  it("normaliseert accenten, koppeltekens en bronmetadata", () => {
    expect(isBlockedLocation({ rawData: { geocoding: { region: "Région de Bruxelles-Capitale" } } })).toBe(true);
    expect(isBlockedLocation({ sourceData: { address: { suburb: "Sint-Amandsberg" } } })).toBe(true);
    expect(isBlockedLocation({ formattedAddress: "Watermael—Boitsfort, België" })).toBe(true);
  });

  it.each([
    { city: "Antwerpen", postalCode: "2000", province: "Antwerpen" },
    { city: "Rotterdam", postalCode: "3011 AA", province: "Zuid-Holland" },
    { city: "Brugge", postalCode: "8000", province: "West-Vlaanderen" },
    { city: "Aalst", postalCode: "9300", province: "Oost-Vlaanderen" },
  ])("laat geldige locatie $city ongemoeid", (location) => {
    expect(detectBlockedLocation(location)).toEqual({ blocked: false });
  });

  it("simuleert de eenmalige opschoning zonder andere plaatsen te raken", () => {
    const existing = [
      { id: "brussels", city: "Bruxelles", postalCode: "1000" },
      { id: "ghent", city: "Gentbrugge", postalCode: "9050" },
      { id: "antwerp", city: "Antwerpen", postalCode: "2000" },
      { id: "rotterdam", city: "Rotterdam", postalCode: "3011 AA" },
    ];
    const removed = existing.filter(isBlockedLocation).map(({ id }) => id);
    const retained = existing.filter((lead) => !isBlockedLocation(lead)).map(({ id }) => id);
    expect(removed).toEqual(["brussels", "ghent"]);
    expect(retained).toEqual(["antwerp", "rotterdam"]);
  });

  it("gebruikt voor leesquery's een positieve NULL-veilige blokkade", () => {
    expect(visibleLeadWhere({ isActive: true })).toEqual({ AND: [{ isActive: true }, nonBlockedLeadWhere] });
    expect(visibleLeadWhere()).not.toHaveProperty("NOT");
  });
});
