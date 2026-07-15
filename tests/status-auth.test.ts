import { describe, expect, it } from "vitest";
import { canAccessAdmin } from "@/lib/auth/permissions";
import { leadStatuses } from "@/lib/leads/filters";
describe("pipeline en autorisatie",()=>{it("bevat de volledige verkoopworkflow",()=>expect(leadStatuses).toEqual(["NEW","NEEDS_REVIEW","VERIFIED","CALLED","NO_ANSWER","CALL_BACK","INTERESTED","APPOINTMENT","QUOTE_SENT","WON","INVOICED","LOST","REJECTED","HAS_WEBSITE","PERMANENTLY_CLOSED","DO_NOT_CONTACT","FILTERED"]));it("weigert niet-beheerders op beheerfuncties",()=>{expect(canAccessAdmin("ADMIN")).toBe(true);expect(canAccessAdmin("USER")).toBe(false)})});
