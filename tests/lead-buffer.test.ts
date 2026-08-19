import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  leadCount: vi.fn(),
  leadFindFirst: vi.fn(),
  taskFindUnique: vi.fn(),
  workerAvailable: vi.fn(),
  triggerWorker: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: { count: mocks.leadCount, findFirst: mocks.leadFindFirst },
    leadfinderTask: { findUnique: mocks.taskFindUnique },
  },
}));
vi.mock("@/lib/jobs/generation-worker", () => ({
  generationWorkerAvailable: mocks.workerAvailable,
  triggerGenerationWorker: mocks.triggerWorker,
}));

import { getLeadBufferSnapshot, requestLeadBufferRefill } from "@/lib/jobs/lead-buffer";

describe("verzendbare Nieuw-buffer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LEAD_NEW_BUFFER_TARGET;
    mocks.leadFindFirst.mockResolvedValue(null);
  });

  it("gebruikt de configureerbare standaardbuffer van 150 verzendbare leads", async () => {
    mocks.leadCount.mockResolvedValue(12);
    await expect(getLeadBufferSnapshot()).resolves.toMatchObject({
      eligible: 12,
      target: 150,
      needsRefill: true,
      lastSuccessfulLeadAt: null,
    });
  });

  it("vraagt alleen refill aan wanneer de gebruiker de Leadfinder actief liet", async () => {
    mocks.workerAvailable.mockReturnValue(true);
    mocks.leadCount.mockResolvedValue(0);
    mocks.taskFindUnique.mockResolvedValue({ enabled: false });
    await expect(requestLeadBufferRefill("refill-1")).resolves.toBe(false);
    expect(mocks.triggerWorker).not.toHaveBeenCalled();

    mocks.taskFindUnique.mockResolvedValue({ enabled: true });
    mocks.triggerWorker.mockResolvedValue(true);
    await expect(requestLeadBufferRefill("refill-2")).resolves.toBe(true);
    expect(mocks.triggerWorker).toHaveBeenCalledWith("refill-2");
  });

  it("start geen zoekwerk wanneer de buffer al gevuld is", async () => {
    mocks.workerAvailable.mockReturnValue(true);
    mocks.taskFindUnique.mockResolvedValue({ enabled: true });
    mocks.leadCount.mockResolvedValue(150);
    await expect(requestLeadBufferRefill("refill-full")).resolves.toBe(false);
    expect(mocks.triggerWorker).not.toHaveBeenCalled();
  });
});
