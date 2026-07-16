import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { pipelineStatuses } from "@/lib/leads/pipeline";

const { updateManualLeadFields } = vi.hoisted(() => ({ updateManualLeadFields: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ currentUser: vi.fn(async () => ({ id: "user-1" })) }));
vi.mock("@/lib/leads/service", () => ({ updateManualLeadFields, reviewLeadWebsite: vi.fn(), suppressLead: vi.fn() }));
vi.mock("@/lib/security/request", () => ({ hasValidOrigin: vi.fn(() => true) }));

import { PATCH } from "@/app/api/leads/[id]/route";

function request(pipelineStage: string) {
  return new NextRequest("https://leadfindersitora.nl/api/leads/lead-1", {
    method: "PATCH", headers: { origin: "https://leadfindersitora.nl", "content-type": "application/json" },
    body: JSON.stringify({ pipelineStage }),
  });
}

describe("pipeline API-validatie", () => {
  beforeEach(() => { vi.clearAllMocks(); updateManualLeadFields.mockImplementation(async (_leadId, _userId, input) => ({ id: "lead-1", ...input })); });

  it.each(pipelineStatuses)("slaat fase %s op", async (pipelineStage) => {
    const response = await PATCH(request(pipelineStage), { params: Promise.resolve({ id: "lead-1" }) });
    expect(response.status).toBe(200);
    expect(updateManualLeadFields).toHaveBeenCalledWith("lead-1", "user-1", { pipelineStage });
    expect((await response.json()).lead.pipelineStage).toBe(pipelineStage);
  });

  it.each(["NEEDS_REVIEW", "VERIFIED", "CALLED", "NO_ANSWER", "WON", "FILTERED"])("weigert oude status %s", async (status) => {
    const response = await PATCH(request(status), { params: Promise.resolve({ id: "lead-1" }) });
    expect(response.status).toBe(400);
    expect(updateManualLeadFields).not.toHaveBeenCalled();
  });
});
