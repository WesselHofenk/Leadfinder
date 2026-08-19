import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  taskUpsert: vi.fn(),
  runFindUnique: vi.fn(),
  runFindFirst: vi.fn(),
  candidatesFindMany: vi.fn(),
  sourceRecordsFindMany: vi.fn(),
  leadCount: vi.fn(),
  leadFindFirst: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    leadfinderTask: { upsert: prismaMocks.taskUpsert },
    generationRun: { findUnique: prismaMocks.runFindUnique, findFirst: prismaMocks.runFindFirst },
    generationCandidate: { findMany: prismaMocks.candidatesFindMany },
    sourceRecord: { findMany: prismaMocks.sourceRecordsFindMany },
    lead: { count: prismaMocks.leadCount, findFirst: prismaMocks.leadFindFirst },
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
    prismaMocks.leadCount.mockResolvedValue(0);
    prismaMocks.leadFindFirst.mockResolvedValue(null);
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
      { source: "OPENSTREETMAP", sourceRecordId: "1", decision: "rejected", reasonCode: "LANGUAGE_NOT_DUTCH" },
      { source: "OPENSTREETMAP", sourceRecordId: "2", decision: "skipped", reasonCode: "SKIPPED_HAS_WEBSITE" },
      { source: "OPENSTREETMAP", sourceRecordId: "3", decision: "rejected", reasonCode: "LANGUAGE_NOT_DUTCH" },
      { source: "OPENSTREETMAP", sourceRecordId: "4", decision: "retry", reasonCode: "STATUS_VERIFICATION_REQUIRED" },
    ]);

    const snapshot = await getLeadfinderTaskSnapshot();
    expect(snapshot.candidateOutcomes).toEqual({
      qualified: 0, rejected: 3, duplicates: 0, retrying: 1, failed: 0, processing: 0, total: 4,
    });
    expect(snapshot.candidateOutcomes.total).toBe(snapshot.run?.candidatesChecked);
    expect(snapshot.rejectionReasons).toEqual([
      { code: "LANGUAGE_NOT_DUTCH", count: 2 },
      { code: "SKIPPED_HAS_WEBSITE", count: 1 },
    ]);
    expect(snapshot.leadBuffer).toMatchObject({ eligible: 0, target: 150, needsRefill: true });
  });

  it("toont tijdens een actieve batch nooit meer uitkomsten dan gecontroleerde kandidaten", async () => {
    prismaMocks.runFindUnique.mockResolvedValue({
      id: "run-1", status: "RUNNING", pendingCandidates: 0, currentPhase: "Kandidaten valideren",
      candidatesChecked: 4,
    });
    prismaMocks.candidatesFindMany.mockResolvedValue(Array.from({ length: 8 }, (_, index) => ({
      source: "OPENSTREETMAP", sourceRecordId: String(index + 1), status: "PROCESSING",
    })));
    prismaMocks.sourceRecordsFindMany.mockResolvedValue([]);
    const snapshot = await getLeadfinderTaskSnapshot();
    expect(snapshot.run?.candidatesChecked).toBe(8);
    expect(snapshot.candidateOutcomes.total).toBe(8);
  });
});
