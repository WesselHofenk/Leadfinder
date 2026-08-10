import { describe, expect, it } from "vitest";
import type { Candidate } from "@/lib/leads/eligibility";
import { assessSingleLocation, directSingleLocationSignal, organizationNameKey } from "@/lib/leads/single-location";

const base: Candidate = {
  externalPlaceId: "osm:node/1", source: "OPENSTREETMAP", companyName: "De Vries Schilders Breda",
  phoneNumber: "+31 76 123 45 67", country: "NL", category: "schilder", city: "Breda",
  postalCode: "4811AA", streetAddress: "Markt 1", formattedAddress: "Markt 1, 4811 AA Breda, Nederland",
  latitude: 51.588, longitude: 4.776, googleMapsUrl: "https://www.openstreetmap.org/node/1",
  sourceUrl: "https://www.openstreetmap.org/node/1", rawData: { name: "De Vries Schilders Breda", phone: "+31 76 123 45 67" },
};

function related(overrides: Partial<Candidate>): Candidate {
  return { ...base, externalPlaceId: "osm:node/2", ...overrides };
}

describe("harde controle op maximaal één fysieke vestiging", () => {
  it("voegt twee vermeldingen van dezelfde vestiging samen", () => {
    const decision = assessSingleLocation(base, [related({ latitude: 51.58801, longitude: 4.77601 })]);
    expect(decision).toMatchObject({ status: "CONFIRMED", reason: "dubbele_vermelding_zelfde_vestiging", duplicateExternalIds: ["osm:node/2"] });
  });

  it("keurt dezelfde organisatie op twee adressen volledig af", () => {
    const other = related({ companyName: "De Vries Schilders Tilburg", city: "Tilburg", streetAddress: "Heuvel 8", postalCode: "5038AA", latitude: 51.56, longitude: 5.09, phoneNumber: "+31 13 222 33 44" });
    expect(organizationNameKey(base.companyName, base.city)).toBe(organizationNameKey(other.companyName, other.city));
    expect(assessSingleLocation(base, [other])).toMatchObject({ status: "MULTIPLE", reason: "zelfde_naam_meerdere_adressen" });
  });

  it("normaliseert gesplitste rechtsvormen zonder bedrijfsnamen te vervormen", () => {
    expect(organizationNameKey("De Vries Schilders B.V. Breda", "Breda")).toBe("de vries schilders");
  });

  it("keurt hetzelfde telefoonnummer op verschillende adressen af", () => {
    const other = related({ companyName: "Lokale Klusdienst", city: "Tilburg", streetAddress: "Heuvel 8", postalCode: "5038AA", latitude: 51.56, longitude: 5.09 });
    expect(assessSingleLocation(base, [other])).toMatchObject({ status: "MULTIPLE", reason: "zelfde_telefoon_meerdere_adressen" });
  });

  it("herkent een bekende winkelketen zonder websiteveld", () => {
    expect(directSingleLocationSignal({ ...base, companyName: "Albert Heijn Breda" })).toMatchObject({ status: "MULTIPLE", reason: "vermoedelijke_keten" });
  });

  it("keurt een franchisevestiging af", () => {
    expect(directSingleLocationSignal({ ...base, rawData: { franchise: "yes", phone: base.phoneNumber } })).toMatchObject({ status: "MULTIPLE", reason: "franchise" });
  });

  it("staat een zelfstandige zzp'er met één adres toe", () => {
    expect(assessSingleLocation({ ...base, companyName: "Jansen Timmerwerk" }, [])).toMatchObject({ status: "CONFIRMED", reason: "enkele_vestiging_bevestigd" });
  });

  it("staat meerdere medewerkers op één locatie toe", () => {
    expect(assessSingleLocation({ ...base, rawData: { employees: "12", phone: base.phoneNumber } }, [])).toMatchObject({ status: "CONFIRMED" });
  });

  it("staat één kantoor met een groot werkgebied toe zonder filiaalsignalen", () => {
    expect(assessSingleLocation({ ...base, rawData: { service_area: "Noord-Brabant en Zeeland", phone: base.phoneNumber } }, [])).toMatchObject({ status: "CONFIRMED" });
  });

  it("slaat een kandidaat met onvoltooide vestigingscontrole niet automatisch op", () => {
    expect(assessSingleLocation(base, [], false)).toMatchObject({ status: "UNCERTAIN", reason: "onzeker_aantal_vestigingen" });
  });

  it("voegt twee verschillende bedrijven met een algemene naam niet onterecht samen", () => {
    const studio = { ...base, companyName: "Studio", phoneNumber: "+31 76 111 22 33" };
    const other = related({ companyName: "Studio", city: "Tilburg", streetAddress: "Heuvel 8", postalCode: "5038AA", latitude: 51.56, longitude: 5.09, phoneNumber: "+31 13 222 33 44" });
    expect(assessSingleLocation(studio, [other])).toMatchObject({ status: "CONFIRMED" });
  });

  it("keurt een ketenvestiging ook zonder websitebewijs af", () => {
    expect(directSingleLocationSignal({ ...base, companyName: "Kruidvat Centrum", website: undefined })).toMatchObject({ status: "MULTIPLE", reason: "vermoedelijke_keten" });
  });

  it("gebruikt meerdere sociale locatiepagina's als vestigingsbewijs", () => {
    const candidate = { ...base, socialUrls: ["https://social.example/locations/breda", "https://social.example/locations/tilburg"] };
    expect(directSingleLocationSignal(candidate)).toMatchObject({ status: "MULTIPLE", reason: "meerdere_vestigingen" });
  });

  it("keurt merk- en netwerksignalen standaard af", () => {
    expect(directSingleLocationSignal({ ...base, brandWikidata: "Q123" })).toMatchObject({ status: "MULTIPLE", reason: "merk_of_netwerk" });
  });
});
