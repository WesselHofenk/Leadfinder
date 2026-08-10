import "server-only";
import { Prisma, type ColdEmail } from "@prisma/client";
import { fromZonedTime } from "date-fns-tz";
import { prisma } from "@/lib/prisma";
import { acquireJobLock } from "@/lib/jobs/lock";
import { coldEmailConfig } from "./config";
import { appendToSentItems, compileColdEmail, findSentItemByMessageId, sendCompiledColdEmail } from "./delivery";
import { classifyColdEmailError, safeColdEmailError, shouldStopColdEmailRun } from "./errors";
import { assertRecipientDomainCanReceiveMail, UndeliverableRecipientDomainError } from "./recipient-validation";
import { ensureColdEmailCampaignState, pauseColdEmailProvider } from "./state";
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

const smtpRetryLimit = 3;

function errorMessage(error: unknown) {
  return safeColdEmailError(error);
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
      failureCategory: "INVALID_RECIPIENT",
      lastError: error.message,
    } });
  });
}

async function nextScheduledSlot(
  tx: Prisma.TransactionClient,
  now: Date,
  startDayKey: string,
  timeZone: string,
  excludeEmailId?: string,
) {
  let dayKey = localDayKey(now, timeZone) < startDayKey ? startDayKey : localDayKey(now, timeZone);
  for (let dayOffset = 0; dayOffset < 366; dayOffset += 1) {
    const limit = coldEmailDailyLimit(dayKey, startDayKey);
    const bounds = zonedDayBounds(dayKey, timeZone);
    const existing = await tx.coldEmail.findMany({
      where: {
        ...(excludeEmailId ? { id: { not: excludeEmailId } } : {}),
        scheduledFor: { gte: bounds.start, lt: bounds.end },
        OR: [
          { smtpAcceptedAt: { not: null } },
          { status: { in: ["PENDING", "SENDING", "SENT_PENDING_ARCHIVE", "SENT"] } },
          { status: "FAILED", attempts: { lt: smtpRetryLimit } },
        ],
      },
      select: { scheduledFor: true },
    });
    if (existing.length < limit) {
      const occupied = new Set(existing.map((item) => item.scheduledFor.getTime()));
      for (let index = 0; index < limit; index += 1) {
        const slot = coldEmailSlot(dayKey, index, limit, timeZone);
        if (slot > now && !occupied.has(slot.getTime())) return slot;
      }
      const earliestCatchUp = new Date(Math.max(
        now.getTime() + (3 * 60_000),
        fromZonedTime(`${dayKey}T09:00:00`, timeZone).getTime(),
      ));
      const end = fromZonedTime(`${dayKey}T17:00:00`, timeZone);
      for (let candidate = earliestCatchUp; candidate < end; candidate = new Date(candidate.getTime() + (3 * 60_000))) {
        const safelySpaced = existing.every((item) => Math.abs(item.scheduledFor.getTime() - candidate.getTime()) >= 2 * 60_000);
        if (safelySpaced) return candidate;
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
      where: {
        leadId: lead.id,
        OR: [
          { smtpAcceptedAt: { not: null } },
          { status: { in: ["PENDING", "SENDING", "SENT_PENDING_ARCHIVE", "SENT", "FAILED"] } },
        ],
      },
    });
    if (alreadyQueued) throw new Error("Deze lead is al gemaild of heeft al een duurzame verzendpoging.");
    const campaign = await ensureColdEmailCampaignState(now, tx);
    const scheduledFor = allowOutsideWindow
      ? now
      : await nextScheduledSlot(tx, now, campaign.startDayKey, config.COLD_EMAIL_TIME_ZONE);
    const recipient = lead.email.trim().toLowerCase();
    return tx.coldEmail.create({ data: {
      leadId: lead.id,
      campaignDayKey: localDayKey(scheduledFor, config.COLD_EMAIL_TIME_ZONE),
      dedupeKey: `lead:${lead.id}`,
      recipientDedupeKey: `recipient:${recipient}`,
      createdById: input.userId,
      batchKey: input.batchKey,
      fromAddress: config.COLD_EMAIL_FROM_ADDRESS,
      recipient,
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
  if (!email.rawMessageBase64 || !email.smtpAcceptedAt || !email.messageId) {
    throw new Error("De verzonden e-mail mist zijn archiefkopie of Message-ID.");
  }
  const lock = await acquireJobLock(`cold-email-archive:${email.id}`, 2 * 60_000);
  if (!lock) return prisma.coldEmail.findUniqueOrThrow({ where: { id: email.id } });
  try {
    const archived = await appendToSentItems(
      config,
      Buffer.from(email.rawMessageBase64, "base64"),
      email.smtpAcceptedAt,
      email.messageId,
    );
    const confirmedAt = new Date();
    let companyName = "";
    let pipelineStatusBefore = "";
    const finalized = await prisma.$transaction(async (tx) => {
      const current = await tx.coldEmail.findUniqueOrThrow({ where: { id: email.id } });
      if (current.status === "SENT") return current;
      const [emailedStage, lead] = await Promise.all([
        tx.pipelineStage.findFirstOrThrow({ where: { slug: "gemaild", isActive: true } }),
        tx.lead.findUniqueOrThrow({ where: { id: email.leadId }, include: { pipelineStage: true } }),
      ]);
      companyName = lead.companyName;
      pipelineStatusBefore = lead.pipelineStage.slug;
      await tx.lead.update({ where: { id: email.leadId }, data: {
        pipelineStageId: emailedStage.id,
        legacyStatus: "QUOTE_SENT",
        lastContactAt: email.smtpAcceptedAt,
      } });
      const auditDetails = {
        coldEmailId: email.id,
        recipient: email.recipient,
        template: email.templateKey,
        messageId: email.messageId,
        sentFolder: archived.folder,
        sentUid: archived.uid,
        alreadyPresent: archived.alreadyPresent,
        pipelineStatusBefore: lead.pipelineStage.slug,
        pipelineStatusAfter: emailedStage.slug,
      };
      await tx.leadActivity.create({ data: {
        leadId: email.leadId,
        actorId: email.createdById,
        type: "COLD_EMAIL_SENT",
        summary: `E-mail verzonden via ${email.fromAddress} en opgeslagen in Verzonden items.`,
        details: auditDetails,
      } });
      await tx.leadHistory.create({ data: {
        leadId: email.leadId,
        actorId: email.createdById,
        event: "COLD_EMAIL_SENT",
        details: auditDetails,
      } });
      return tx.coldEmail.update({ where: { id: email.id }, data: {
        status: "SENT",
        archivedAt: confirmedAt,
        sentItemsConfirmedAt: confirmedAt,
        sentFolder: archived.folder,
        sentUid: archived.uid,
        archiveAttempts: { increment: 1 },
        failureCategory: null,
        lastError: null,
      } });
    });
    console.log(JSON.stringify({
      step: "cold_email_sent",
      at: confirmedAt.toISOString(),
      leadId: email.leadId,
      companyName,
      recipient: email.recipient,
      template: email.templateKey,
      status: finalized.status,
      messageId: email.messageId,
      sentItemsStatus: "CONFIRMED",
      sentFolder: archived.folder,
      pipelineStatusBefore,
      pipelineStatusAfter: "gemaild",
    }));
    return finalized;
  } catch (error) {
    await prisma.coldEmail.update({ where: { id: email.id }, data: {
      status: "SENT_PENDING_ARCHIVE",
      archiveAttempts: { increment: 1 },
      failureCategory: "SENT_ITEMS",
      lastError: errorMessage(error),
    } });
    console.error(JSON.stringify({
      step: "cold_email_sent_items_failed",
      at: new Date().toISOString(),
      leadId: email.leadId,
      recipient: email.recipient,
      template: email.templateKey,
      status: "SENT_PENDING_ARCHIVE",
      providerMessageId: email.messageId,
      sentItemsStatus: "FAILED",
      failureCategory: "SENT_ITEMS",
      message: errorMessage(error),
    }));
    throw error;
  } finally {
    await lock.release();
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
  const campaign = await ensureColdEmailCampaignState(now);
  if (campaign.pausedUntil && campaign.pausedUntil > now) {
    return prisma.coldEmail.update({ where: { id }, data: {
      scheduledFor: campaign.pausedUntil,
      campaignDayKey: localDayKey(campaign.pausedUntil, config.COLD_EMAIL_TIME_ZONE),
    } });
  }
  const sendLock = await acquireJobLock("cold-email-smtp-send", 2 * 60_000);
  if (!sendLock) throw new Error("Een andere cold email wordt al veilig verwerkt.");
  let smtpAccepted = false;
  let sentAt = now;
  let companyName = "";
  try {
    const claim = await prisma.$transaction(async (tx) => {
      const current = await tx.coldEmail.findUniqueOrThrow({
        where: { id },
        include: { lead: { include: { pipelineStage: true } } },
      });
      if (current.smtpAcceptedAt) return { email: current, cancelled: false, companyName: current.lead.companyName };
      const leadEligible = current.lead.pipelineStage.slug === "nieuw"
        && current.lead.isActive
        && !current.lead.isFiltered
        && !current.lead.isSuppressed
        && !current.lead.doNotContact
        && Boolean(current.lead.email)
        && current.lead.email?.trim().toLowerCase() === current.recipient.trim().toLowerCase();
      if (!leadEligible) {
        const cancelled = await tx.coldEmail.update({ where: { id }, data: {
          status: "CANCELLED",
          failureCategory: "LEAD",
          lastError: "Lead is niet langer geschikt of staat niet meer in Nieuw.",
        } });
        return { email: cancelled, cancelled: true, companyName: current.lead.companyName };
      }
      const claimed = await tx.coldEmail.updateMany({
        where: { id, status: { in: ["PENDING", "FAILED"] }, attempts: { lt: smtpRetryLimit }, smtpAcceptedAt: null },
        data: { status: "SENDING", attempts: { increment: 1 }, failureCategory: null, lastError: null },
      });
      if (claimed.count !== 1) throw new Error("Deze e-mail wordt al verwerkt of heeft te vaak gefaald.");
      return {
        email: await tx.coldEmail.findUniqueOrThrow({ where: { id } }),
        cancelled: false,
        companyName: current.lead.companyName,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (claim.cancelled) return claim.email;
    email = claim.email;
    companyName = claim.companyName;

    await assertRecipientDomainCanReceiveMail(email.recipient);
    sentAt = new Date();
    let raw: Buffer;
    if (email.rawMessageBase64 && email.messageId) {
      raw = Buffer.from(email.rawMessageBase64, "base64");
    } else {
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
      raw = compiled.raw;
    }

    if (email.attempts > 1 && email.messageId) {
      const existingSentItem = await findSentItemByMessageId(config, email.messageId);
      if (existingSentItem) {
        email = await prisma.coldEmail.update({ where: { id }, data: {
          status: "SENT_PENDING_ARCHIVE",
          smtpAcceptedAt: email.smtpAcceptedAt ?? email.updatedAt,
          sentFolder: existingSentItem.folder,
          sentUid: existingSentItem.uid,
          sentItemsConfirmedAt: new Date(),
          failureCategory: null,
          lastError: null,
        } });
        return archiveAndFinalize(email);
      }
    }

    await sendCompiledColdEmail(config, email.recipient, raw);
    smtpAccepted = true;
    email = await prisma.coldEmail.update({ where: { id }, data: {
      status: "SENT_PENDING_ARCHIVE",
      smtpAcceptedAt: sentAt,
      failureCategory: null,
      lastError: null,
    } });
    await prisma.coldEmailCampaign.update({
      where: { id: campaign.id },
      data: { pausedUntil: null, lastProviderError: null },
    });
  } catch (error) {
    if (error instanceof UndeliverableRecipientDomainError) {
      return suppressUndeliverableRecipient(email, error);
    }
    const category = classifyColdEmailError(error);
    if (smtpAccepted) {
      await prisma.coldEmail.update({ where: { id }, data: {
        status: "SENT_PENDING_ARCHIVE",
        smtpAcceptedAt: sentAt,
        failureCategory: category,
        lastError: `SMTP geaccepteerd; archivering wordt hervat. ${errorMessage(error)}`,
      } }).catch(() => undefined);
    } else {
      let retryAt = email.scheduledFor;
      if (email.attempts < smtpRetryLimit) {
        const campaign = await ensureColdEmailCampaignState(now).catch(() => null);
        if (campaign) {
          retryAt = await prisma.$transaction(
            (tx) => nextScheduledSlot(tx, new Date(), campaign.startDayKey, config.COLD_EMAIL_TIME_ZONE, id),
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          ).catch(() => retryAt);
        }
      }
      await prisma.coldEmail.update({ where: { id }, data: {
        status: "FAILED",
        scheduledFor: retryAt,
        campaignDayKey: localDayKey(retryAt, config.COLD_EMAIL_TIME_ZONE),
        failureCategory: category,
        lastError: errorMessage(error),
      } }).catch(() => undefined);
      if (shouldStopColdEmailRun(category)) {
        await pauseColdEmailProvider(error, now).catch(() => undefined);
      }
    }
    console.error(JSON.stringify({
      step: "cold_email_delivery_failed",
      at: new Date().toISOString(),
      leadId: email.leadId,
      companyName,
      recipient: email.recipient,
      template: email.templateKey,
      status: smtpAccepted ? "SENT_PENDING_ARCHIVE" : "FAILED",
      providerMessageId: email.messageId,
      sentItemsStatus: smtpAccepted ? "PENDING" : "NOT_ATTEMPTED",
      failureCategory: category,
      message: errorMessage(error),
    }));
    throw error;
  } finally {
    await sendLock.release();
  }
  return archiveAndFinalize(email);
}

export async function processColdEmailQueue(now = new Date()) {
  const lock = await acquireJobLock("cold-email-delivery", 4 * 60_000);
  if (!lock) return { processed: 0, sent: 0, failed: 0, skipped: true };
  try {
    const archiveQueue = await prisma.coldEmail.findMany({
      where: { status: "SENT_PENDING_ARCHIVE" },
      orderBy: { smtpAcceptedAt: "asc" },
      take: 10,
    });
    let sent = 0;
    let failed = 0;
    for (const email of archiveQueue) {
      try { await archiveAndFinalize(email); sent += 1; } catch (error) {
        failed += 1;
        console.error(JSON.stringify({
          step: "cold_email_archive_failed",
          at: new Date().toISOString(),
          emailId: email.id,
          leadId: email.leadId,
          recipient: email.recipient,
          template: email.templateKey,
          failureCategory: "SENT_ITEMS",
          message: errorMessage(error),
        }));
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
          const failureCategory = classifyColdEmailError(error);
          console.error(JSON.stringify({
            step: "cold_email_delivery_failed",
            at: new Date().toISOString(),
            emailId: email.id,
            leadId: email.leadId,
            recipient: email.recipient,
            template: email.templateKey,
            failureCategory,
            message: errorMessage(error),
          }));
          if (shouldStopColdEmailRun(failureCategory)) break;
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
    const campaign = await ensureColdEmailCampaignState(now);
    const staleSendingBefore = new Date(now.getTime() - (10 * 60_000));
    const stale = await prisma.coldEmail.findMany({
      where: {
        smtpAcceptedAt: null,
        attempts: { lt: smtpRetryLimit },
        OR: [
          { status: { in: ["PENDING", "FAILED"] }, scheduledFor: { lt: now } },
          { status: "SENDING", updatedAt: { lt: staleSendingBefore } },
        ],
      },
      orderBy: { scheduledFor: "asc" },
      take: 10,
    });
    let rescheduled = 0;
    for (const email of stale) {
      const scheduledFor = await prisma.$transaction(
        (tx) => nextScheduledSlot(tx, now, campaign.startDayKey, config.COLD_EMAIL_TIME_ZONE),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      const updated = await prisma.coldEmail.updateMany({
        where: {
          id: email.id,
          status: { in: ["PENDING", "FAILED", "SENDING"] },
          smtpAcceptedAt: null,
        },
        data: {
          status: "PENDING",
          scheduledFor,
          campaignDayKey: localDayKey(scheduledFor, config.COLD_EMAIL_TIME_ZONE),
          lastError: null,
        },
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
