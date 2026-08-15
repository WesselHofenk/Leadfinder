import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  taskUpsert: vi.fn(),
  runFindUnique: vi.fn(),
  runFindFirst: vi.fn(),
  candidatesFindMany: vi.fn(),
  sourceRecordsFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    leadfinderTask: { upsert: prismaMocks.taskUpsert },
    generationRun: { findUnique: prismaMocks.runFindUnique, findFirst: prismaMocks.runFindFirst },
    generationCandidate: { findMany: prismaMocks.candidatesFindMany },
    sourceRecord: { findMany: prismaMocks.sourceRecordsFindMany },
  },
}));

import { ensureLeadfinderTask, getLeadfinderTaskSnapshot } from "@/lib/jobs/automation-tasks";

describe("traceerbare kandidaatuitkomsten", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.taskUpsert.mockResolvedValue({
      id: "leadfinder-continuous", enabled: true, status: "PROCESSING", currentRunId: "run-1",
      lastHeartbeatAt: new Date(),
    });
    prismaMocks.runFindUnique.mockResolvedValue({
      id: "run-1", status: "RUNNING", pendingCandidates: 0, currentPhase: "Zoekbatch afgerond",
      candidatesChecked: 4,
    });
  });

  it("maakt een nieuwe singleton standaard gepauzeerd aan", async () => {
    await ensureLeadfinderTask();
    expect(prismaMocks.taskUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ enabled: false, status: "PAUSED" }),
    }));
  });

  it("verklaart 4 gecontroleerd / 0 nieuw / 0 duplicaten / 0 bronfouten", async () => {
    prismaMocks.candidatesFindMany.mockResolvedValue([
      { source: "OPENSTREETMAP", sourceRecordId: "1", status: "PROCESSED" },
      { source: "OPENSTREETMAP", sourceRecordId: "2", status: "PROCESSED" },
      { source: "OPENSTREETMAP", sourceRecordId: "3", status: "PROCESSED" },
      { source: "OPENSTREETMAP", sourceRecordId: "4", status: "PENDING" },
    ]);
    prismaMocks.sourceRecordsFindMany.mockResolvedValue([
      { source: "OPENSTREETMAP", sourceRecordId: "1", decision: "rejected" },
      { source: "OPENSTREETMAP", sourceRecordId: "2", decision: "skipped" },
      { source: "OPENSTREETMAP", sourceRecordId: "3", decision: "rejected" },
      { source: "OPENSTREETMAP", sourceRecordId: "4", decision: "retry" },
    ]);

    const snapshot = await getLeadfinderTaskSnapshot();
    expect(snapshot.candidateOutcomes).toEqual({
      qualified: 0, rejected: 3, duplicates: 0, retrying: 1, failed: 0, processing: 0, total: 4,
    });
    expect(snapshot.candidateOutcomes.total).toBe(snapshot.run?.candidatesChecked);
  });
});
