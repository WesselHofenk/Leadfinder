import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { resetCandidates, resetRun } = vi.hoisted(() => ({ resetCandidates: vi.fn(), resetRun: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    generationCandidate: { updateMany: resetCandidates },
    generationRun: { updateMany: resetRun },
  },
}));

import { markStaleGenerationRuns } from "@/lib/jobs/generation";

describe("herstel van een onderbroken generatiebatch", () => {
  beforeEach(() => { vi.clearAllMocks(); resetCandidates.mockResolvedValue({ count: 2 }); resetRun.mockResolvedValue({ count: 1 }); });

  it("zet geclaimde kandidaten en de job terug naar hervatbaar", async () => {
    const now = new Date("2026-07-15T12:00:00Z");
    await markStaleGenerationRuns(now);
    expect(resetCandidates).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PENDING", claimedAt: null }) }));
    expect(resetRun).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PENDING" }) }));
    expect(resetRun.mock.calls[0][0].data).not.toHaveProperty("finishedAt");
  });
});
