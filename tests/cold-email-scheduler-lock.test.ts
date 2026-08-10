import { describe, expect, it, vi } from "vitest";

const { acquireJobLock, ensureColdEmailCampaignState } = vi.hoisted(() => ({
  acquireJobLock: vi.fn(async () => null),
  ensureColdEmailCampaignState: vi.fn(async () => ({
    id: "sitora-cold-email",
    startDayKey: "2026-08-10",
    templateSequence: 0,
    pausedUntil: null,
  })),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/jobs/lock", () => ({ acquireJobLock }));
vi.mock("@/lib/email/state", () => ({
  COLD_EMAIL_CAMPAIGN_ID: "sitora-cold-email",
  ensureColdEmailCampaignState,
}));
vi.mock("@/lib/email/config", () => ({ coldEmailConfig: () => ({
  COLD_EMAIL_WARMUP_START: "2026-08-10",
  COLD_EMAIL_TIME_ZONE: "Europe/Amsterdam",
}) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/email/worker", () => ({ triggerColdEmailWorker: vi.fn() }));

import { ensureDailyColdEmailBatch } from "@/lib/email/campaign";

describe("dubbele dagelijkse scheduler-run", () => {
  it("stopt vóór leadselectie wanneer dezelfde daglock al bezet is", async () => {
    await expect(ensureDailyColdEmailBatch(new Date("2026-08-10T08:00:00.000Z"))).resolves.toMatchObject({
      scheduled: 0,
      skipped: true,
      reason: "locked",
    });
    expect(acquireJobLock).toHaveBeenCalledWith("cold-email-daily-batch:2026-08-10", 5 * 60_000);
  });
});
