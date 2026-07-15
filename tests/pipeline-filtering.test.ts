import { describe, expect, it } from "vitest";
import { parseLeadFilters } from "@/lib/leads/filters";
import { activeLeadWhere } from "@/lib/leads/service";

describe("Niet geïnteresseerd in leadfilters", () => {
  it("staat niet standaard tussen actieve verkoopleads", () => {
    expect(activeLeadWhere(parseLeadFilters({}))).toMatchObject({
      isActive: true,
      status: { not: "NOT_INTERESTED" },
    });
  });

  it("blijft via de expliciete statusfilter bereikbaar", () => {
    expect(activeLeadWhere(parseLeadFilters({ status: "NOT_INTERESTED" })).status).toBe("NOT_INTERESTED");
  });
});
