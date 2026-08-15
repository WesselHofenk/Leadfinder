import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const run = { id: "cmrlz4csu0000l6046xanxs8s", status: "RUNNING", progress: 45 };
const task = { id: "leadfinder-continuous", name: "Leadfinder doorlopend zoeken", enabled: true, status: "ACTIVE" };
const candidateOutcomes = { qualified: 0, rejected: 4, duplicates: 0, retrying: 0, failed: 0, processing: 0, total: 4 };

const automation = vi.hoisted(() => ({
  getLeadfinderTaskSnapshot: vi.fn(),
  setLeadfinderTaskEnabled: vi.fn(),
  stopLeadfinderTask: vi.fn(),
}));
const generation = vi.hoisted(() => ({ runGenerationWatchdog: vi.fn() }));
const worker = vi.hoisted(() => ({
  generationWorkerAvailable: vi.fn(() => false),
  generationActivationKey: vi.fn(() => "activation-key"),
  generationRecoveryKey: vi.fn(() => "recovery-key"),
  triggerGenerationWorker: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ currentUser: vi.fn(async () => ({ id: "user-1" })) }));
vi.mock("@/lib/jobs/automation-tasks", () => automation);
vi.mock("@/lib/jobs/generation", () => generation);
vi.mock("@/lib/jobs/generation-worker", () => worker);
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
    const snapshot = { task, run, operationalStatus: "PROCESSING", workerHealthy: true, candidateOutcomes };
    automation.getLeadfinderTaskSnapshot.mockResolvedValue(snapshot);
    automation.setLeadfinderTaskEnabled.mockResolvedValue({ ...task, updatedAt: new Date("2026-08-15T10:00:00Z") });
    automation.stopLeadfinderTask.mockResolvedValue({ ...snapshot, task: { ...task, enabled: false, status: "PAUSED" }, cancelled: 1 });
    generation.runGenerationWatchdog.mockResolvedValue({ active: true, processed: true, runId: run.id, status: "RUNNING" });
  });

  it("leest één singleton-taak met de actuele backendrun", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ task, run, operationalStatus: "PROCESSING", workerHealthy: true, candidateOutcomes });
    expect(automation.getLeadfinderTaskSnapshot).toHaveBeenCalledOnce();
  });

  it("start na de handmatige klik direct echte backendverwerking", async () => {
    const response = await POST(request("POST"));
    expect(response.status).toBe(202);
    expect(automation.setLeadfinderTaskEnabled).toHaveBeenCalledWith(true);
    expect(generation.runGenerationWatchdog).toHaveBeenCalledOnce();
  });

  it("pauzeert dezelfde taak en ruimt actieve dubbele runs op", async () => {
    const response = await DELETE(request("DELETE"));
    expect(response.status).toBe(200);
    expect(automation.stopLeadfinderTask).toHaveBeenCalledOnce();
    expect((await response.json()).cancelled).toBe(1);
  });
});
