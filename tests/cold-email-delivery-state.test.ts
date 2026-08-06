import { beforeEach, describe, expect, it, vi } from "vitest";
import { fromZonedTime } from "date-fns-tz";

vi.mock("server-only", () => ({}));

const { state, appendToSentItems, compileColdEmail, sendCompiledColdEmail, assertRecipientDomainCanReceiveMail, leadUpdate, prismaMock } = vi.hoisted(() => {
  const state = {
    id: "mail-1",
    leadId: "lead-1",
    createdById: "user-1",
    fromAddress: "info@sitora.nl",
    recipient: "info@bedrijf.nl",
    subject: "Kennismaking",
    bodyText: "Beste ondernemer,",
    scheduledFor: new Date("2026-08-04T08:00:00.000Z"),
    allowOutsideWindow: false,
    status: "PENDING",
    attempts: 0,
    archiveAttempts: 0,
    messageId: null as string | null,
    rawMessageBase64: null as string | null,
    smtpAcceptedAt: null as Date | null,
    archivedAt: null as Date | null,
    lastError: null as string | null,
    createdAt: new Date("2026-08-03T10:00:00.000Z"),
    updatedAt: new Date("2026-08-03T10:00:00.000Z"),
  };
  const appendToSentItems = vi.fn();
  const compileColdEmail = vi.fn(async () => ({ raw: Buffer.from("raw-message"), messageId: "<mail-1@sitora.nl>" }));
  const sendCompiledColdEmail = vi.fn(async () => ({ accepted: ["info@bedrijf.nl"] }));
  const assertRecipientDomainCanReceiveMail = vi.fn(async () => undefined);
  const leadUpdate = vi.fn(async () => ({}));
  const applyUpdate = (data: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && "increment" in value) {
        (state as unknown as Record<string, unknown>)[key] = Number((state as unknown as Record<string, unknown>)[key]) + Number((value as { increment: number }).increment);
      } else {
        (state as unknown as Record<string, unknown>)[key] = value;
      }
    }
    return { ...state };
  };
  const coldEmailUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => applyUpdate(data));
  const tx = {
    coldEmail: { findUniqueOrThrow: vi.fn(async () => ({ ...state })), update: coldEmailUpdate },
    pipelineStage: { findFirstOrThrow: vi.fn(async () => ({ id: "pipeline-gemaild", slug: "gemaild" })) },
    lead: { update: leadUpdate },
    leadActivity: { create: vi.fn(async () => ({})) },
    leadHistory: { create: vi.fn(async () => ({})) },
  };
  const prismaMock = {
    coldEmail: {
      findUniqueOrThrow: vi.fn(async () => ({ ...state })),
      updateMany: vi.fn(async () => {
        if (!["PENDING", "FAILED"].includes(state.status) || state.attempts >= 3 || state.smtpAcceptedAt) return { count: 0 };
        state.status = "SENDING";
        state.attempts += 1;
        return { count: 1 };
      }),
      update: coldEmailUpdate,
    },
    $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
  };
  return { state, appendToSentItems, compileColdEmail, sendCompiledColdEmail, assertRecipientDomainCanReceiveMail, leadUpdate, coldEmailUpdate, prismaMock };
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/jobs/lock", () => ({ acquireJobLock: vi.fn() }));
vi.mock("@/lib/email/config", () => ({ coldEmailConfig: () => ({
  COLD_EMAIL_FROM_ADDRESS: "info@sitora.nl",
  COLD_EMAIL_FROM_NAME: "Sitora",
  COLD_EMAIL_WARMUP_START: "2026-08-04",
  COLD_EMAIL_TIME_ZONE: "Europe/Amsterdam",
  MAIL_SMTP_HOST: "mail.sitora.nl",
  MAIL_SMTP_PORT: 587,
  MAIL_SMTP_SECURE: false,
  MAIL_IMAP_HOST: "mail.sitora.nl",
  MAIL_IMAP_PORT: 993,
  MAIL_IMAP_SECURE: true,
  MAIL_USERNAME: "info@sitora.nl",
  MAIL_PASSWORD: "secret",
  MAIL_BOUNCE_ADDRESS: undefined,
  MAIL_SENT_FOLDER: undefined,
}) }));
vi.mock("@/lib/email/delivery", () => ({ appendToSentItems, compileColdEmail, sendCompiledColdEmail }));
vi.mock("@/lib/email/recipient-validation", () => ({
  assertRecipientDomainCanReceiveMail,
  UndeliverableRecipientDomainError: class UndeliverableRecipientDomainError extends Error {
    constructor(public readonly domain: string) {
      super(`Het e-maildomein ${domain} heeft geen geldige mailserver.`);
      this.name = "UndeliverableRecipientDomainError";
    }
  },
}));

import { deliverColdEmail } from "@/lib/email/service";
import { UndeliverableRecipientDomainError } from "@/lib/email/recipient-validation";

describe("cold-email verzendstatus", () => {
  beforeEach(() => {
    Object.assign(state, {
      status: "PENDING", attempts: 0, archiveAttempts: 0, messageId: null,
      rawMessageBase64: null, smtpAcceptedAt: null, archivedAt: null, lastError: null,
    });
    vi.clearAllMocks();
    assertRecipientDomainCanReceiveMail.mockResolvedValue(undefined);
  });

  it("wijzigt de pipeline pas na opslag in Verzonden items en verstuurt bij een archiefretry niet dubbel", async () => {
    appendToSentItems.mockRejectedValueOnce(new Error("IMAP tijdelijk niet beschikbaar"));
    const now = fromZonedTime("2026-08-04T10:00:00", "Europe/Amsterdam");

    await expect(deliverColdEmail("mail-1", now)).rejects.toThrow("IMAP tijdelijk niet beschikbaar");
    expect(sendCompiledColdEmail).toHaveBeenCalledTimes(1);
    expect(leadUpdate).not.toHaveBeenCalled();
    expect(state.status).toBe("SENT_PENDING_ARCHIVE");

    appendToSentItems.mockResolvedValueOnce({ folder: "Sent", uid: 42 });
    await expect(deliverColdEmail("mail-1", now)).resolves.toMatchObject({ status: "SENT" });
    expect(sendCompiledColdEmail).toHaveBeenCalledTimes(1);
    expect(leadUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "lead-1" },
      data: expect.objectContaining({ pipelineStageId: "pipeline-gemaild", legacyStatus: "QUOTE_SENT" }),
    }));
  });

  it("verstuurt niet naar een domein zonder mailserver en onderdrukt die lead", async () => {
    assertRecipientDomainCanReceiveMail.mockRejectedValueOnce(new UndeliverableRecipientDomainError("bestaat-niet.invalid"));
    const now = fromZonedTime("2026-08-04T10:00:00", "Europe/Amsterdam");

    await expect(deliverColdEmail("mail-1", now)).resolves.toMatchObject({ status: "CANCELLED" });

    expect(sendCompiledColdEmail).not.toHaveBeenCalled();
    expect(state.status).toBe("CANCELLED");
    expect(leadUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "lead-1" },
      data: expect.objectContaining({ isSuppressed: true, isActive: false, emailMxVerified: false }),
    }));
  });
});
