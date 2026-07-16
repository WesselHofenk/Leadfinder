import { describe, expect, it } from "vitest";
import { canAccessAdmin } from "@/lib/auth/permissions";
import { pipelineStages, pipelineStatuses } from "@/lib/leads/pipeline";

describe("pipeline en autorisatie", () => {
  it("bevat uitsluitend de negen fases in de vaste volgorde", () => {
    expect(pipelineStatuses).toEqual(["nieuw", "belletje-1", "belletje-2", "belletje-3", "belletje-4", "gemaild", "ingepland", "deal", "geen-interesse"]);
    expect(pipelineStages.map(({ label }) => label)).toEqual(["Nieuw", "Belletje 1", "Belletje 2", "Belletje 3", "Belletje 4", "Gemaild", "Ingepland", "Deal", "Geen interesse"]);
  });
  it("weigert niet-beheerders op beheerfuncties", () => {
    expect(canAccessAdmin("ADMIN")).toBe(true);
    expect(canAccessAdmin("USER")).toBe(false);
  });
});
