import { describe, expect, it } from "vitest";
import { parseLeadFilters } from "@/lib/leads/filters";
import { activeLeadWhere, buildLeadListQuery } from "@/lib/leads/service";
import { leadsToCsv } from "@/lib/export/csv";
import { leadsToXlsx } from "@/lib/export/xlsx";
import { backoffDelayMs, isRetryableStatus } from "@/lib/jobs/backoff";

describe("filters en paginering",()=>{
  it("begrensd server-side paginering",()=>expect(parseLeadFilters({page:"2",pageSize:"50"})).toMatchObject({page:2,pageSize:50}));
  it("bouwt vaste leadvoorwaarden en filters",()=>expect(activeLeadWhere(parseLeadFilters({country:"BE",city:"Gent",leadType:"NO_WEBSITE",minConfidence:"70"}))).toMatchObject({isActive:true,isFiltered:false,isSuppressed:false,businessStatus:{in:["OPERATIONAL","UNKNOWN","FUTURE_OPENING"]},country:"BE",websiteStatus:"NO_WEBSITE_CONFIRMED",websiteConfidence:{gte:70}}));
  it("weigert onbegrensde paginaomvang",()=>expect(()=>parseLeadFilters({pageSize:"1000"})).toThrow());
  it("toont alle herstelde actieve leads standaard en houdt de controlepipeline apart",()=>{const where=activeLeadWhere(parseLeadFilters({}));expect(where).toMatchObject({isActive:true,isFiltered:false});expect(where).not.toHaveProperty("websiteStatus");expect(activeLeadWhere(parseLeadFilters({filtered:"yes"}))).toMatchObject({isFiltered:true})});
  it("behoudt de expliciete geen-websitefilter",()=>{const where=activeLeadWhere(parseLeadFilters({leadType:"NO_WEBSITE"}));expect(where).toMatchObject({websiteStatus:"NO_WEBSITE_CONFIRMED"});expect(where).not.toHaveProperty("googleWebsiteVerifiedAt")});
  it("onderscheidt Google-controleleads van handmatig bevestigde leads",()=>{expect(activeLeadWhere(parseLeadFilters({googleReview:"pending"}))).toMatchObject({websiteStatus:"NO_WEBSITE_CONFIRMED",googleWebsiteVerifiedAt:null});expect(activeLeadWhere(parseLeadFilters({googleReview:"confirmed"}))).toMatchObject({googleWebsitePresent:false,googleWebsiteVerifiedAt:{not:null}})});
  it("past de websitefilter toe voordat pagina 2 wordt opgehaald",()=>expect(buildLeadListQuery(parseLeadFilters({websiteStatus:"NO_WEBSITE_LIKELY",page:"2",pageSize:"25"}))).toMatchObject({where:{websiteStatus:"NO_WEBSITE_LIKELY"},skip:25,take:25}));
  it("combineert filters met AND-logica",()=>expect(activeLeadWhere(parseLeadFilters({country:"NL",city:"Utrecht",source:"OPENSTREETMAP",websiteStatus:"SOCIAL_ONLY",hasEmail:"yes"}))).toMatchObject({country:"NL",city:{contains:"Utrecht"},source:"OPENSTREETMAP",websiteStatus:"SOCIAL_ONLY",email:{not:null}}));
});
describe("CSV-export",()=>it("exporteert uitsluitend de aangeleverde gefilterde records",()=>{const csv=leadsToCsv([{companyName:"Bedrijf A",normalizedPhoneNumber:"+31201234567",category:"loodgieter",streetAddress:"Straat 1",postalCode:"1000AA",city:"Amsterdam",province:"Noord-Holland",country:"NL",googleMapsUrl:"https://maps.example/a",firstDiscoveredAt:new Date("2026-01-01"),lastVerifiedAt:new Date("2026-01-02"),contactStatus:"NEW"} as never]);expect(csv).toContain("Bedrijf A");expect(csv).not.toContain("Bedrijf B")}));
describe("XLSX-export",()=>it("maakt een begrensd Excelbestand van de gefilterde records",async()=>{const file=await leadsToXlsx([{companyName:"Bedrijf A",normalizedPhoneNumber:"+31201234567",category:"loodgieter",streetAddress:"Straat 1",city:"Amsterdam",country:"NL",googleMapsUrl:"https://maps.example/a",firstDiscoveredAt:new Date(),lastVerifiedAt:new Date(),status:"NEW",leadType:"NO_WEBSITE",opportunityScore:95} as never]);expect(file.byteLength).toBeGreaterThan(1000)}));
describe("API-fouten",()=>it("past exponential backoff alleen op tijdelijke fouten toe",()=>{expect(isRetryableStatus(429)).toBe(true);expect(isRetryableStatus(400)).toBe(false);expect(backoffDelayMs(4,0)).toBe(8000)}));
