import "server-only";
import { Prisma, type ColdEmail } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { acquireJobLock } from "@/lib/jobs/lock";
import { coldEmailConfig } from "./config";
import { appendToSentItems, compileColdEmail, sendCompiledColdEmail } from "./delivery";
import { assertRecipientDomainCanReceiveMail, UndeliverableRecipientDomainError } from "./recipient-validation";
import { triggerColdEmailWorker } from "./worker";
import {
  coldEmailDailyLimit,
  coldEmailSlot,
  immediateColdEmailAllowed,
  localDayKey,
  nextDayKey,
  withinColdEmailWindow,
  zonedDayBounds,
} from "./schedule";

const queueStatuses = ["PENDING", "SENDING", "SENT_PENDING_ARCHIVE", "SENT", "FAILED"] as const;
const smtpRetryLimit = 3;

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : "Onbekende e-mailfout").slice(0, 1000);
}

async function suppressUndeliverableRecipient(email: ColdEmail, error: UndeliverableRecipientDomainError) {
  const checkedAt = new Date();
  return prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: email.leadId }, data: {
      emailMxVerified: false,
      emailVerifiedAt: checkedAt,
      isSuppressed: true,
      isActive: false,
      isFiltered: true,
      filterReason: "EMAIL_DOMAIN_INVALID",
    } });
    await tx.leadActivity.create({ data: {
      leadId: email.leadId,
      actorId: email.createdById,
      type: "COLD_EMAIL_BLOCKED",
      summary: `E-mail niet verzonden: ${error.message}`,
      details: { coldEmailId: email.id, recipient: email.recipient, domain: error.domain },
    } });
    await tx.leadHistory.create({ data: {
      leadId: email.leadId,
      actorId: email.createdById,
      event: "COLD_EMAIL_BLOCKED",
      details: { coldEmailId: email.id, recipient: email.recipient, domain: error.domain },
    } });
    return tx.coldEmail.update({ where: { id: email.id }, data: {
      status: "CANCELLED",
      lastError: error.message,
    } });
  });
}

async function nextScheduledSlot(tx: Prisma.TransactionClient, now: Date, warmupStart: string, timeZone: string) {
  let dayKey = localDayKey(now, timeZone) < warmupStart ? warmupStart : localDayKey(now, timeZone);
  for (let dayOffset = 0; dayOffset < 366; dayOffset += 1) {
    const limit = coldEmailDailyLimit(dayKey, warmupStart);
    const bounds = zonedDayBounds(dayKey, timeZone);
    const existing = await tx.coldEmail.findMany({
      where: { scheduledFor: { gte: bounds.start, lt: bounds.end }, status: { in: [...queueStatuses] } },
      select: { scheduledFor: true },
    });
    if (existing.length < limit) {
      const occupied = new Set(existing.map((item) => item.scheduledFor.getTime()));
      for (let index = 0; index < limit; index += 1) {
        const slot = coldEmailSlot(dayKey, index, limit, timeZone);
        if (slot > now && !occupied.has(slot.getTime())) return slot;
      }
    }
    dayKey = nextDayKey(dayKey);
  }
  throw new Error("Er is geen vrij e-mailslot gevonden.");
}

export async function queueColdEmail(input: {
  leadId: string;
  userId: string;
  subject: string;
  bodyText: string;
  sendImmediately?: boolean;
  batchKey?: string;
  now?: Date;
}) {
  const config = coldEmailConfig();
  const now = input.now ?? new Date();
  const allowOutsideWindow = Boolean(input.sendImmediately)
    && immediateColdEmailAllowed(now, config.COLD_EMAIL_WARMUP_START, config.COLD_EMAIL_TIME_ZONE);
  if (input.sendImmediately && !allowOutsideWindow) {
    throw new Error("Vanaf de startdatum worden mails alleen tussen 09:00 en 17:00 ingepland.");
  }
  const email = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: input.leadId }, include: { pipelineStage: true } });
    if (!lead.email) throw new Error("Deze lead heeft geen e-mailadres.");
    if (lead.doNotContact || lead.isSuppressed || !lead.isActive) throw new Error("Deze lead mag niet per e-mail worden benaderd.");
    const alreadyQueued = await tx.coldEmail.findFirst({
      where: { leadId: lead.id, status: { in: ["PENDING", "SENDING", "SENT_PENDING_ARCHIVE"] } },
    });
    if (alreadyQueued) throw new Error("Voor deze lead staat al een e-mail klaar.");
    const scheduledFor = allowOutsideWindow
      ? now
      : await nextScheduledSlot(tx, now, config.COLD_EMAIL_WARMUP_START, config.COLD_EMAIL_TIME_ZONE);
    return tx.coldEmail.create({ data: {
      leadId: lead.id,
      createdById: input.userId,
      batchKey: input.batchKey,
      fromAddress: config.COLD_EMAIL_FROM_ADDRESS,
      recipient: lead.email,
      subject: input.subject.trim(),
      bodyText: input.bodyText.trim(),
      scheduledFor,
      allowOutsideWindow,
    } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (!allowOutsideWindow) await triggerColdEmailWorker(email.id, email.scheduledFor);
  return email;
}

async function archiveAndFinalize(email: ColdEmail) {
  const config = coldEmailConfig();
  if (!email.rawMessageBase64 || !email.smtpAcceptedAt) throw new Error("De verzonden e-mail mist zijn archiefkopie.");
  try {
    await appendToSentItems(config, Buffer.from(email.rawMessageBase64, "base64"), email.smtpAcceptedAt);
    return await prisma.$transaction(async (tx) => {
      const current = await tx.coldEmail.findUniqueOrThrow({ where: { id: email.id } });
      if (current.status === "SENT") return current;
      const emailedStage = await tx.pipelineStage.findFirstOrThrow({ where: { slug: "gemaild", isActive: true } });
      await tx.lead.update({ where: { id: email.leadId }, data: {
        pipelineStageId: emailedStage.id,
        legacyStatus: "QUOTE_SENT",
        lastContactAt: email.smtpAcceptedAt,
      } });
      await tx.leadActivity.create({ data: {
        leadId: email.leadId,
        actorId: email.createdById,
        type: "COLD_EMAIL_SENT",
        summary: `E-mail verzonden via ${email.fromAddress} en opgeslagen in Verzonden items.`,
        details: { coldEmailId: email.id, recipient: email.recipient, messageId: email.messageId },
      } });
      await tx.leadHistory.create({ data: {
        leadId: email.leadId,
        actorId: email.createdById,
        event: "COLD_EMAIL_SENT",
        details: { coldEmailId: email.id, recipient: email.recipient, messageId: email.messageId },
      } });
      return tx.coldEmail.update({ where: { id: email.id }, data: {
        status: "SENT", archivedAt: new Date(), archiveAttempts: { increment: 1 }, lastError: null,
      } });
    });
  } catch (error) {
    await prisma.coldEmail.update({ where: { id: email.id }, data: {
      status: "SENT_PENDING_ARCHIVE", archiveAttempts: { increment: 1 }, lastError: errorMessage(error),
    } });
    throw error;
  }
}

export async function deliverColdEmail(id: string, now = new Date()) {
  const config = coldEmailConfig();
  let email = await prisma.coldEmail.findUniqueOrThrow({ where: { id } });
  if (email.status === "SENT") return email;
  if (email.status === "SENT_PENDING_ARCHIVE") return archiveAndFinalize(email);
  if (!["PENDING", "FAILED"].includes(email.status)) throw new Error("Deze e-mail kan nu niet worden verwerkt.");
  if (email.scheduledFor > now) throw new Error("Het geplande verzendmoment is nog niet bereikt.");
  if (!email.allowOutsideWindow && !withinColdEmailWindow(now, config.COLD_EMAIL_TIME_ZONE)) {
    throw new Error("E-mails worden alleen tussen 09:00 en 17:00 verstuurd.");
  }
  const claimed = await prisma.coldEmail.updateMany({
    where: { id, status: { in: ["PENDING", "FAILED"] }, attempts: { lt: smtpRetryLimit }, smtpAcceptedAt: null },
    data: { status: "SENDING", attempts: { increment: 1 }, lastError: null },
  });
  if (claimed.count !== 1) throw new Error("Deze e-mail wordt al verwerkt of heeft te vaak gefaald.");
  email = await prisma.coldEmail.findUniqueOrThrow({ where: { id } });
  let smtpAccepted = false;
  try {
    await assertRecipientDomainCanReceiveMail(email.recipient);
    const sentAt = new Date();
    const compiled = await compileColdEmail(config, {
      recipient: email.recipient,
      subject: email.subject,
      bodyText: email.bodyText,
      sentAt,
      messageId: email.messageId,
    });
    email = await prisma.coldEmail.update({ where: { id }, data: {
      messageId: compiled.messageId,
      rawMessageBase64: compiled.raw.toString("base64"),
    } });
    await sendCompiledColdEmail(config, email.recipient, compiled.raw);
    smtpAccepted = true;
    email = await prisma.coldEmail.update({ where: { id }, data: {
      status: "SENT_PENDING_ARCHIVE",
      smtpAcceptedAt: sentAt,
      lastError: null,
    } });
  } catch (error) {
    if (error instanceof UndeliverableRecipientDomainError) {
      return suppressUndeliverableRecipient(email, error);
    }
    if (smtpAccepted) {
      await prisma.coldEmail.update({ where: { id }, data: {
        status: "SENT_PENDING_ARCHIVE", smtpAcceptedAt: new Date(), lastError: `SMTP geaccepteerd; archivering wordt hervat. ${errorMessage(error)}`,
      } }).catch(() => undefined);
    } else {
      let retryAt = email.scheduledFor;
      if (email.attempts < smtpRetryLimit) {
        retryAt = await prisma.$transaction(
          (tx) => nextScheduledSlot(tx, new Date(), config.COLD_EMAIL_WARMUP_START, config.COLD_EMAIL_TIME_ZONE),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ).catch(() => retryAt);
      }
      await prisma.coldEmail.update({ where: { id }, data: { status: "FAILED", scheduledFor: retryAt, lastError: errorMessage(error) } });
    }
    throw error;
  }
  return archiveAndFinalize(email);
}

export async function processColdEmailQueue(now = new Date()) {
  const lock = await acquireJobLock("cold-email-delivery", 4 * 60_000);
  if (!lock) return { processed: 0, sent: 0, failed: 0, skipped: true };
  try {
    const archiveQueue = await prisma.coldEmail.findMany({
      where: { status: "SENT_PENDING_ARCHIVE" }, orderBy: { smtpAcceptedAt: "asc" }, take: 10,
    });
    let sent = 0;
    let failed = 0;
    for (const email of archiveQueue) {
      try { await archiveAndFinalize(email); sent += 1; } catch (error) {
        failed += 1;
        console.error(JSON.stringify({ step: "cold_email_archive_failed", emailId: email.id, message: errorMessage(error) }));
      }
    }
    const config = coldEmailConfig();
    if (withinColdEmailWindow(now, config.COLD_EMAIL_TIME_ZONE)) {
      const sendQueue = await prisma.coldEmail.findMany({
        where: { status: { in: ["PENDING", "FAILED"] }, scheduledFor: { lte: now }, attempts: { lt: smtpRetryLimit } },
        orderBy: { scheduledFor: "asc" },
        take: Math.max(0, 10 - archiveQueue.length),
      });
      for (const email of sendQueue) {
        try {
          const result = await deliverColdEmail(email.id, now);
          if (result.status === "SENT") sent += 1;
          else failed += 1;
        } catch (error) {
          failed += 1;
          console.error(JSON.stringify({ step: "cold_email_delivery_failed", emailId: email.id, message: errorMessage(error) }));
        }
      }
      return { processed: archiveQueue.length + sendQueue.length, sent, failed, skipped: false };
    }
    return { processed: archiveQueue.length, sent, failed, skipped: false };
  } finally {
    await lock.release();
  }
}

export async function rescheduleStaleColdEmails(now = new Date()) {
  const lock = await acquireJobLock("cold-email-schedule-recovery", 4 * 60_000);
  if (!lock) return { found: 0, rescheduled: 0, skipped: true };
  try {
    const config = coldEmailConfig();
    const stale = await prisma.coldEmail.findMany({
      where: {
        status: { in: ["PENDING", "FAILED"] },
        scheduledFor: { lt: now },
        smtpAcceptedAt: null,
        attempts: { lt: smtpRetryLimit },
      },
      orderBy: { scheduledFor: "asc" },
      take: 10,
    });
    let rescheduled = 0;
    for (const email of stale) {
      const scheduledFor = await prisma.$transaction(
        (tx) => nextScheduledSlot(tx, now, config.COLD_EMAIL_WARMUP_START, config.COLD_EMAIL_TIME_ZONE),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      const updated = await prisma.coldEmail.updateMany({
        where: {
          id: email.id,
          status: { in: ["PENDING", "FAILED"] },
          smtpAcceptedAt: null,
        },
        data: { status: "PENDING", scheduledFor, lastError: null },
      });
      if (updated.count !== 1) continue;
      rescheduled += 1;
      await triggerColdEmailWorker(email.id, scheduledFor).catch(() => false);
    }
    return { found: stale.length, rescheduled, skipped: false };
  } finally {
    await lock.release();
  }
}
