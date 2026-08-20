import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@vercel/queue", () => ({
  send,
  DuplicateMessageError: class DuplicateMessageError extends Error {},
}));

import {
  generationActivationKey,
  generationContinuationDelaySeconds,
  generationQueueKey,
  generationWorkerAvailable,
  isGenerationWorkerHeartbeatHealthy,
  triggerGenerationWorker,
} from "@/lib/jobs/generation-worker";

describe("handmatig geactiveerde generatie-worker", () => {
  afterEach(() => {
    delete process.env.VERCEL;
    vi.clearAllMocks();
  });

  it("start niet vanzelf buiten de geconfigureerde worker-runtime", () => {
    expect(generationWorkerAvailable()).toBe(false);
  });

  it("maakt stabiele sleutels voor dubbele starts en vervolgbatches", () => {
    expect(generationActivationKey(new Date("2026-08-15T10:00:00Z"))).toBe("generation:manual-start:1786788000000");
    expect(generationQueueKey("run-1", 4)).toBe("generation:run-1:after-batch:4");
  });

  it("laat tussen begrensde batches vijf minuten geen Vercel-compute draaien", () => {
    const now = new Date("2026-08-20T12:07:00Z");
    expect(generationContinuationDelaySeconds()).toBe(300);
    expect(isGenerationWorkerHeartbeatHealthy(new Date("2026-08-20T12:01:00Z"), now)).toBe(true);
    expect(isGenerationWorkerHeartbeatHealthy(new Date("2026-08-20T11:59:00Z"), now)).toBe(false);
  });

  it("plaatst de echte worker op de duurzame queue", async () => {
    process.env.VERCEL = "1";
    send.mockResolvedValue({ messageId: "message-1" });
    await expect(triggerGenerationWorker("manual-key")).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith("lead-generation-v2", { taskId: "leadfinder-continuous" }, {
      idempotencyKey: "manual-key",
      retentionSeconds: 86_400,
    });
  });
});
