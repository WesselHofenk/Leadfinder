import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@vercel/queue", () => ({
  send,
  DuplicateMessageError: class DuplicateMessageError extends Error {},
}));

import { generationWorkerAvailable, scheduleGenerationWatchdog, triggerGenerationWorker } from "@/lib/jobs/generation-worker";

describe("automatische achtergrondvoortzetting", () => {
  afterEach(() => {
    delete process.env.VERCEL;
    vi.restoreAllMocks();
  });

  it("blijft lokaal uitgeschakeld zonder Vercel-runtime", async () => {
    expect(generationWorkerAvailable()).toBe(false);
    await expect(triggerGenerationWorker("run-1", 0)).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("zet de vervolgbatch met een stabiele sleutel op de duurzame wachtrij", async () => {
    process.env.VERCEL = "1";
    send.mockResolvedValue({ messageId: "message-1" });

    await expect(triggerGenerationWorker("run-1", 4)).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith(
      "lead-generation",
      { runId: "run-1" },
      {
        idempotencyKey: "generation:run-1:after-batch:4",
        retentionSeconds: 86_400,
      },
    );
  });

  it("plant bij de oorspronkelijke start een eenmalige watchdog na de tienminutendeadline", async () => {
    process.env.VERCEL = "1";
    send.mockResolvedValue({ messageId: "watchdog-1" });
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-07-15T12:00:00Z").getTime());

    await expect(scheduleGenerationWatchdog("run-1", new Date("2026-07-15T12:00:00Z"))).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith(
      "lead-generation",
      { runId: "run-1" },
      {
        idempotencyKey: "generation:run-1:deadline-watchdog",
        retentionSeconds: 86_400,
        delaySeconds: 602,
      },
    );
  });
});
