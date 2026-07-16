import { describe, expect, it } from "vitest";
import { parseLeadFilters } from "@/lib/leads/filters";
import { activeLeadWhere } from "@/lib/leads/service";

describe("Niet geïnteresseerd in leadfilters", () => {
  it("staat niet standaard tussen actieve verkoopleads", () => {
    expect(activeLeadWhere(parseLeadFilters({}))).toMatchObject({
      isActive: true,
      pipelineStage: { is: { slug: { not: "geen-interesse" } } },
    });
  });

  it("blijft via de expliciete statusfilter bereikbaar", () => {
    expect(activeLeadWhere(parseLeadFilters({ status: "geen-interesse" })).pipelineStage).toEqual({ is: { slug: "geen-interesse" } });
  });
});
