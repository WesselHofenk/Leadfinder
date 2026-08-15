import { beforeEach, describe, expect, it, vi } from "vitest";

const { runGenerationWatchdog, getLeadfinderTaskSnapshot, triggerGenerationWorker } = vi.hoisted(() => ({
  runGenerationWatchdog: vi.fn(),
  getLeadfinderTaskSnapshot: vi.fn(),
  triggerGenerationWorker: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/jobs/generation", () => ({ runGenerationWatchdog }));
vi.mock("@/lib/jobs/automation-tasks", () => ({
  LEADFINDER_TASK_ID: "leadfinder-continuous",
  getLeadfinderTaskSnapshot,
}));
vi.mock("@/lib/jobs/generation-worker", () => ({
  generationContinuationDelaySeconds: vi.fn(() => 1),
  generationQueueKey: vi.fn((runId: string, batch: number) => `generation:${runId}:after-batch:${batch}`),
  triggerGenerationWorker,
}));

import { handleGenerationQueueMessage } from "@/lib/jobs/generation-queue";

describe("doorlopende generatiequeue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runGenerationWatchdog.mockResolvedValue({ active: true, processed: true });
    getLeadfinderTaskSnapshot.mockResolvedValue({
      task: { enabled: true },
      run: { id: "run-1", batchNumber: 1, lastError: null },
    });
  });

  it("vult na batch 1 met een lege kandidatenqueue direct de volgende batch aan", async () => {
    await handleGenerationQueueMessage({ taskId: "leadfinder-continuous" }, { messageId: "message-1" } as never);
    expect(runGenerationWatchdog).toHaveBeenCalledOnce();
    expect(triggerGenerationWorker).toHaveBeenCalledWith("generation:run-1:after-batch:1", 1);
  });

  it("plant na handmatig pauzeren niets meer in", async () => {
    runGenerationWatchdog.mockResolvedValue({ active: false, processed: false, reason: "paused" });
    await handleGenerationQueueMessage({ taskId: "leadfinder-continuous" }, { messageId: "message-2" } as never);
    expect(triggerGenerationWorker).not.toHaveBeenCalled();
  });

  it("weigert een bericht voor een andere taak", async () => {
    await handleGenerationQueueMessage({ taskId: "other" }, { messageId: "message-3" } as never);
    expect(runGenerationWatchdog).not.toHaveBeenCalled();
  });
});
