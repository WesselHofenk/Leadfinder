import { Prisma } from "@prisma/client";
import { ImapFlow } from "imapflow";
import nodemailer, { type Transporter } from "nodemailer";

import { serverEnv } from "@/lib/env";
import { COLD_EMAIL_TASK_ID, ensureColdEmailTask } from "@/lib/jobs/automation-tasks";
import { acquireJobLock } from "@/lib/jobs/lock";
import { prisma } from "@/lib/prisma";

const OUTREACH_SUBJECT = "online vindbaarheid";
const OUTDATED_WEBSITE_SUBJECT = "online uitstraling";
const MAX_CANDIDATE_ATTEMPTS_PER_RUN = 30;
const OUTREACH_TEST_RECIPIENT = "Wesselhofenk0@gmail.com";
const OUTREACH_TEST_COMPANY_NAME = "WesScales";
const OUTREACH_RAMP_FIRST_WEEK = "2026-08-10";
const OUTREACH_START_DAILY_LIMIT = 20;
const OUTREACH_WEEKLY_INCREMENT = 10;
const OUTREACH_DAILY_SLOTS = 8;

type ReservedOutreach = {
  outreachId: string;
  leadId: string;
  recipientEmail: string;
  companyName: string;
  subject: string;
  body: string;
};

type SentMail = {
  from: { name: string; address: string };
  replyTo: string;
  to: string;
  subject: string;
  text: string;
  headers: Record<string, string>;
  messageId?: string;
  date?: Date;
};

type ArchiveSent = (mail: SentMail) => Promise<{ mailbox: string }>;

export type ColdEmail = { subject: string; text: string };
type OutreachCampaign = "NO_WEBSITE" | "OUTDATED_WEBSITE" | "NEW_PIPELINE";

function greeting(contactPersonName?: string | null) {
  const firstName = contactPersonName?.trim().split(/\s+/)[0]?.replace(/[^\p{L}'’-]/gu, "");
  return firstName ? `Hoi ${firstName},` : "Hoi,";
}

export function buildColdEmail(input: {
  companyName: string;
  senderName: string;
  contactPersonName?: string | null;
}): ColdEmail {
  const text = `${greeting(input.contactPersonName)}

Ik zocht ${input.companyName} online en zag dat jullie nog geen eigen website hebben.

Daardoor krijgen potentiële klanten niet direct een goed beeld van wat jullie doen, waarom ze voor jullie moeten kiezen en hoe ze contact kunnen opnemen.

Ik kan vrijblijvend een voorbeeld maken van hoe zo’n website eruit zou kunnen zien. Zal ik die naar je sturen?

Groet,

${input.senderName}
Sitora`;
  return {
    subject: OUTREACH_SUBJECT,
    text,
  };
}

export function buildOutdatedWebsiteEmail(input: {
  companyName: string;
  senderName: string;
  contactPersonName?: string | null;
}): ColdEmail {
  return {
    subject: OUTDATED_WEBSITE_SUBJECT,
    text: `${greeting(input.contactPersonName)}

Ik bekeek de website van ${input.companyName} en zag dat die op een paar punten verouderd oogt.

Daardoor krijgen potentiële klanten online mogelijk niet direct het beste beeld van wat jullie doen en kan de website minder prettig werken op mobiel.

Ik heb voor jullie een voorbeeld gemaakt waarin jullie website er moderner en duidelijker uit ziet. Zal ik die naar je sturen?

Groet,

${input.senderName}
Sitora`,
  };
}

export function localOutreachTime(now: Date, timeZone = "Europe/Amsterdam") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    dateKey: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
}

export function isDailyOutreachWindow(now: Date, timeZone = "Europe/Amsterdam") {
  const { hour } = localOutreachTime(now, timeZone);
  return hour >= 9 && hour < 17;
}

export function weeklyOutreachLimit(now: Date, maximum = 100, timeZone = "Europe/Amsterdam") {
  const { dateKey } = localOutreachTime(now, timeZone);
  const currentDay = Date.parse(`${dateKey}T00:00:00Z`);
  const firstWeekDay = Date.parse(`${OUTREACH_RAMP_FIRST_WEEK}T00:00:00Z`);
  const elapsedWeeks = Math.max(0, Math.floor((currentDay - firstWeekDay) / (7 * 24 * 60 * 60 * 1000)));
  return Math.min(maximum, OUTREACH_START_DAILY_LIMIT + elapsedWeeks * OUTREACH_WEEKLY_INCREMENT);
}

export function alternatingCampaign(sentToday: number): Exclude<OutreachCampaign, "NEW_PIPELINE"> {
  return sentToday % 2 === 0 ? "NO_WEBSITE" : "OUTDATED_WEBSITE";
}

export function scheduledOutreachTarget(now: Date, dailyLimit: number, timeZone = "Europe/Amsterdam") {
  const { hour } = localOutreachTime(now, timeZone);
  if (hour < 9) return 0;
  if (hour >= 17) return dailyLimit;
  const completedSlots = hour - 8;
  return Math.ceil((dailyLimit * completedSlots) / OUTREACH_DAILY_SLOTS);
}

function safeMailError(error: unknown) {
  if (!error || typeof error !== "object") return "Onbekende verzendfout";
  const candidate = error as { code?: unknown; responseCode?: unknown; command?: unknown; message?: unknown };
  return [candidate.code, candidate.responseCode, candidate.command, candidate.message].filter((value) => typeof value === "string" || typeof value === "number").join(" · ").slice(0, 300) || "SMTP-verzending mislukt";
}

function acceptedRecipient(result: { accepted?: Array<string | { address?: string }> }, recipient: string) {
  return result.accepted?.some((value) => (typeof value === "string" ? value : value.address)?.toLowerCase() === recipient.toLowerCase()) ?? false;
}

async function rawMessage(mail: SentMail) {
  const compiler = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows" });
  const result = await compiler.sendMail(mail);
  const message = (result as unknown as { message?: Buffer }).message;
  if (!Buffer.isBuffer(message)) throw new Error("De verzonden e-mail kon niet voor IMAP worden opgebouwd.");
  return message;
}

export async function archiveSentMail(mail: SentMail) {
  const env = serverEnv();
  if (!env.SMTP_USER || !env.SMTP_PASSWORD) throw new Error("De Sitora-mailbox is nog niet gekoppeld.");

  const client = new ImapFlow({
    host: env.IMAP_HOST,
    port: env.IMAP_PORT,
    secure: env.IMAP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    logger: false,
  });
  try {
    await client.connect();
    const folders = await client.list();
    const configured = env.IMAP_SENT_MAILBOX ? folders.find((folder) => folder.path === env.IMAP_SENT_MAILBOX) : undefined;
    const sentFolder = configured
      ?? folders.find((folder) => folder.specialUse === "\\Sent")
      ?? folders.find((folder) => /^(sent|sent items|sent messages|verzonden|verzonden items)$/i.test(folder.name));
    if (!sentFolder) throw new Error("De IMAP-map Verzonden items kon niet worden gevonden.");

    if (mail.messageId) {
      await client.mailboxOpen(sentFolder.path);
      const existing = await client.search({ header: { "message-id": mail.messageId } }, { uid: true });
      if (existing && existing.length) return { mailbox: sentFolder.path };
    }

    const appended = await client.append(sentFolder.path, await rawMessage(mail), ["\\Seen"], mail.date ?? new Date());
    if (!appended) throw new Error("De e-mail kon niet aan Verzonden items worden toegevoegd.");
    return { mailbox: sentFolder.path };
  } finally {
    if (client.usable) await client.logout();
    else client.close();
  }
}

async function reserveNextLead(dateKey: string, senderName: string, campaign: OutreachCampaign): Promise<ReservedOutreach | null> {
  const contacted = await prisma.outreachEmail.findMany({ select: { recipientEmail: true } });
  const contactedEmails = contacted.map(({ recipientEmail }) => recipientEmail);
  const lead = await prisma.lead.findFirst({
    where: {
      status: "NEW",
      isActive: true,
      isFiltered: false,
      isSuppressed: false,
      doNotContact: false,
      ...(campaign === "OUTDATED_WEBSITE" ? {
        websiteStatus: "WEBSITE_OUTDATED" as const,
        websiteUrl: { not: null },
      } : campaign === "NO_WEBSITE" ? {
        websiteStatus: "NO_WEBSITE_CONFIRMED" as const,
        googleWebsitePresent: false,
        googleWebsiteVerifiedAt: { not: null },
      } : {}),
      emailValidationStatus: "DELIVERABLE",
      email: { not: null, ...(contactedEmails.length ? { notIn: contactedEmails } : {}) },
      outreachEmail: { is: null },
    },
    orderBy: [{ firstDiscoveredAt: "asc" }, { id: "asc" }],
    select: { id: true, companyName: true, contactPersonName: true, email: true, leadType: true },
  });
  if (!lead?.email) return null;

  const usesWebsiteTemplate = campaign === "OUTDATED_WEBSITE"
    || (campaign === "NEW_PIPELINE" && lead.leadType !== "NO_WEBSITE");
  const mail = (usesWebsiteTemplate ? buildOutdatedWebsiteEmail : buildColdEmail)({
    companyName: lead.companyName,
    senderName,
    contactPersonName: lead.contactPersonName,
  });
  try {
    const reservation = await prisma.outreachEmail.create({ data: {
      leadId: lead.id,
      recipientEmail: lead.email,
      companyName: lead.companyName,
      subject: mail.subject,
      body: mail.text,
      dateKey,
      attemptCount: 1,
    } });
    return {
      outreachId: reservation.id,
      leadId: lead.id,
      recipientEmail: lead.email,
      companyName: lead.companyName,
      subject: mail.subject,
      body: mail.text,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    throw error;
  }
}

async function reserveRetryLead(campaign: Exclude<OutreachCampaign, "NEW_PIPELINE">, now: Date, dateKey: string): Promise<ReservedOutreach | null> {
  const subject = campaign === "NO_WEBSITE" ? OUTREACH_SUBJECT : OUTDATED_WEBSITE_SUBJECT;
  const failed = await prisma.outreachEmail.findFirst({
    where: {
      status: "FAILED",
      subject,
      messageId: null,
      attemptCount: { lt: 5 },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      lead: { status: "NEW", isActive: true, isFiltered: false, isSuppressed: false, doNotContact: false },
    },
    orderBy: [{ nextAttemptAt: "asc" }, { reservedAt: "asc" }],
  });
  if (!failed) return null;
  const reserved = await prisma.outreachEmail.update({
    where: { id: failed.id },
    data: { status: "RESERVED", dateKey, reservedAt: now, attemptCount: { increment: 1 }, nextAttemptAt: null, lastError: null },
  });
  return {
    outreachId: reserved.id,
    leadId: reserved.leadId,
    recipientEmail: reserved.recipientEmail,
    companyName: reserved.companyName,
    subject: reserved.subject,
    body: reserved.body,
  };
}

async function markProviderAccepted(outreachId: string, messageId: string | undefined, acceptedAt: Date) {
  return prisma.outreachEmail.update({
    where: { id: outreachId },
    data: { messageId, providerAcceptedAt: acceptedAt, lastError: null },
  });
}

async function markSent(reservation: ReservedOutreach, messageId: string | undefined, mailbox: string, sentAt = new Date()) {
  await prisma.$transaction(async (tx) => {
    await tx.outreachEmail.update({ where: { id: reservation.outreachId }, data: {
      status: "SENT", sentAt, messageId, providerAcceptedAt: sentAt, archivedAt: sentAt, sentMailbox: mailbox, lastError: null, nextAttemptAt: null,
    } });
    await tx.lead.update({ where: { id: reservation.leadId }, data: { status: "EMAILED", lastContactAt: sentAt } });
    await tx.leadHistory.create({ data: {
      leadId: reservation.leadId,
      event: "COLD_EMAIL_SENT",
      details: { recipientEmail: reservation.recipientEmail, subject: reservation.subject, messageId },
    } });
    await tx.leadActivity.create({ data: {
      leadId: reservation.leadId,
      type: "EMAIL_SENT",
      summary: `Cold email verzonden naar ${reservation.recipientEmail}`,
      details: { subject: reservation.subject, messageId },
    } });
  });
}

async function markFailed(outreachId: string, error: unknown) {
  await prisma.outreachEmail.update({
    where: { id: outreachId },
    data: { status: "FAILED", lastError: safeMailError(error), nextAttemptAt: new Date(Date.now() + 15 * 60_000) },
  });
}

function mailTransport(): Transporter {
  const env = serverEnv();
  if (!env.SMTP_USER || !env.SMTP_PASSWORD) throw new Error("De Sitora-mailbox is nog niet gekoppeld.");
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

function outgoingMail(reservation: ReservedOutreach, env: ReturnType<typeof serverEnv>): SentMail {
  return {
    from: { name: `${env.OUTREACH_SENDER_NAME} van Sitora`, address: env.SMTP_FROM_EMAIL },
    replyTo: env.SMTP_REPLY_TO,
    to: reservation.recipientEmail,
    subject: reservation.subject,
    text: reservation.body,
    headers: { "X-Auto-Response-Suppress": "OOF, AutoReply" },
  };
}

async function recoverAcceptedArchives(archive: ArchiveSent, env: ReturnType<typeof serverEnv>) {
  const pending = await prisma.outreachEmail.findMany({
    where: { status: "RESERVED", providerAcceptedAt: { not: null }, messageId: { not: null }, archivedAt: null, lead: { status: "NEW" } },
    orderBy: { providerAcceptedAt: "asc" },
    take: 10,
  });
  const failures: Array<{ companyName: string; reason: string }> = [];
  let recovered = 0;
  for (const item of pending) {
    const reservation: ReservedOutreach = {
      outreachId: item.id,
      leadId: item.leadId,
      recipientEmail: item.recipientEmail,
      companyName: item.companyName,
      subject: item.subject,
      body: item.body,
    };
    try {
      const archived = await archive({ ...outgoingMail(reservation, env), messageId: item.messageId ?? undefined, date: item.providerAcceptedAt ?? new Date() });
      await markSent(reservation, item.messageId ?? undefined, archived.mailbox, item.providerAcceptedAt ?? new Date());
      recovered += 1;
    } catch (error) {
      const reason = safeMailError(error);
      await prisma.outreachEmail.update({ where: { id: item.id }, data: { lastError: `Archivering wordt opnieuw geprobeerd: ${reason}` } });
      failures.push({ companyName: item.companyName, reason });
    }
  }
  return { recovered, failures };
}

export async function verifyOutreachMailbox() {
  const env = serverEnv();
  if (!env.SMTP_USER || !env.SMTP_PASSWORD) throw new Error("De Sitora-mailbox is nog niet gekoppeld.");
  const transporter = mailTransport();
  await transporter.verify();
  return { ok: true, mailbox: env.SMTP_USER, host: env.SMTP_HOST, port: env.SMTP_PORT };
}

export async function sendOutreachTestEmail(options: { transporter?: Transporter; archiveSent?: ArchiveSent } = {}) {
  const env = serverEnv();
  if (!env.SMTP_USER || !env.SMTP_PASSWORD) throw new Error("De Sitora-mailbox is nog niet gekoppeld.");

  const mail = buildColdEmail({
    companyName: OUTREACH_TEST_COMPANY_NAME,
    senderName: env.OUTREACH_SENDER_NAME,
  });
  const outgoing: SentMail = {
    from: { name: `${env.OUTREACH_SENDER_NAME} van Sitora`, address: env.SMTP_FROM_EMAIL },
    replyTo: env.SMTP_REPLY_TO,
    to: OUTREACH_TEST_RECIPIENT,
    subject: mail.subject,
    text: mail.text,
    headers: { "X-Auto-Response-Suppress": "OOF, AutoReply" },
  };
  const result = await (options.transporter ?? mailTransport()).sendMail(outgoing);
  if (!acceptedRecipient(result, OUTREACH_TEST_RECIPIENT)) {
    throw Object.assign(new Error("De ontvangende mailserver accepteerde de testmail niet."), { code: "SMTP_NOT_ACCEPTED" });
  }
  const archive = options.archiveSent ?? (options.transporter ? async () => ({ mailbox: "TEST_SENT" }) : archiveSentMail);
  let archived = false;
  let sentMailbox: string | undefined;
  let archiveError: string | undefined;
  if (archive) {
    try {
      const archiveResult = await archive({ ...outgoing, messageId: result.messageId, date: new Date() });
      archived = true;
      sentMailbox = archiveResult.mailbox;
    } catch (error) {
      archiveError = safeMailError(error);
    }
  }

  return {
    status: "sent" as const,
    recipient: OUTREACH_TEST_RECIPIENT,
    companyName: OUTREACH_TEST_COMPANY_NAME,
    messageId: result.messageId,
    archived,
    sentMailbox,
    archiveError,
  };
}

export async function getDailyOutreachSummary(now = new Date()) {
  const task = await ensureColdEmailTask();
  const { dateKey } = localOutreachTime(now, task.timeZone);
  const dailyLimit = weeklyOutreachLimit(now, task.maximumDailyLimit, task.timeZone);
  const sent = await prisma.outreachEmail.findMany({
    where: { dateKey, status: "SENT" },
    orderBy: [{ sentAt: "asc" }, { id: "asc" }],
    select: { id: true, leadId: true, recipientEmail: true, companyName: true, subject: true, body: true, sentAt: true, messageId: true },
  });
  return { dateKey, sentToday: sent.length, dailyLimit, sent };
}

export function nextScheduledOutreach(now: Date, timeZone = "Europe/Amsterdam") {
  const { hour, minute } = localOutreachTime(now, timeZone);
  if (hour < 9) return "Vandaag 09:00";
  if (hour >= 17) return "Morgen 09:00";
  let nextHour = hour;
  let nextMinute = (Math.floor(minute / 15) + 1) * 15;
  if (nextMinute >= 60) { nextHour += 1; nextMinute = 0; }
  if (nextHour >= 17) return "Morgen 09:00";
  return `Vandaag ${String(nextHour).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}`;
}

export async function getColdEmailTaskSnapshot(now = new Date()) {
  const task = await ensureColdEmailTask();
  const { dateKey } = localOutreachTime(now, task.timeZone);
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const [sentToday, failedToday, availableLeads, lastSent] = await Promise.all([
    prisma.outreachEmail.count({ where: { dateKey, status: "SENT" } }),
    prisma.outreachEmail.count({ where: { dateKey, status: "FAILED" } }),
    prisma.lead.count({ where: {
      status: "NEW", isActive: true, isFiltered: false, isSuppressed: false, doNotContact: false,
      emailValidationStatus: "DELIVERABLE", email: { not: null }, outreachEmail: { is: null },
      OR: [
        { websiteStatus: "NO_WEBSITE_CONFIRMED", googleWebsitePresent: false, googleWebsiteVerifiedAt: { not: null } },
        { websiteStatus: "WEBSITE_OUTDATED", websiteUrl: { not: null } },
      ],
    } }),
    prisma.outreachEmail.findFirst({ where: { status: "SENT", archivedAt: { not: null } }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
  ]);
  return {
    task,
    sentToday,
    dailyLimit: weeklyOutreachLimit(now, task.maximumDailyLimit, task.timeZone),
    nextWeekLimit: weeklyOutreachLimit(nextWeek, task.maximumDailyLimit, task.timeZone),
    weekLevel: Math.max(1, Math.floor((Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${task.rampStartDate}T00:00:00Z`)) / (7 * 24 * 60 * 60 * 1000)) + 1),
    availableLeads,
    failedToday,
    lastSuccessfulSentAt: task.lastSuccessfulSentAt ?? lastSent?.sentAt ?? null,
    nextScheduled: nextScheduledOutreach(now, task.timeZone),
  };
}

export async function resendTodayOutreach(options: { now?: Date; transporter?: Transporter; archiveSent?: ArchiveSent } = {}) {
  const env = serverEnv();
  if (!env.SMTP_USER || !env.SMTP_PASSWORD) throw new Error("De Sitora-mailbox is nog niet gekoppeld.");
  const now = options.now ?? new Date();
  const { dateKey } = localOutreachTime(now, env.OUTREACH_TIME_ZONE);
  const activityType = `COLD_EMAIL_MANUAL_RESENT_${dateKey.replaceAll("-", "_")}`;
  const messages = await prisma.outreachEmail.findMany({
    where: { dateKey, status: "SENT", lead: { activities: { none: { type: activityType } } } },
    orderBy: [{ sentAt: "asc" }, { id: "asc" }],
    take: 5,
    select: { leadId: true, recipientEmail: true, companyName: true, subject: true, body: true },
  });
  const transporter = options.transporter ?? mailTransport();
  const archive: ArchiveSent = options.archiveSent ?? (options.transporter ? async () => ({ mailbox: "TEST_SENT" }) : archiveSentMail);
  const results: Array<{ companyName: string; recipientEmail: string; sent: boolean; archived: boolean; reason?: string }> = [];

  for (const message of messages) {
    const outgoing: SentMail = {
      from: { name: `${env.OUTREACH_SENDER_NAME} van Sitora`, address: env.SMTP_FROM_EMAIL },
      replyTo: env.SMTP_REPLY_TO,
      to: message.recipientEmail,
      subject: message.subject,
      text: message.body,
      headers: { "X-Auto-Response-Suppress": "OOF, AutoReply" },
    };
    try {
      const result = await transporter.sendMail(outgoing);
      if (!acceptedRecipient(result, message.recipientEmail)) throw Object.assign(new Error("De ontvangende mailserver accepteerde het bericht niet."), { code: "SMTP_NOT_ACCEPTED" });
      const resentAt = new Date();
      const archivedResult = await archive({ ...outgoing, messageId: result.messageId, date: resentAt });
      await prisma.$transaction(async (tx) => {
        await tx.lead.update({ where: { id: message.leadId }, data: { status: "EMAILED", lastContactAt: resentAt } });
        await tx.leadActivity.create({ data: {
          leadId: message.leadId,
          type: activityType,
          summary: `Cold email handmatig opnieuw verzonden naar ${message.recipientEmail}`,
          details: { subject: message.subject, messageId: result.messageId },
        } });
      });
      results.push({ companyName: message.companyName, recipientEmail: message.recipientEmail, sent: true, archived: Boolean(archivedResult.mailbox) });
    } catch (error) {
      results.push({ companyName: message.companyName, recipientEmail: message.recipientEmail, sent: false, archived: false, reason: safeMailError(error) });
    }
  }

  return {
    dateKey,
    requested: messages.length,
    sent: results.filter((result) => result.sent).length,
    archived: results.filter((result) => result.archived).length,
    results,
  };
}

export async function runDailyOutreach(options: { now?: Date; transporter?: Transporter; archiveSent?: ArchiveSent; campaign?: OutreachCampaign; additionalBatchSize?: number; scheduled?: boolean } = {}) {
  const env = serverEnv();
  const task = await ensureColdEmailTask();
  if (!env.OUTREACH_ENABLED || !task.enabled) {
    await prisma.coldEmailTask.update({ where: { id: COLD_EMAIL_TASK_ID }, data: { status: "PAUSED", lastHeartbeatAt: new Date() } });
    return { status: "disabled" as const, sent: 0 };
  }
  if (!env.SMTP_USER || !env.SMTP_PASSWORD) throw new Error("De Sitora-mailbox is nog niet gekoppeld.");

  const now = options.now ?? new Date();
  const campaign = options.campaign ?? "NEW_PIPELINE";
  const localTime = localOutreachTime(now, task.timeZone);
  const { dateKey } = localTime;
  const dailyLimit = weeklyOutreachLimit(now, task.maximumDailyLimit, task.timeZone);
  if (!isDailyOutreachWindow(now, task.timeZone)) {
    await prisma.coldEmailTask.update({ where: { id: COLD_EMAIL_TASK_ID }, data: { status: "ACTIVE", lastHeartbeatAt: now, lastError: null } });
    return {
      status: "outside_window" as const,
      sent: 0,
      dateKey,
      localHour: localTime.hour,
      dailyLimit,
    };
  }
  const lock = await acquireJobLock("daily-cold-outreach", 10 * 60_000);
  if (!lock) return { status: "already_running" as const, sent: 0, dateKey };

  const transporter = options.transporter ?? mailTransport();
  const archive = options.archiveSent ?? (options.transporter ? async () => ({ mailbox: "TEST_SENT" }) : archiveSentMail);
  await prisma.coldEmailTask.update({ where: { id: COLD_EMAIL_TASK_ID }, data: { status: "RUNNING", lastHeartbeatAt: now, lastError: null } });
  const recovery = await recoverAcceptedArchives(archive, env);
  let sentToday = await prisma.outreachEmail.count({ where: { dateKey, status: "SENT" } });
  // Legacy SENT rows predate providerAcceptedAt. Count both so a deployment can
  // never reset today's allowance and send the daily target a second time.
  let acceptedToday = await prisma.outreachEmail.count({
    where: {
      dateKey,
      OR: [{ status: "SENT" }, { providerAcceptedAt: { not: null } }],
    },
  });
  const initiallySent = sentToday;
  const batchTarget = options.scheduled
    ? scheduledOutreachTarget(now, dailyLimit, task.timeZone)
    : options.additionalBatchSize
      ? Math.min(dailyLimit, acceptedToday + Math.min(Math.max(options.additionalBatchSize, 1), 5))
      : dailyLimit;
  const failures: Array<{ companyName: string; reason: string }> = [];
  const archiveFailures: Array<{ companyName: string; reason: string }> = [...recovery.failures];
  let attempts = 0;

  try {
    while (acceptedToday < batchTarget && attempts < MAX_CANDIDATE_ATTEMPTS_PER_RUN) {
      attempts += 1;
      const selectedCampaign = campaign === "NEW_PIPELINE" ? alternatingCampaign(acceptedToday) : campaign;
      const reservation = await reserveRetryLead(selectedCampaign, now, dateKey)
        ?? await reserveNextLead(dateKey, env.OUTREACH_SENDER_NAME, selectedCampaign);
      if (!reservation) break;
      let providerAccepted = false;
      try {
        const outgoing: SentMail = { ...outgoingMail(reservation, env), messageId: `<sitora-${reservation.outreachId}@sitora.nl>` };
        const result = await transporter.sendMail(outgoing);
        if (!acceptedRecipient(result, reservation.recipientEmail)) throw Object.assign(new Error("De ontvangende mailserver accepteerde het bericht niet."), { code: "SMTP_NOT_ACCEPTED" });
        providerAccepted = true;
        acceptedToday += 1;
        const acceptedAt = new Date();
        const messageId = result.messageId || outgoing.messageId;
        await markProviderAccepted(reservation.outreachId, messageId, acceptedAt);
        const archived = await archive({ ...outgoing, messageId, date: acceptedAt });
        await markSent(reservation, messageId, archived.mailbox, acceptedAt);
        sentToday += 1;
        await prisma.coldEmailTask.update({ where: { id: COLD_EMAIL_TASK_ID }, data: { lastSuccessfulSentAt: acceptedAt, lastHeartbeatAt: acceptedAt } });
      } catch (error) {
        const reason = safeMailError(error);
        if (providerAccepted) {
          await prisma.outreachEmail.update({ where: { id: reservation.outreachId }, data: { lastError: `Provider accepteerde de mail; archivering wordt opnieuw geprobeerd: ${reason}` } });
          archiveFailures.push({ companyName: reservation.companyName, reason });
        } else {
          await markFailed(reservation.outreachId, error);
          failures.push({ companyName: reservation.companyName, reason });
        }
      }
    }
    const status = acceptedToday >= batchTarget ? "complete" as const : "insufficient_eligible_leads" as const;
    await prisma.coldEmailTask.update({
      where: { id: COLD_EMAIL_TASK_ID },
      data: {
        status: failures.length || archiveFailures.length ? "DEGRADED" : "ACTIVE",
        lastHeartbeatAt: new Date(),
        lastError: failures.at(-1)?.reason ?? archiveFailures.at(-1)?.reason ?? (status === "insufficient_eligible_leads" ? "Onvoldoende geschikte leads in Nieuw voor het huidige verzenddoel." : null),
      },
    });
    return {
      status,
      dateKey,
      campaign,
      sent: sentToday - initiallySent,
      sentToday,
      acceptedToday,
      dailyLimit,
      batchTarget,
      recoveredArchives: recovery.recovered,
      failures,
      archiveFailures,
    };
  } catch (error) {
    await prisma.coldEmailTask.update({ where: { id: COLD_EMAIL_TASK_ID }, data: { status: "ERROR", lastHeartbeatAt: new Date(), lastError: safeMailError(error) } });
    throw error;
  } finally {
    await lock.release();
  }
}
