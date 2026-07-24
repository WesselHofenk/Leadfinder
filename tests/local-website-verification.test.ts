import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises",()=>({resolveAny:vi.fn()}));
import { resolveAny } from "node:dns/promises";
import { candidateDomains, clearDomainProbeCache, hasStrongAutomaticAbsenceEvidence, isConfirmedNoWebsite, verifyWebsiteCandidate } from "@/lib/leads/website-verification";
import type { Candidate } from "@/lib/leads/eligibility";

const base:Candidate={externalPlaceId:"osm:node/1",source:"OPENSTREETMAP",companyName:"By Yoel",phoneNumber:"0201234567",country:"NL",category:"salon",city:"Abcoude",postalCode:"1391AA",streetAddress:"Kerkstraat 1",latitude:52.2,longitude:4.9,googleMapsUrl:"https://www.openstreetmap.org/node/1"};
describe("lokale websiteverificatie",()=>{beforeEach(()=>{vi.restoreAllMocks();clearDomainProbeCache();vi.mocked(resolveAny).mockReset();vi.mocked(resolveAny).mockRejectedValue(Object.assign(new Error("not found"),{code:"ENOTFOUND"}));delete process.env.WEBSITE_CANDIDATE_DNS_CHECK;});
  it("herkent een eigen website rechtstreeks",async()=>expect(await verifyWebsiteCandidate({...base,website:"https://byyoel.nl"})).toMatchObject({status:"WEBSITE_FOUND",confidence:100,website:"https://byyoel.nl"}));
  it("herkent een domein zonder protocol",async()=>expect(await verifyWebsiteCandidate({...base,website:"byyoel.nl"})).toMatchObject({status:"WEBSITE_FOUND",confidence:100}));
  it("herkent een website in geneste ruwe brondata",async()=>expect(await verifyWebsiteCandidate({...base,rawData:{contactInfo:{officialWebsite:"bruna.nl"}}})).toMatchObject({status:"WEBSITE_FOUND",confidence:100,website:"https://bruna.nl"}));
  it("classificeert alleen social als SOCIAL_ONLY maar nog niet als actieve lead",async()=>expect(await verifyWebsiteCandidate({...base,websiteFields:["https://instagram.com/byyoel"]})).toMatchObject({status:"SOCIAL_ONLY",confidence:60}));
  it("staat social-only toe zodra bronvelden, kaartlocatie en alle domeinprobes betrouwbaar negatief zijn",async()=>expect(await verifyWebsiteCandidate({...base,websiteFields:["https://facebook.com/byyoel"],sourceUpdatedAt:new Date().toISOString(),sourceWebsiteFieldsChecked:true})).toMatchObject({status:"NO_WEBSITE_CONFIRMED",confidence:84,website:null}));
  it("publiceert ontbrekende domeinkandidaten niet zonder Google-controle",async()=>expect(await verifyWebsiteCandidate(base)).toMatchObject({status:"MANUAL_REVIEW_REQUIRED",confidence:55}));
  it("bevestigt meervoudig negatief bewijs alleen voor recent gecontroleerde bronvelden en een kaartlocatie",async()=>{
    const strong={...base,sourceUpdatedAt:new Date().toISOString(),sourceWebsiteFieldsChecked:true};
    expect(hasStrongAutomaticAbsenceEvidence(strong)).toBe(true);
    expect(await verifyWebsiteCandidate(strong)).toMatchObject({status:"NO_WEBSITE_CONFIRMED",confidence:84});
    expect(hasStrongAutomaticAbsenceEvidence({...strong,sourceUpdatedAt:"2020-01-01T00:00:00Z"})).toBe(false);
  });
  it("controleert een zakelijk e-maildomein vóór website-afwezigheid",()=>expect(candidateDomains({...base,email:"contact@onverwacht-bedrijf.nl"})[0]).toBe("onverwacht-bedrijf.nl"));
  it("ziet een los eerste woord van een meerwoordige bedrijfsnaam niet als bewijs van website-eigendom",()=>{
    const domains=candidateDomains({...base,companyName:"Slagerij Waterland",email:"slagerijwaterland@outlook.com"});
    expect(domains).toContain("slagerijwaterland.nl");
    expect(domains).not.toContain("slagerij.nl");
    expect(domains).not.toContain("waterland.nl");
  });
  it("bevestigt alleen een expliciete bronafwezigheid nadat alle domeinkandidaten ontbreken",async()=>expect(await verifyWebsiteCandidate({...base,websiteAbsenceConfirmed:true})).toMatchObject({status:"NO_WEBSITE_CONFIRMED",confidence:90}));
  it("houdt een DNS-netwerkfout onzeker",async()=>{vi.mocked(resolveAny).mockRejectedValue(Object.assign(new Error("temporary"),{code:"EAI_AGAIN"}));expect(await verifyWebsiteCandidate(base)).toMatchObject({status:"UNKNOWN"});});
  it("maakt van HTTP 403 geen geen-websitelead",async()=>{vi.mocked(resolveAny).mockResolvedValue([]);vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(null,{status:403})));expect(await verifyWebsiteCandidate(base)).toMatchObject({status:"UNKNOWN"});});
  it("maakt van HTTP 404 geen bevestigde geen-websitelead",async()=>{vi.mocked(resolveAny).mockResolvedValue([]);vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(null,{status:404})));expect(await verifyWebsiteCandidate(base)).toMatchObject({status:"UNKNOWN"});});
  it("houdt een SSL-fout onzeker en probeert iedere domeinkandidaat begrensd",async()=>{vi.mocked(resolveAny).mockResolvedValue([]);const fetchImpl=vi.fn().mockRejectedValue(new TypeError("certificate has expired"));vi.stubGlobal("fetch",fetchImpl);expect(await verifyWebsiteCandidate(base)).toMatchObject({status:"UNKNOWN"});expect(fetchImpl.mock.calls.length).toBeGreaterThan(0);expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(20);});
  it("behoudt een eigen domein dat naar een boekingspagina redirect als eigen website",async()=>{
    vi.mocked(resolveAny).mockImplementation(async(domain)=>{if(domain==="byyoel.nl")return [];throw Object.assign(new Error("not found"),{code:"ENOTFOUND"});});
    const fetchImpl=vi.fn().mockResolvedValueOnce(new Response(null,{status:302,headers:{location:"https://booking.example/by-yoel"}})).mockResolvedValueOnce(new Response(null,{status:200}));
    vi.stubGlobal("fetch",fetchImpl);
    expect(await verifyWebsiteCandidate(base)).toMatchObject({status:"WEBSITE_FOUND",website:"https://byyoel.nl"});
  });
  it("test voor een vestigingsnaam ook het korte merkdomein van Pearle",async()=>{
    const pearle={...base,companyName:"Pearle Opticiens Amstelveen Westwijk",city:"Amstelveen",brand:"Pearle"};
    expect(candidateDomains(pearle)).toContain("pearle.nl");
    vi.mocked(resolveAny).mockImplementation(async(domain)=>{if(domain==="pearle.nl")return [];throw Object.assign(new Error("not found"),{code:"ENOTFOUND"});});
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("<title>Pearle Opticiens</title>",{status:200})));
    expect(await verifyWebsiteCandidate(pearle)).toMatchObject({status:"WEBSITE_FOUND",website:"https://pearle.nl",confidence:92});
  });
  it("beschouwt alleen expliciete handmatige bevestiging als publiceerbaar",()=>{expect(isConfirmedNoWebsite("NO_WEBSITE_CONFIRMED")).toBe(true);expect(isConfirmedNoWebsite("NO_WEBSITE_LIKELY")).toBe(false);expect(isConfirmedNoWebsite("SOCIAL_ONLY")).toBe(false);});
});
