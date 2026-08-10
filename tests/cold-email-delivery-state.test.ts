import { beforeEach, describe, expect, it, vi } from "vitest";
import { fromZonedTime } from "date-fns-tz";

vi.mock("server-only", () => ({}));

const { state, appendToSentItems, compileColdEmail, findSentItemByMessageId, sendCompiledColdEmail, assertRecipientDomainCanReceiveMail, leadUpdate, prismaMock, acquireJobLock } = vi.hoisted(() => {
  const state = {
    id: "mail-1",
    leadId: "lead-1",
    campaignId: "sitora-cold-email",
    campaignDayKey: "2026-08-04",
    templateKey: "A",
    dedupeKey: "lead:lead-1",
    recipientDedupeKey: "recipient:info@bedrijf.nl",
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
    sentFolder: null as string | null,
    sentUid: null as string | null,
    sentItemsConfirmedAt: null as Date | null,
    failureCategory: null as string | null,
    lastError: null as string | null,
    createdAt: new Date("2026-08-03T10:00:00.000Z"),
    updatedAt: new Date("2026-08-03T10:00:00.000Z"),
  };
  const appendToSentItems = vi.fn();
  const findSentItemByMessageId = vi.fn(async () => null);
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
  const claimUpdateMany = vi.fn(async () => {
    if (!["PENDING", "FAILED"].includes(state.status) || state.attempts >= 3 || state.smtpAcceptedAt) return { count: 0 };
    state.status = "SENDING";
    state.attempts += 1;
    return { count: 1 };
  });
  const tx = {
    coldEmail: {
      findUniqueOrThrow: vi.fn(async () => ({
        ...state,
        lead: {
          id: "lead-1",
          companyName: "Bedrijf BV",
          email: "info@bedrijf.nl",
          isActive: true,
          isFiltered: false,
          isSuppressed: false,
          doNotContact: false,
          pipelineStage: { id: "pipeline-nieuw", slug: "nieuw" },
        },
      })),
      update: coldEmailUpdate,
      updateMany: claimUpdateMany,
    },
    pipelineStage: { findFirstOrThrow: vi.fn(async () => ({ id: "pipeline-gemaild", slug: "gemaild" })) },
    lead: {
      update: leadUpdate,
      findUniqueOrThrow: vi.fn(async () => ({ companyName: "Bedrijf BV", pipelineStage: { slug: "nieuw" } })),
    },
    coldEmailCampaign: { upsert: vi.fn(async () => ({ id: "sitora-cold-email", startDayKey: "2026-08-04", templateSequence: 0, pausedUntil: null })) },
    leadActivity: { create: vi.fn(async () => ({})) },
    leadHistory: { create: vi.fn(async () => ({})) },
  };
  const prismaMock = {
    coldEmail: {
      findUniqueOrThrow: vi.fn(async () => ({ ...state })),
      updateMany: claimUpdateMany,
      update: coldEmailUpdate,
    },
    coldEmailCampaign: {
      upsert: vi.fn(async () => ({ id: "sitora-cold-email", startDayKey: "2026-08-04", templateSequence: 0, pausedUntil: null })),
      update: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
  };
  const acquireJobLock = vi.fn(async () => ({ release: vi.fn(async () => ({ count: 1 })) }));
  return { state, appendToSentItems, compileColdEmail, findSentItemByMessageId, sendCompiledColdEmail, assertRecipientDomainCanReceiveMail, leadUpdate, coldEmailUpdate, prismaMock, acquireJobLock };
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/jobs/lock", () => ({ acquireJobLock }));
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
vi.mock("@/lib/email/delivery", () => ({ appendToSentItems, compileColdEmail, findSentItemByMessageId, sendCompiledColdEmail }));
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
      rawMessageBase64: null, smtpAcceptedAt: null, archivedAt: null, sentFolder: null,
      sentUid: null, sentItemsConfirmedAt: null, failureCategory: null, lastError: null,
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
