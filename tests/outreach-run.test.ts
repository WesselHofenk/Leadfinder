import { beforeEach, describe, expect, it, vi } from "vitest";

type LeadState = { id: string; companyName: string; email: string; status: string; leadType?: "NO_WEBSITE" | "OUTDATED_WEBSITE" };
type OutreachState = {
  id: string;
  leadId: string;
  recipientEmail: string;
  companyName: string;
  subject: string;
  body: string;
  dateKey: string;
  status: string;
  sentAt?: Date;
  messageId?: string;
  lastError?: string;
  attemptCount?: number;
  nextAttemptAt?: Date | null;
  providerAcceptedAt?: Date | null;
  archivedAt?: Date | null;
  sentMailbox?: string | null;
};

const state = vi.hoisted(() => {
  const leads: LeadState[] = [];
  const outreach: OutreachState[] = [];
  const historyCreate = vi.fn(async () => ({}));
  const activityCreate = vi.fn(async () => ({}));
  const release = vi.fn(async () => ({ count: 1 }));
  const coldTask = {
    id: "cold-email-continuous", name: "Cold emails automatisch versturen", enabled: true, status: "ACTIVE",
    timeZone: "Europe/Amsterdam", windowStartHour: 9, windowEndHour: 17, rampStartDate: "2026-08-10",
    startDailyLimit: 20, weeklyIncrement: 10, maximumDailyLimit: 100, lastSuccessfulSentAt: null, lastHeartbeatAt: null, lastError: null,
  };
  const findFirst = vi.fn(async (args?: unknown) => {
    void args;
    return leads.find((lead) => lead.status === "NEW" && !outreach.some((item) => item.leadId === lead.id || item.recipientEmail === lead.email)) ?? null;
  });
  const outreachUpdate = vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<OutreachState> }) => {
    const item = outreach.find((candidate) => candidate.id === where.id);
    if (!item) throw new Error("outreach ontbreekt");
    Object.assign(item, data);
    return item;
  });
  const leadUpdate = vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<LeadState> }) => {
    const lead = leads.find((candidate) => candidate.id === where.id);
    if (!lead) throw new Error("lead ontbreekt");
    Object.assign(lead, data);
    return lead;
  });
  return { leads, outreach, historyCreate, activityCreate, release, findFirst, outreachUpdate, leadUpdate, coldTask };
});

const { leads, outreach, historyCreate, activityCreate, release, findFirst } = state;

vi.mock("@/lib/env", () => ({ serverEnv: () => ({
  OUTREACH_ENABLED: true,
  OUTREACH_TIME_ZONE: "Europe/Amsterdam",
  OUTREACH_DAILY_LIMIT: 10,
  OUTREACH_SENDER_NAME: "Wessel Hofenk",
  SMTP_HOST: "mail.zxcs.nl",
  SMTP_PORT: 465,
  SMTP_SECURE: true,
  SMTP_USER: "info@sitora.nl",
  SMTP_PASSWORD: "test-secret",
  SMTP_FROM_EMAIL: "info@sitora.nl",
  SMTP_REPLY_TO: "info@sitora.nl",
  IMAP_HOST: "mail.zxcs.nl",
  IMAP_PORT: 993,
  IMAP_SECURE: true,
  IMAP_SENT_MAILBOX: undefined,
}) }));
vi.mock("@/lib/jobs/lock", () => ({ acquireJobLock: vi.fn(async () => ({ owner: "test", release: state.release })) }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  outreachEmail: {
    findMany: vi.fn(async (args?: { where?: { status?: string; providerAcceptedAt?: unknown } }) => args?.where?.providerAcceptedAt
      ? state.outreach.filter((item) => item.status === "RESERVED" && item.providerAcceptedAt && !item.archivedAt)
      : args?.where?.status === "SENT"
        ? state.outreach.filter((item) => item.status === "SENT").map(({ leadId, recipientEmail, companyName, subject, body }) => ({ leadId, recipientEmail, companyName, subject, body }))
        : state.outreach.map(({ recipientEmail }) => ({ recipientEmail }))),
    findFirst: vi.fn(async () => null),
    create: vi.fn(async ({ data }: { data: Omit<OutreachState, "id" | "status"> }) => {
      const item: OutreachState = { ...data, id: `outreach-${state.outreach.length + 1}`, status: "RESERVED" };
      state.outreach.push(item);
      return item;
    }),
    update: state.outreachUpdate,
    count: vi.fn(async ({ where }: { where: { dateKey: string; status?: string; OR?: unknown[] } }) => state.outreach.filter((item) => {
      if (item.dateKey !== where.dateKey) return false;
      if (where.status) return item.status === where.status;
      if (where.OR) return item.status === "SENT" || Boolean(item.providerAcceptedAt);
      return true;
    }).length),
  },
  coldEmailTask: {
    upsert: vi.fn(async () => state.coldTask),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(state.coldTask, data)),
  },
  lead: { findFirst: state.findFirst },
  $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({
    outreachEmail: { update: state.outreachUpdate },
    lead: { update: state.leadUpdate },
    leadHistory: { create: state.historyCreate },
    leadActivity: { create: state.activityCreate },
  })),
} }));

import { resendTodayOutreach, runDailyOutreach, sendOutreachTestEmail } from "@/lib/jobs/outreach";

describe("uitvoering dagelijkse cold-emailrun", () => {
  beforeEach(() => {
    leads.splice(0, leads.length, ...Array.from({ length: 21 }, (_, index) => ({
      id: `lead-${index + 1}`,
      companyName: `Bedrijf ${index + 1}`,
      email: `info${index + 1}@voorbeeld.nl`,
      status: "NEW",
      leadType: index % 2 === 0 ? "NO_WEBSITE" as const : "OUTDATED_WEBSITE" as const,
    })));
    outreach.splice(0);
    vi.clearAllMocks();
  });

  it("mailt twintig unieke leads uit Nieuw en wisselt de twee templates af", async () => {
    const sendMail = vi.fn(async (message: { to: string; text: string }) => ({ accepted: [message.to], rejected: [], messageId: `message-${message.to}` }));
    const result = await runDailyOutreach({
      now: new Date("2026-08-10T07:30:00Z"),
      campaign: "NEW_PIPELINE",
      transporter: { sendMail } as never,
      archiveSent: vi.fn(async () => ({ mailbox: "Sent" })),
    });

    expect(result).toMatchObject({ status: "complete", sent: 20, sentToday: 20, dailyLimit: 20 });
    expect(sendMail).toHaveBeenCalledTimes(20);
    expect(new Set(sendMail.mock.calls.map(([message]) => message.to)).size).toBe(20);
    expect(sendMail.mock.calls[0][0]).not.toHaveProperty("html");
    expect(sendMail.mock.calls[0][0].text).toContain("Ik zocht Bedrijf 1 online");
    expect(sendMail.mock.calls[1][0].text).toContain("website van Bedrijf 2");
    expect(leads.filter((lead) => lead.status === "EMAILED")).toHaveLength(20);
    expect(leads.at(-1)?.status).toBe("NEW");
    expect(outreach.filter((item) => item.status === "SENT")).toHaveLength(20);
    expect(historyCreate).toHaveBeenCalledTimes(20);
    expect(activityCreate).toHaveBeenCalledTimes(20);
    expect(release).toHaveBeenCalledOnce();
    const firstQuery = findFirst.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(firstQuery.where).toMatchObject({
      status: "NEW",
      isActive: true,
      isFiltered: false,
      isSuppressed: false,
      doNotContact: false,
      emailValidationStatus: "DELIVERABLE",
    });
    expect(firstQuery.where).toHaveProperty("websiteStatus");
  });

  it("verstuurd in de eerste geplande uurronde alleen het evenredige dagdeel", async () => {
    const sendMail = vi.fn(async (message: { to: string }) => ({ accepted: [message.to], rejected: [], messageId: `message-${message.to}` }));

    const result = await runDailyOutreach({
      now: new Date("2026-08-10T07:30:00Z"),
      campaign: "NEW_PIPELINE",
      scheduled: true,
      transporter: { sendMail } as never,
    });

    expect(result).toMatchObject({ status: "complete", sent: 3, sentToday: 3, dailyLimit: 20, batchTarget: 3 });
    expect(sendMail).toHaveBeenCalledTimes(3);
  });

  it("laat een lead in Nieuw staan wanneer de mailserver het bericht weigert", async () => {
    let call = 0;
    const sendMail = vi.fn(async (message: { to: string }) => {
      call += 1;
      if (call === 1) return { accepted: [], rejected: [message.to], messageId: "rejected" };
      return { accepted: [message.to], rejected: [], messageId: `message-${message.to}` };
    });
    const result = await runDailyOutreach({
      now: new Date("2026-08-10T07:30:00Z"),
      transporter: { sendMail } as never,
      archiveSent: vi.fn(async () => ({ mailbox: "Sent" })),
    });

    expect(result.sent).toBe(20);
    expect(sendMail).toHaveBeenCalledTimes(21);
    expect(leads[0].status).toBe("NEW");
    expect(outreach[0].status).toBe("FAILED");
    expect(outreach.filter((item) => item.status === "SENT")).toHaveLength(20);
  });

  it("verstuurt een geaccepteerde mail niet opnieuw wanneer alleen archivering eerst mislukt", async () => {
    const sendMail = vi.fn(async (message: { to: string }) => ({ accepted: [message.to], rejected: [], messageId: `message-${message.to}` }));
    let firstArchive = true;
    const archiveSent = vi.fn(async () => {
      if (firstArchive) {
        firstArchive = false;
        throw new Error("IMAP tijdelijk niet bereikbaar");
      }
      return { mailbox: "Sent" };
    });

    const firstRun = await runDailyOutreach({
      now: new Date("2026-08-10T07:30:00Z"),
      transporter: { sendMail } as never,
      archiveSent,
    });

    expect(firstRun).toMatchObject({ status: "complete", sent: 19, sentToday: 19, acceptedToday: 20 });
    expect(firstRun.archiveFailures).toHaveLength(1);
    expect(sendMail).toHaveBeenCalledTimes(20);
    expect(outreach[0]).toMatchObject({ status: "RESERVED", providerAcceptedAt: expect.any(Date) });
    expect(outreach[0].archivedAt ?? null).toBeNull();
    expect(leads[0].status).toBe("NEW");

    const secondRun = await runDailyOutreach({
      now: new Date("2026-08-10T08:00:00Z"),
      transporter: { sendMail } as never,
      archiveSent,
    });

    expect(secondRun).toMatchObject({ status: "complete", recoveredArchives: 1, sentToday: 20, acceptedToday: 20 });
    expect(sendMail).toHaveBeenCalledTimes(20);
    expect(outreach[0]).toMatchObject({ status: "SENT", archivedAt: expect.any(Date), sentMailbox: "Sent" });
    expect(leads[0].status).toBe("EMAILED");
  });

  it("stuurt de testmail uitsluitend naar Wessels vaste adres zonder pipelinewijziging", async () => {
    const sendMail = vi.fn(async (message: { to: string }) => ({ accepted: [message.to], messageId: "test-message" }));
    const archiveSent = vi.fn(async () => ({ mailbox: "Sent" }));

    await expect(sendOutreachTestEmail({ transporter: { sendMail } as never, archiveSent })).resolves.toMatchObject({
      status: "sent",
      recipient: "Wesselhofenk0@gmail.com",
      companyName: "WesScales",
      archived: true,
      sentMailbox: "Sent",
    });
    expect(sendMail).toHaveBeenCalledOnce();
    expect(sendMail.mock.calls[0]?.[0]).toMatchObject({
      to: "Wesselhofenk0@gmail.com",
      text: expect.stringContaining("Ik zocht WesScales online"),
    });
    expect(leads.every((lead) => lead.status === "NEW")).toBe(true);
    expect(outreach).toHaveLength(0);
    expect(archiveSent).toHaveBeenCalledOnce();
  });

  it("kan één expliciete extra batch van vijf nieuwe leads versturen zonder eerdere ontvangers te dubbelen", async () => {
    leads.splice(0, leads.length, ...Array.from({ length: 10 }, (_, index) => ({
      id: `lead-${index + 1}`,
      companyName: `Bedrijf ${index + 1}`,
      email: `info${index + 1}@voorbeeld.nl`,
      status: index < 5 ? "EMAILED" : "NEW",
    })));
    outreach.splice(0, outreach.length, ...Array.from({ length: 5 }, (_, index) => ({
      id: `outreach-${index + 1}`,
      leadId: `lead-${index + 1}`,
      recipientEmail: `info${index + 1}@voorbeeld.nl`,
      companyName: `Bedrijf ${index + 1}`,
      subject: "online uitstraling",
      body: "Eerder bericht",
      dateKey: "2026-08-02",
      status: "SENT",
    })));
    const sendMail = vi.fn(async (message: { to: string }) => ({ accepted: [message.to], messageId: `message-${message.to}` }));

    const result = await runDailyOutreach({
      now: new Date("2026-08-02T12:00:00Z"),
      campaign: "OUTDATED_WEBSITE",
      additionalBatchSize: 5,
      transporter: { sendMail } as never,
    });

    expect(result).toMatchObject({ status: "complete", sent: 5, sentToday: 10, batchTarget: 10 });
    expect(sendMail).toHaveBeenCalledTimes(5);
    expect(sendMail.mock.calls.map(([message]) => message.to)).toEqual([
      "info6@voorbeeld.nl", "info7@voorbeeld.nl", "info8@voorbeeld.nl", "info9@voorbeeld.nl", "info10@voorbeeld.nl",
    ]);
  });

  it("zet een opnieuw gemailde lead vanuit iedere pipelinefase terug naar Gemaild", async () => {
    leads.splice(0, leads.length, {
      id: "lead-1",
      companyName: "Café Maxwell",
      email: "info@maxwellcafe.nl",
      status: "QUOTE_SENT",
      leadType: "OUTDATED_WEBSITE",
    });
    outreach.splice(0, outreach.length, {
      id: "outreach-1",
      leadId: "lead-1",
      recipientEmail: "info@maxwellcafe.nl",
      companyName: "Café Maxwell",
      subject: "online vindbaarheid",
      body: "Eerder bericht",
      dateKey: "2026-08-06",
      status: "SENT",
    });
    const sendMail = vi.fn(async (message: { to: string }) => ({ accepted: [message.to], messageId: "resent-message" }));

    const result = await resendTodayOutreach({
      now: new Date("2026-08-06T12:00:00Z"),
      transporter: { sendMail } as never,
    });

    expect(result).toMatchObject({ requested: 1, sent: 1 });
    expect(leads[0].status).toBe("EMAILED");
    expect(activityCreate).toHaveBeenCalledOnce();
  });
});
