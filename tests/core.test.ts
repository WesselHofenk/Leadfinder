import { describe,expect,it } from "vitest";
import { calculateLeadScore,websiteQualityLabel } from "@/lib/scoring/lead-score";
import { calculateWebsiteScore } from "@/lib/audit/website-score";
import { searchSchema } from "@/lib/validation/search";
import { getLeadProvider } from "@/lib/providers";
import { MockLeadProvider } from "@/lib/providers/mock";
import { leadsToCsv } from "@/lib/export/csv";
import { demoLeads } from "@/lib/demo/leads";
import { LEAD_STATUSES } from "@/types/lead";

const search={query:"",branch:"Bouw & klus",companyName:"",city:"",province:"",postalCode:"",radius:25,limit:25,minResults:1,website:"any" as const,phone:"any" as const,email:"any" as const,poorWebsite:false,minRating:0,minReviews:0};
describe("leadscore",()=>{it("waardeert een bedrijf zonder website als kans",()=>expect(calculateLeadScore({phone:"010",email:"info@example.test"}).score).toBeGreaterThanOrEqual(70));it("blijft begrensd op 100",()=>expect(calculateLeadScore({phone:"1",email:"a",reviewCount:999,rating:2}).score).toBeLessThanOrEqual(100))});
describe("websitekwaliteit",()=>{it("geeft een volledige site een sterke score",()=>{const score=calculateWebsiteScore({reachable:true,https:true,responseTimeMs:300,viewport:true,title:true,metaDescription:true,favicon:true,socialLinks:true,contactPage:true,form:true,phone:true,email:true,performance:"snel"});expect(score).toBe(100);expect(websiteQualityLabel(score)).toBe("Sterk")})});
describe("zoekvalidatie",()=>{it("vereist minimaal één criterium",()=>expect(searchSchema.safeParse({...search,branch:""}).success).toBe(false));it("accepteert de uitgebreide filters",()=>expect(searchSchema.safeParse(search).success).toBe(true));it("filtert mockdata op branche",async()=>expect((await new MockLeadProvider().search(search)).every(l=>l.branch==="Bouw & klus")).toBe(true))});
describe("providers",()=>{it("valt zonder sleutel terug op mock",()=>expect(getLeadProvider({LEAD_PROVIDER:"google"} as unknown as NodeJS.ProcessEnv).name).toBe("demo"))});
describe("export",()=>{it("bevat alle verplichte velden en correcte escaping",()=>{const csv=leadsToCsv([{...demoLeads[0],name:'Test "Bedrijf"'}]);expect(csv.startsWith("\uFEFF")).toBe(true);expect(csv).toContain('Test ""Bedrijf""');expect(csv).toContain("Aantal reviews");expect(csv).toContain("Notities")})});
describe("openbare app",()=>{it("heeft alleen de toegestane statussen",()=>expect(LEAD_STATUSES).toEqual(["Nieuw","Interessant","Benaderd","Reactie ontvangen","Klant geworden","Niet interessant"]));it("bevat minimaal 40 demo-leads",()=>expect(demoLeads.length).toBeGreaterThanOrEqual(40))});
