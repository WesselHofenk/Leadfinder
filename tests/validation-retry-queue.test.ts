import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Candidate } from "@/lib/leads/eligibility";

const mocks = vi.hoisted(() => ({
  validationFindUnique: vi.fn(),
  validationUpsert: vi.fn(),
  validationFindMany: vi.fn(),
  generationFindMany: vi.fn(),
  generationCreateMany: vi.fn(),
  generationUpdateMany: vi.fn(),
  validationUpdateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    validationCandidate: {
      findUnique: mocks.validationFindUnique,
      upsert: mocks.validationUpsert,
      findMany: mocks.validationFindMany,
    },
    generationCandidate: { findMany: mocks.generationFindMany },
    $transaction: mocks.transaction,
  },
}));

import {
  importDueValidationRetries,
  importInterruptedGenerationCandidates,
  queueValidationRetry,
  validationRetryDelayMs,
} from "@/lib/leads/retry-queue";

const candidate: Candidate = {
  externalPlaceId: "osm:node/123",
  source: "OPENSTREETMAP",
  companyName: "Echte Zaak",
  businessStatus: "UNKNOWN",
  country: "BE",
  category: "kapper",
  city: "Gent",
  streetAddress: "Gent",
  latitude: 51.05,
  longitude: 3.72,
  googleMapsUrl: "https://www.openstreetmap.org/node/123",
};

describe("duurzame validatie-retryqueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validationFindUnique.mockResolvedValue(null);
    mocks.validationUpsert.mockResolvedValue({ id: "retry-1" });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      generationCandidate: { createMany: mocks.generationCreateMany, updateMany: mocks.generationUpdateMany },
      validationCandidate: { updateMany: mocks.validationUpdateMany },
    }));
  });

  it("bewaart een onzekere echte kandidaat met reden, scores en volgende controledatum", async () => {
    const now = new Date("2026-07-16T10:00:00Z");
    await queueValidationRetry({ runId: "run-1", candidate, reason: "Websitecontrole tijdelijk geblokkeerd", now });
    expect(mocks.validationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        originRunId: "run-1",
        sourceRecordId: "osm:node/123",
        status: "RETRY_REQUIRED",
        failureReason: "Websitecontrole tijdelijk geblokkeerd",
        nextRetryAt: new Date(now.getTime() + validationRetryDelayMs(0)),
      }),
    }));
  });

  it("plant een vervallen retry in een nieuwe generatiebatch en verhoogt de retryteller", async () => {
    mocks.validationFindMany.mockResolvedValue([{
      id: "retry-1", source: "OPENSTREETMAP", sourceRecordId: candidate.externalPlaceId,
      payload: candidate, nextRetryAt: new Date("2026-07-16T09:00:00Z"), createdAt: new Date("2026-07-16T08:00:00Z"),
    }]);
    mocks.generationFindMany.mockResolvedValue([]);
    mocks.generationCreateMany.mockResolvedValue({ count: 1 });
    mocks.validationUpdateMany.mockResolvedValue({ count: 1 });
    await expect(importDueValidationRetries("run-2", 5, new Date("2026-07-16T10:00:00Z"))).resolves.toBe(1);
    expect(mocks.generationCreateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ runId: "run-2", sourceRecordId: candidate.externalPlaceId, segment: "retry:retry-1" })],
    }));
    expect(mocks.validationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "PENDING_VALIDATION", retryCount: { increment: 1 } },
    }));
  });

  it("hervat echte kandidaten uit een afgebroken run en herstelt de bekende zoekgemeente", async () => {
    mocks.generationFindMany.mockResolvedValue([{
      id: "queued-old",
      source: "OPENSTREETMAP",
      sourceRecordId: "osm:node/456",
      segment: "BE:Brugge:lunchroom:t0-node",
      payload: {
        ...candidate,
        externalPlaceId: "osm:node/456",
        city: "Onbekend",
        streetAddress: "Onbekend (51.21000, 3.22000)",
        latitude: 51.21,
        longitude: 3.22,
      },
      createdAt: new Date("2026-07-16T08:00:00Z"),
    }]);
    mocks.generationCreateMany.mockResolvedValue({ count: 1 });
    mocks.generationUpdateMany.mockResolvedValue({ count: 1 });

    await expect(importInterruptedGenerationCandidates("run-new", 8)).resolves.toBe(1);
    expect(mocks.generationFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ runId: { not: "run-new" }, status: "PENDING" }),
    }));
    expect(mocks.generationCreateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        runId: "run-new",
        sourceRecordId: "osm:node/456",
        segment: "carryover:BE:Brugge:lunchroom:t0-node",
        payload: expect.objectContaining({ city: "Brugge", streetAddress: "Brugge (51.21000, 3.22000)" }),
      })],
    }));
    expect(mocks.generationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PROCESSED" }),
    }));
  });

  it("gebruikt begrensde exponential backoff", () => {
    expect(validationRetryDelayMs(1)).toBe(validationRetryDelayMs(0) * 2);
    expect(validationRetryDelayMs(100)).toBeLessThanOrEqual(24 * 60 * 60_000);
  });
});
