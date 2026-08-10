import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const run = { id: "cmrlz4csu0000l6046xanxs8s", status: "RUNNING", progress: 45 };
const task = { id: "leadfinder-continuous", name: "Leadfinder doorlopend zoeken", enabled: true, status: "ACTIVE" };

const automation = vi.hoisted(() => ({
  getLeadfinderTaskSnapshot: vi.fn(),
  setLeadfinderTaskEnabled: vi.fn(),
  stopLeadfinderTask: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ currentUser: vi.fn(async () => ({ id: "user-1" })) }));
vi.mock("@/lib/jobs/automation-tasks", () => automation);
vi.mock("@/lib/security/request", () => ({ hasValidOrigin: vi.fn(() => true), rateLimit: vi.fn(() => true), requestIp: vi.fn(() => "127.0.0.1") }));

import { DELETE, GET, POST } from "@/app/api/generation/route";

function request(method: string) {
  return new NextRequest("https://leadfindersitora.nl/api/generation", {
    method,
    headers: { origin: "https://leadfindersitora.nl", "content-type": "application/json" },
  });
}

describe("permanente Leadfinder-taak API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    automation.getLeadfinderTaskSnapshot.mockResolvedValue({ task, run });
    automation.setLeadfinderTaskEnabled.mockResolvedValue(task);
    automation.stopLeadfinderTask.mockResolvedValue({ task: { ...task, enabled: false, status: "PAUSED" }, run, cancelled: 1 });
  });

  it("leest één singleton-taak met de actuele backendrun", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ task, run });
    expect(automation.getLeadfinderTaskSnapshot).toHaveBeenCalledOnce();
  });

  it("werkt de bestaande taak bij zonder een browserbatch te starten", async () => {
    const response = await POST(request("POST"));
    expect(response.status).toBe(200);
    expect(automation.setLeadfinderTaskEnabled).toHaveBeenCalledWith(true);
  });

  it("pauzeert dezelfde taak en ruimt actieve dubbele runs op", async () => {
    const response = await DELETE(request("DELETE"));
    expect(response.status).toBe(200);
    expect(automation.stopLeadfinderTask).toHaveBeenCalledOnce();
    expect((await response.json()).cancelled).toBe(1);
  });
});
