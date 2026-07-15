import { describe, expect, it } from "vitest";
import { hasPlausibleBusinessLocation, hasRecentSourceEvidence, qualifyCandidate, type Candidate } from "@/lib/leads/eligibility";
import { normalizePhone, normalizePhones, normalizePostalCode, normalizeText } from "@/lib/leads/normalization";

const candidate: Candidate = { externalPlaceId:"place-1",companyName:"De Goede Loodgieter",phoneNumber:"020 123 45 67",businessStatus:"OPERATIONAL",country:"NL",category:"plumber",city:"Amsterdam",streetAddress:"Damrak 1, 1012 LG Amsterdam, Nederland",latitude:52.37,longitude:4.89,googleMapsUrl:"https://maps.google.com/?cid=1" };
const confirmed = { status:"NO_WEBSITE_CONFIRMED" as const,website:null,reason:"Bevestigd" };
describe("leadkwalificatie",()=>{
  it("accepteert operationeel bedrijf alleen met bevestigde website-afwezigheid",()=>expect(qualifyCandidate(candidate,confirmed).ok).toBe(true));
  it("weigert ontbrekende website-afwezigheidsbevestiging",()=>expect(qualifyCandidate(candidate)).toMatchObject({ok:false,reason:"website_onzeker"}));
  it("weigert een bedrijf met een eigen website",()=>expect(qualifyCandidate({...candidate,website:"https://voorbeeld.nl"},confirmed)).toMatchObject({ok:false,reason:"eigen_website"}));
  it("telt een socialmediaprofiel niet als eigen website",()=>expect(qualifyCandidate({...candidate,website:"https://facebook.com/degoodeloodgieter"},confirmed)).toMatchObject({ok:true,lead:{leadType:"NO_WEBSITE",website:undefined}}));
  it("weigert bedrijf zonder telefoonnummer",()=>expect(qualifyCandidate({...candidate,phoneNumber:undefined},confirmed)).toMatchObject({ok:false,reason:"ongeldig_nummer"}));
  it("weigert permanent gesloten bedrijf",()=>expect(qualifyCandidate({...candidate,businessStatus:"CLOSED_PERMANENTLY"},confirmed)).toMatchObject({ok:false,reason:"niet_operationeel"}));
  it("weigert tijdelijk gesloten bedrijf",()=>expect(qualifyCandidate({...candidate,businessStatus:"CLOSED_TEMPORARILY"},confirmed)).toMatchObject({ok:false,reason:"niet_operationeel"}));
  it("weigert een privé/onvolledig adres",()=>expect(qualifyCandidate({...candidate,companyName:""},confirmed)).toMatchObject({ok:false,reason:"onvolledig"}));
  it("gebruikt een geldig tweede telefoonnummer wanneer het eerste ongeldig is",()=>expect(qualifyCandidate({...candidate,phoneNumber:"ongeldig",phoneNumbers:["123", "+31 20 123 45 67"]},confirmed)).toMatchObject({ok:true,lead:{normalizedPhoneNumber:"+31201234567"}}));
  it("weigert verouderde of datumloze OSM-vermeldingen",()=>{
    expect(qualifyCandidate({...candidate,source:"OPENSTREETMAP",sourceUpdatedAt:"2018-01-01T00:00:00Z"},confirmed)).toMatchObject({ok:false,reason:"verouderde_bron"});
    expect(qualifyCandidate({...candidate,source:"OPENSTREETMAP"},confirmed)).toMatchObject({ok:false,reason:"verouderde_bron"});
  });
  it("accepteert actuele OSM-metadata als onderdeel van de betrouwbaarheidstoets",()=>expect(hasRecentSourceEvidence({...candidate,source:"OPENSTREETMAP",sourceUpdatedAt:new Date().toISOString()})).toBe(true));
  it("weigert ongeldige postcodes, huisnummers en coördinaten",()=>{
    expect(hasPlausibleBusinessLocation({...candidate,streetAddress:"Damrak",postalCode:"1012 LG"})).toBe(false);
    expect(hasPlausibleBusinessLocation({...candidate,latitude:0,longitude:0,postalCode:"1012 LG"})).toBe(false);
  });
  it("weigert een keten die alleen via het merkveld herkenbaar is",()=>expect(qualifyCandidate({...candidate,brand:"Albert Heijn"},confirmed)).toMatchObject({ok:false,reason:"keten_of_uitgesloten"}));
});
describe("normalisatie",()=>{
  it("normaliseert Nederlandse nummers naar E.164",()=>expect(normalizePhone("06-12345678","NL")).toBe("+31612345678"));
  it("normaliseert Belgische nummers naar E.164",()=>expect(normalizePhone("0471 12 34 56","BE")).toBe("+32471123456"));
  it("splitst meerdere telefoonnummers en kiest alleen belbare E.164-nummers",()=>expect(normalizePhones(["onbekend; 06-12345678", "+31 20 123 45 67"],"NL")).toEqual(["+31612345678", "+31201234567"]));
  it("normaliseert postcodes ook uit een volledig adres",()=>expect(normalizePostalCode("Damrak 1, 1012 lg Amsterdam","NL")).toBe("1012 LG"));
  it("maakt stabiele duplicaatsleutels",()=>expect(normalizeText("Café Dé Markt B.V.")).toBe(normalizeText("Cafe de Markt BV")));
});
