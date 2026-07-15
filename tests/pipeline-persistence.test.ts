import { beforeEach, describe, expect, it, vi } from "vitest";
import { pipelineStatuses } from "@/lib/leads/pipeline";

const { leadState, tx, prismaMock } = vi.hoisted(() => {
  const leadState = { id: "lead-1", companyName: "Bestaande lead", notes: "Belangrijke notitie", phoneNumber: "+31201234567", opportunityScore: 91, isActive: true, status: "NEW" };
  const tx = {
    lead: {
      findUniqueOrThrow: vi.fn(async () => leadState),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(leadState, data)),
    },
    leadHistory: { create: vi.fn(async () => ({})) },
    leadActivity: { create: vi.fn(async () => ({})) },
    leadNote: { create: vi.fn(async () => ({})) },
  };
  return { leadState, tx, prismaMock: { $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) } };
});
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { updateManualLeadFields } from "@/lib/leads/service";

describe("persistente pipelinewijzigingen", () => {
  beforeEach(() => { leadState.status = "NEW"; vi.clearAllMocks(); });

  it("kan een bestaande lead naar iedere fase verplaatsen zonder andere gegevens te verliezen", async () => {
    for (const status of pipelineStatuses) {
      await updateManualLeadFields("lead-1", "user-1", { status });
      expect(leadState.status).toBe(status);
      expect(leadState).toMatchObject({ companyName: "Bestaande lead", notes: "Belangrijke notitie", phoneNumber: "+31201234567", opportunityScore: 91, isActive: true });
    }
    expect(tx.lead.update).toHaveBeenCalledTimes(8);
  });
});
