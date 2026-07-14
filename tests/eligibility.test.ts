import { describe, expect, it } from "vitest";
import { qualifyCandidate, type Candidate } from "@/lib/leads/eligibility";
import { normalizePhone, normalizeText } from "@/lib/leads/normalization";

const candidate: Candidate = { externalPlaceId:"place-1",companyName:"De Goede Loodgieter",phoneNumber:"020 123 45 67",businessStatus:"OPERATIONAL",country:"NL",category:"plumber",city:"Amsterdam",streetAddress:"Damrak 1, 1012 LG Amsterdam, Nederland",latitude:52.37,longitude:4.89,googleMapsUrl:"https://maps.google.com/?cid=1" };
describe("leadkwalificatie",()=>{
  it("accepteert operationeel bedrijf zonder website met geldig nummer",()=>expect(qualifyCandidate(candidate).ok).toBe(true));
  it("classificeert bedrijf met website voor kwaliteitsanalyse",()=>expect(qualifyCandidate({...candidate,website:"https://voorbeeld.nl"})).toMatchObject({ok:true,lead:{leadType:"OUTDATED_WEBSITE"}}));
  it("weigert bedrijf zonder telefoonnummer",()=>expect(qualifyCandidate({...candidate,phoneNumber:undefined})).toMatchObject({ok:false,reason:"ongeldig_nummer"}));
  it("weigert permanent gesloten bedrijf",()=>expect(qualifyCandidate({...candidate,businessStatus:"CLOSED_PERMANENTLY"})).toMatchObject({ok:false,reason:"niet_operationeel"}));
  it("weigert tijdelijk gesloten bedrijf",()=>expect(qualifyCandidate({...candidate,businessStatus:"CLOSED_TEMPORARILY"})).toMatchObject({ok:false,reason:"niet_operationeel"}));
  it("weigert een privé/onvolledig adres",()=>expect(qualifyCandidate({...candidate,companyName:""})).toMatchObject({ok:false,reason:"onvolledig"}));
});
describe("normalisatie",()=>{
  it("normaliseert Nederlandse nummers naar E.164",()=>expect(normalizePhone("06-12345678","NL")).toBe("+31612345678"));
  it("normaliseert Belgische nummers naar E.164",()=>expect(normalizePhone("0471 12 34 56","BE")).toBe("+32471123456"));
  it("maakt stabiele duplicaatsleutels",()=>expect(normalizeText("Café Dé Markt B.V.")).toBe(normalizeText("Cafe de Markt BV")));
});
