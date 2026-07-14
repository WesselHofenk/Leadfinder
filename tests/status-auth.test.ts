import { describe, expect, it } from "vitest";
import { canAccessAdmin } from "@/lib/auth/permissions";
import { leadStatuses } from "@/lib/leads/filters";
describe("pipeline en autorisatie",()=>{it("bevat exact de vereiste hoofdstatussen",()=>expect(leadStatuses).toEqual(["NEW","CALLED","NO_ANSWER","QUOTE_SENT","INVOICED","DO_NOT_CONTACT","FILTERED"]));it("weigert niet-beheerders op beheerfuncties",()=>{expect(canAccessAdmin("ADMIN")).toBe(true);expect(canAccessAdmin("USER")).toBe(false)})});
