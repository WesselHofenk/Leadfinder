import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { sourceProviderHealth: mocks } }));

import { healthySourceEndpoints, recordSourceProviderEvent } from "@/lib/sources/provider-health";

describe("duurzame provider-circuitbreaker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEON_POSTGRES_PRISMA_URL = "postgresql://test.invalid/db";
    mocks.findMany.mockResolvedValue([]);
    mocks.findUnique.mockResolvedValue(null);
    mocks.upsert.mockResolvedValue({});
  });

  it("slaat een afgekoeld endpoint over en gebruikt de onafhankelijke fallback", async () => {
    mocks.findMany.mockResolvedValue([{ provider: "https://a.example", unhealthyUntil: new Date("2026-07-16T10:05:00Z"), consecutiveFailures: 2 }]);
    await expect(healthySourceEndpoints(["https://a.example", "https://b.example"], new Date("2026-07-16T10:00:00Z"))).resolves.toEqual(["https://b.example"]);
  });

  it("opent na de tweede timeout een circuit met cooldown", async () => {
    mocks.findUnique.mockResolvedValue({ consecutiveFailures: 1, totalFailures: 1, totalSuccesses: 0, averageDurationMs: 8_000 });
    const now = new Date("2026-07-16T10:00:00Z");
    await recordSourceProviderEvent({ endpoint: "https://a.example", queryType: "dakdekker:node", tile: "t0-node", attempt: 1, durationMs: 8_000, errorType: "timeout", message: "timeout" }, now);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ unhealthyUntil: new Date("2026-07-16T10:02:00Z"), consecutiveFailures: { increment: 1 } }) }));
  });

  it("sluit het circuit direct na een succesvolle fallbackresponse", async () => {
    mocks.findUnique.mockResolvedValue({ consecutiveFailures: 3, totalFailures: 3, totalSuccesses: 1, averageDurationMs: 4_000 });
    await recordSourceProviderEvent({ endpoint: "https://b.example", queryType: "kapper:way", tile: "t1-way", attempt: 1, durationMs: 900, statusCode: 200, resultCount: 4, message: "ok" });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ consecutiveFailures: 0, unhealthyUntil: null, totalSuccesses: { increment: 1 } }) }));
  });
});
