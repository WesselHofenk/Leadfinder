import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { generationWorkerAvailable, triggerGenerationWorker } from "@/lib/jobs/generation-worker";

describe("automatische achtergrondvoortzetting", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.unstubAllGlobals();
  });

  it("blijft uitgeschakeld zonder lang workergeheim", async () => {
    expect(generationWorkerAvailable()).toBe(false);
    await expect(triggerGenerationWorker("run-1", "https://leadfindersitora.nl/admin")).resolves.toBe(false);
  });

  it("start de beveiligde vervolgbatch met hetzelfde run-id", async () => {
    process.env.CRON_SECRET = "x".repeat(32);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);

    await expect(triggerGenerationWorker("run-1", "https://leadfindersitora.nl/admin")).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://leadfindersitora.nl/api/cron/generation"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: `Bearer ${"x".repeat(32)}` }),
        body: JSON.stringify({ runId: "run-1" }),
      }),
    );
  });
});
