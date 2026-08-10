import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => {
  const resetCandidates = vi.fn();
  const resetRun = vi.fn();
  const findRuns = vi.fn();
  const updateRun = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "run-expired", ...data }));
  const findRun = vi.fn();
  const countCandidates = vi.fn(async () => 2);
  const transaction = vi.fn(async (work: (tx: unknown) => unknown) => work({
    jobLock: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "lock" })),
      update: vi.fn(async () => ({ id: "lock" })),
    },
    qualifiedLeadDraft: { findMany: vi.fn(async () => []) },
    lead: { count: vi.fn(async () => 0) },
  }));
  return { resetCandidates, resetRun, findRuns, updateRun, findRun, countCandidates, transaction };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    jobLock: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    generationCandidate: { updateMany: mocks.resetCandidates, count: mocks.countCandidates },
    generationRun: {
      findMany: mocks.findRuns,
      findUniqueOrThrow: mocks.findRun,
      update: mocks.updateRun,
      updateMany: mocks.resetRun,
    },
  },
}));

import { markStaleGenerationRuns } from "@/lib/jobs/generation";

describe("herstel van een onderbroken generatiebatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findRuns.mockResolvedValue([]);
    mocks.resetCandidates.mockResolvedValue({ count: 2 });
    mocks.resetRun.mockResolvedValue({ count: 1 });
  });

  it("zet geclaimde kandidaten en de job terug naar hervatbaar", async () => {
    const now = new Date("2026-07-15T12:00:00Z");
    await markStaleGenerationRuns(now);
    expect(mocks.resetCandidates).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PENDING", claimedAt: null }) }));
    expect(mocks.resetRun).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PENDING" }) }));
    expect(mocks.resetRun.mock.calls[0][0].data).not.toHaveProperty("finishedAt");
  });

  it("zet een langlopende zoekopdracht niet op basis van de totale looptijd stop", async () => {
    const startedAt = new Date("2026-07-15T11:49:59Z");
    const run = {
      id: "run-expired", status: "RUNNING", targetCount: 10, candidatesFound: 3, candidatesChecked: 2,
      withoutWebsite: 0, duplicates: 0, existingLeads: 0, rejected: 0, stored: 0, validDrafts: 0,
      manualReview: 2, websitesChecked: 1, websitesFound: 0, permanentlyClosed: 0, temporarilyClosed: 0,
      noWebsite: 0, outdatedWebsite: 0, improvableWebsite: 0, sourceFailures: 0,
      placesUsed: [], apiErrors: [], warnings: [], startedAt,
    };
    mocks.findRuns.mockResolvedValue([{ id: "run-expired" }]);
    mocks.findRun.mockResolvedValue(run);
    await markStaleGenerationRuns(new Date("2026-07-15T12:00:00Z"));
    expect(mocks.updateRun).not.toHaveBeenCalled();
  });
});
