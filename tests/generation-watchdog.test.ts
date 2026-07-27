import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { runGenerationWatchdog } = vi.hoisted(() => ({ runGenerationWatchdog: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/jobs/generation", () => ({
  processGenerationBatch: vi.fn(),
  runGenerationWatchdog,
}));
vi.mock("@/lib/jobs/generation-worker", () => ({ triggerGenerationWorker: vi.fn() }));

import { GET } from "@/app/api/cron/generation/route";

describe("generatiewatchdog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "watchdog-secret-with-at-least-32-characters";
  });

  it("rondt zelfstandig een vastgelopen worker af via de minuutcron", async () => {
    runGenerationWatchdog.mockResolvedValue({
      active: false,
      processed: true,
      runId: "cmrlz4csu0000l6046xanxs8s",
      status: "PARTIALLY_COMPLETED",
    });
    const request = new NextRequest("http://localhost/api/cron/generation", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, processed: true, status: "PARTIALLY_COMPLETED" });
    expect(runGenerationWatchdog).toHaveBeenCalledOnce();
  });

  it("weigert een watchdogverzoek zonder correct geheim", async () => {
    const response = await GET(new NextRequest("http://localhost/api/cron/generation"));
    expect(response.status).toBe(401);
    expect(runGenerationWatchdog).not.toHaveBeenCalled();
  });
});
