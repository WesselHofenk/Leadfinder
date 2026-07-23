import { describe, expect, it } from "vitest";
import { canAccessAdmin } from "@/lib/auth/permissions";
import { pipelineStages, pipelineStatuses } from "@/lib/leads/pipeline";

describe("pipeline en autorisatie", () => {
  it("bevat uitsluitend de zes fases in de vaste volgorde", () => {
    expect(pipelineStatuses).toEqual(["nieuw", "belletje-1", "belletje-2", "gemaild", "geen-interesse", "klant"]);
    expect(pipelineStages.map(({ label }) => label)).toEqual(["Nieuw", "Belletje 1", "Belletje 2", "Gemaild", "Geen interesse", "Klant"]);
  });
  it("weigert niet-beheerders op beheerfuncties", () => {
    expect(canAccessAdmin("ADMIN")).toBe(true);
    expect(canAccessAdmin("USER")).toBe(false);
  });
});
