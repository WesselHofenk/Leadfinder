import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises",()=>({resolveAny:vi.fn()}));
import { resolveAny } from "node:dns/promises";
import { candidateDomains, clearDomainProbeCache, isConfirmedNoWebsite, verifyWebsiteCandidate } from "@/lib/leads/website-verification";
import type { Candidate } from "@/lib/leads/eligibility";

const base:Candidate={externalPlaceId:"osm:node/1",source:"OPENSTREETMAP",companyName:"By Yoel",phoneNumber:"0201234567",country:"NL",category:"salon",city:"Abcoude",postalCode:"1391AA",streetAddress:"Kerkstraat 1",latitude:52.2,longitude:4.9,googleMapsUrl:"https://www.openstreetmap.org/node/1"};
describe("lokale websiteverificatie",()=>{beforeEach(()=>{vi.restoreAllMocks();clearDomainProbeCache();vi.mocked(resolveAny).mockReset();vi.mocked(resolveAny).mockRejectedValue(Object.assign(new Error("not found"),{code:"ENOTFOUND"}));delete process.env.WEBSITE_CANDIDATE_DNS_CHECK;});
  it("herkent een eigen website rechtstreeks",async()=>expect(await verifyWebsiteCandidate({...base,website:"https://byyoel.nl"})).toMatchObject({status:"WEBSITE_FOUND",confidence:100,website:"https://byyoel.nl"}));
  it("herkent een domein zonder protocol",async()=>expect(await verifyWebsiteCandidate({...base,website:"byyoel.nl"})).toMatchObject({status:"WEBSITE_FOUND",confidence:100}));
  it("classificeert alleen social als SOCIAL_ONLY maar nog niet als actieve lead",async()=>expect(await verifyWebsiteCandidate({...base,websiteFields:["https://instagram.com/byyoel"]})).toMatchObject({status:"SOCIAL_ONLY",confidence:60}));
  it("publiceert ontbrekende domeinkandidaten niet zonder Google-controle",async()=>expect(await verifyWebsiteCandidate(base)).toMatchObject({status:"MANUAL_REVIEW_REQUIRED",confidence:55}));
  it("houdt een DNS-netwerkfout onzeker",async()=>{vi.mocked(resolveAny).mockRejectedValue(Object.assign(new Error("temporary"),{code:"EAI_AGAIN"}));expect(await verifyWebsiteCandidate(base)).toMatchObject({status:"UNKNOWN"});});
  it("maakt van HTTP 403 geen geen-websitelead",async()=>{vi.mocked(resolveAny).mockResolvedValue([]);vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(null,{status:403})));expect(await verifyWebsiteCandidate(base)).toMatchObject({status:"UNKNOWN"});});
  it("test voor een vestigingsnaam ook het korte merkdomein van Pearle",async()=>{
    const pearle={...base,companyName:"Pearle Opticiens Amstelveen Westwijk",city:"Amstelveen",brand:"Pearle"};
    expect(candidateDomains(pearle)).toContain("pearle.nl");
    vi.mocked(resolveAny).mockImplementation(async(domain)=>{if(domain==="pearle.nl")return [];throw Object.assign(new Error("not found"),{code:"ENOTFOUND"});});
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("<title>Pearle Opticiens</title>",{status:200})));
    expect(await verifyWebsiteCandidate(pearle)).toMatchObject({status:"WEBSITE_FOUND",website:"https://pearle.nl",confidence:92});
  });
  it("beschouwt alleen expliciete handmatige bevestiging als publiceerbaar",()=>{expect(isConfirmedNoWebsite("NO_WEBSITE_CONFIRMED")).toBe(true);expect(isConfirmedNoWebsite("NO_WEBSITE_LIKELY")).toBe(false);expect(isConfirmedNoWebsite("SOCIAL_ONLY")).toBe(false);});
});
