import { describe, expect, it } from "vitest";
import { parseLeadFilters } from "@/lib/leads/filters";
import { activeLeadWhere } from "@/lib/leads/service";

describe("Niet geïnteresseerd in leadfilters", () => {
  it("houdt ook Geen interesse standaard zichtbaar in Alle leads", () => {
    const where = activeLeadWhere(parseLeadFilters({}));
    expect(where).toMatchObject({ isActive: true, isFiltered: false, isSuppressed: false });
    expect(where).not.toHaveProperty("pipelineStage");
  });

  it("blijft via de expliciete statusfilter bereikbaar", () => {
    expect(activeLeadWhere(parseLeadFilters({ status: "geen-interesse" })).pipelineStage).toEqual({ is: { slug: "geen-interesse" } });
  });
});
