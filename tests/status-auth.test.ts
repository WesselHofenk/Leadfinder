import { describe, expect, it } from "vitest";
import { canAccessAdmin } from "@/lib/auth/permissions";
import { pipelineStages, pipelineStatuses } from "@/lib/leads/pipeline";
describe("pipeline en autorisatie",()=>{it("bevat uitsluitend de acht fases in de vaste volgorde",()=>{expect(pipelineStatuses).toEqual(["NEW","VOICEMAIL","CALL_BACK","INTERESTED","APPOINTMENT","QUOTE_SENT","CUSTOMER","NOT_INTERESTED"]);expect(pipelineStages.map(({label})=>label)).toEqual(["Nieuw","Voicemail","Terugbellen","Geïnteresseerd","Afspraak","Offerte gestuurd","Klant","Niet geïnteresseerd"])});it("weigert niet-beheerders op beheerfuncties",()=>{expect(canAccessAdmin("ADMIN")).toBe(true);expect(canAccessAdmin("USER")).toBe(false)})});
