import { beforeEach, describe, expect, it, vi } from "vitest";

const runId = "cmrlz4csu0000l6046xanxs8s";
const { processGenerationBatch, triggerGenerationWorker } = vi.hoisted(() => ({
  processGenerationBatch: vi.fn(),
  triggerGenerationWorker: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/jobs/generation", () => ({ processGenerationBatch }));
vi.mock("@/lib/jobs/generation-worker", () => ({ triggerGenerationWorker }));

import { handleGenerationQueueMessage } from "@/lib/jobs/generation-queue";

const queueHandler = handleGenerationQueueMessage as unknown as (
  message: unknown,
  metadata: { messageId: string },
) => Promise<void>;

describe("duurzame generatie-wachtrij", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    triggerGenerationWorker.mockResolvedValue(true);
  });

  it("verwerkt één batch en plant de volgende met het nieuwe batchnummer", async () => {
    processGenerationBatch.mockResolvedValue({ id: runId, status: "RUNNING", batchNumber: 5 });

    await queueHandler({ runId }, { messageId: "message-1" });

    expect(processGenerationBatch).toHaveBeenCalledWith(runId);
    expect(triggerGenerationWorker).toHaveBeenCalledWith(runId, 5);
  });

  it("plant niets meer zodra de run een eindstatus heeft", async () => {
    processGenerationBatch.mockResolvedValue({ id: runId, status: "COMPLETE", batchNumber: 12 });

    await queueHandler({ runId }, { messageId: "message-2" });

    expect(triggerGenerationWorker).not.toHaveBeenCalled();
  });

  it("negeert een ongeldig bericht zonder een run aan te raken", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await queueHandler({ runId: "ongeldig" }, { messageId: "message-3" });

    expect(processGenerationBatch).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
