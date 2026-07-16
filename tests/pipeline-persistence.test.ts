import { beforeEach, describe, expect, it, vi } from "vitest";
import { pipelineStatuses } from "@/lib/leads/pipeline";

const { leadState, tx, prismaMock } = vi.hoisted(() => {
  const stages = [
    ["pipeline-nieuw", "nieuw", "Nieuw"], ["pipeline-belletje-1", "belletje-1", "Belletje 1"],
    ["pipeline-belletje-2", "belletje-2", "Belletje 2"], ["pipeline-belletje-3", "belletje-3", "Belletje 3"],
    ["pipeline-belletje-4", "belletje-4", "Belletje 4"], ["pipeline-gemaild", "gemaild", "Gemaild"], ["pipeline-ingepland", "ingepland", "Ingepland"],
    ["pipeline-deal", "deal", "Deal"], ["pipeline-geen-interesse", "geen-interesse", "Geen interesse"],
  ].map(([id, slug, name]) => ({ id, slug, name }));
  const leadState = {
    id: "lead-1", companyName: "Bestaande lead", notes: "Belangrijke notitie", phoneNumber: "+31201234567",
    opportunityScore: 91, isActive: true, pipelineStageId: "pipeline-nieuw",
    pipelineStage: { id: "pipeline-nieuw", slug: "nieuw", name: "Nieuw" },
  };
  const tx = {
    lead: {
      findUniqueOrThrow: vi.fn(async () => leadState),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(leadState, data);
        const stage = stages.find((item) => item.id === data.pipelineStageId)!;
        leadState.pipelineStage = stage;
        return leadState;
      }),
    },
    pipelineStage: {
      findFirstOrThrow: vi.fn(async ({ where }: { where: { slug: string } }) => {
        return stages.find((item) => item.slug === where.slug)!;
      }),
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
  beforeEach(() => {
    leadState.pipelineStageId = "pipeline-nieuw";
    leadState.pipelineStage = { id: "pipeline-nieuw", slug: "nieuw", name: "Nieuw" };
    vi.clearAllMocks();
  });

  it("kan een bestaande lead naar iedere fase verplaatsen zonder andere gegevens te verliezen", async () => {
    for (const pipelineStage of pipelineStatuses) {
      await updateManualLeadFields("lead-1", "user-1", { pipelineStage });
      expect(leadState.pipelineStage.slug).toBe(pipelineStage);
      expect(leadState).toMatchObject({ companyName: "Bestaande lead", notes: "Belangrijke notitie", phoneNumber: "+31201234567", opportunityScore: 91, isActive: true });
    }
    expect(tx.lead.update).toHaveBeenCalledTimes(9);
  });
});
