import "server-only";
import { Prisma } from "@prisma/client";
import { fromZonedTime } from "date-fns-tz";
import { prisma } from "@/lib/prisma";
import { acquireJobLock } from "@/lib/jobs/lock";
import { coldEmailConfig } from "./config";
import { coldEmailEligibleLeadWhere } from "./eligibility";
import { safeColdEmailError } from "./errors";
import { ensureColdEmailCampaignState, COLD_EMAIL_CAMPAIGN_ID } from "./state";
import { coldEmailTemplateForSequence, renderAutomaticColdEmail } from "./templates";
import { triggerColdEmailWorker } from "./worker";
import { requestLeadBufferRefill } from "@/lib/jobs/lead-buffer";
import {
  COLD_EMAIL_MAX_DAILY,
  coldEmailCampaignWeek,
  coldEmailDailyLimit,
  coldEmailSlot,
  localDayKey,
  nextDayKey,
  zonedDayBounds,
} from "./schedule";

const minimumLeadTimeMs = 2 * 60_000;
const minimumCatchUpSpacingMs = 3 * 60_000;
const smtpRetryLimit = 3;

function normalizeRecipient(value: string) {
  return value.trim().toLowerCase();
}

function validRecipient(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function remainingDailyColdEmailCapacity(dailyLimit: number, successful: number, active: number) {
  return Math.max(0, dailyLimit - successful - active);
}

export function coldEmailShortageReason(shortage: number, created: number) {
  if (shortage <= 0) return null;
  return created === 0 ? "no-eligible-leads" : "insufficient-eligible-leads";
}

export function remainingColdEmailSlots(
  dayKey: string,
  count: number,
  now: Date,
  timeZone: string,
  dailyLimit = COLD_EMAIL_MAX_DAILY,
) {
  return availableColdEmailSlots(dayKey, count, now, timeZone, [], dailyLimit);
}

export function availableColdEmailSlots(
  dayKey: string,
  count: number,
  now: Date,
  timeZone: string,
  occupied: Date[],
  dailyLimit = COLD_EMAIL_MAX_DAILY,
) {
  if (count <= 0 || dailyLimit <= 0) return [];
  const end = fromZonedTime(`${dayKey}T17:00:00`, timeZone);
  const earliest = new Date(Math.max(
    fromZonedTime(`${dayKey}T09:00:00`, timeZone).getTime(),
    now.getTime() + minimumLeadTimeMs,
  ));
  if (earliest >= end) return [];

  const occupiedTimes = new Set(occupied.map((slot) => slot.getTime()));
  const normal = Array.from({ length: dailyLimit }, (_, index) =>
    coldEmailSlot(dayKey, index, dailyLimit, timeZone),
  ).filter((slot) => slot >= earliest && !occupiedTimes.has(slot.getTime()));
  if (normal.length >= count) return normal.slice(0, count);

  const availableMs = end.getTime() - earliest.getTime();
  if (availableMs < count * minimumCatchUpSpacingMs) return [];
  const catchUp: Date[] = [];
  for (let index = 0; index < count; index += 1) {
    const slot = new Date(earliest.getTime() + Math.floor(((index + 0.5) * availableMs) / count));
    if (!occupiedTimes.has(slot.getTime())) catchUp.push(slot);
  }
  return catchUp.length === count ? catchUp : normal.slice(0, count);
}

export function coldEmailBatchDayKey(
  now: Date,
  timeZone: string,
  required = 1,
  dailyLimit = COLD_EMAIL_MAX_DAILY,
) {
  const today = localDayKey(now, timeZone);
  return remainingColdEmailSlots(today, required, now, timeZone, dailyLimit).length >= required
    ? today
    : nextDayKey(today);
}

export async function summarizeColdEmailRun(dayKey: string, now = new Date()) {
  const config = coldEmailConfig();
  const state = await ensureColdEmailCampaignState(now);
  const bounds = zonedDayBounds(dayKey, config.COLD_EMAIL_TIME_ZONE);
  const dailyLimit = coldEmailDailyLimit(dayKey, state.startDayKey);
  const weekNumber = coldEmailCampaignWeek(dayKey, state.startDayKey);
  const [successful, sentItemsConfirmed, movedToEmailed, failed, scheduled, remainingNewLeads] = await Promise.all([
    prisma.coldEmail.count({ where: { smtpAcceptedAt: { gte: bounds.start, lt: bounds.end } } }),
    prisma.coldEmail.count({ where: { smtpAcceptedAt: { gte: bounds.start, lt: bounds.end }, sentItemsConfirmedAt: { not: null } } }),
    prisma.coldEmail.count({ where: { smtpAcceptedAt: { gte: bounds.start, lt: bounds.end }, status: "SENT" } }),
    prisma.coldEmail.count({ where: {
      campaignId: state.id,
      campaignDayKey: dayKey,
      OR: [{ status: "CANCELLED" }, { status: "FAILED", attempts: { gte: smtpRetryLimit } }],
    } }),
    prisma.coldEmail.count({ where: { campaignId: state.id, campaignDayKey: dayKey } }),
    prisma.lead.count({ where: coldEmailEligibleLeadWhere() }),
  ]);
  const complete = successful >= dailyLimit || now >= bounds.end;
  const run = await prisma.coldEmailRun.upsert({
    where: { campaignId_dayKey: { campaignId: state.id, dayKey } },
    update: {
      weekNumber,
      dailyLimit,
      scheduled,
      successful,
      failed,
      movedToEmailed,
      sentItemsConfirmed,
      remainingNewLeads,
      status: complete ? "COMPLETE" : "RUNNING",
      finishedAt: complete ? now : null,
    },
    create: {
      campaignId: state.id,
      dayKey,
      weekNumber,
      dailyLimit,
      scheduled,
      successful,
      failed,
      movedToEmailed,
      sentItemsConfirmed,
      remainingNewLeads,
      status: complete ? "COMPLETE" : "RUNNING",
      finishedAt: complete ? now : null,
    },
  });
  return {
    ...run,
    nextWeekLimit: Math.min(COLD_EMAIL_MAX_DAILY, dailyLimit + 10),
  };
}

export async function ensureDailyColdEmailBatch(now = new Date()) {
  const config = coldEmailConfig();
  const initialState = await ensureColdEmailCampaignState(now);
  const today = localDayKey(now, config.COLD_EMAIL_TIME_ZONE);
  const initialDayKey = today < initialState.startDayKey
    ? initialState.startDayKey
    : coldEmailBatchDayKey(now, config.COLD_EMAIL_TIME_ZONE);
  const lock = await acquireJobLock(`cold-email-daily-batch:${initialDayKey}`, 5 * 60_000);
  if (!lock) return { dayKey: initialDayKey, scheduled: 0, totalForDay: 0, shortage: 0, skipped: true, reason: "locked" };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const state = await ensureColdEmailCampaignState(now, tx);
      if (state.pausedUntil && state.pausedUntil > now) {
        return { dayKey: initialDayKey, dailyLimit: 0, created: [], totalForDay: 0, shortage: 0, reason: "provider-paused" };
      }
      const dayKey = initialDayKey < state.startDayKey ? state.startDayKey : initialDayKey;
      const dailyLimit = coldEmailDailyLimit(dayKey, state.startDayKey);
      if (dailyLimit === 0) {
        return { dayKey, dailyLimit, created: [], totalForDay: 0, shortage: 0, reason: "campaign-not-started" };
      }
      const bounds = zonedDayBounds(dayKey, config.COLD_EMAIL_TIME_ZONE);
      const [successfulEmails, activeEmails] = await Promise.all([
        tx.coldEmail.findMany({
          where: { smtpAcceptedAt: { gte: bounds.start, lt: bounds.end } },
          select: { id: true, scheduledFor: true },
        }),
        tx.coldEmail.findMany({
          where: {
            smtpAcceptedAt: null,
            scheduledFor: { gte: bounds.start, lt: bounds.end },
            OR: [
              { status: { in: ["PENDING", "SENDING"] } },
              { status: "FAILED", attempts: { lt: smtpRetryLimit } },
            ],
          },
          select: { id: true, scheduledFor: true },
        }),
      ]);
      const reserved = successfulEmails.length + activeEmails.length;
      const missing = remainingDailyColdEmailCapacity(dailyLimit, successfulEmails.length, activeEmails.length);
      const occupied = [...successfulEmails, ...activeEmails].map((email) => email.scheduledFor);
      const slots = availableColdEmailSlots(
        dayKey,
        missing,
        now,
        config.COLD_EMAIL_TIME_ZONE,
        occupied,
        dailyLimit,
      );
      if (missing === 0 || slots.length === 0) {
        return { dayKey, dailyLimit, created: [], totalForDay: reserved, shortage: missing, reason: missing === 0 ? null : "no-safe-slots" };
      }

      const admin = await tx.user.findFirst({
        where: { role: "ADMIN", isActive: true },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (!admin) throw new Error("Geen actieve beheerder gevonden voor de verzendaudit.");

      const leads = await tx.lead.findMany({
        where: coldEmailEligibleLeadWhere(),
        orderBy: [{ opportunityScore: "desc" }, { firstDiscoveredAt: "asc" }],
        take: Math.min(500, Math.max(slots.length * 5, slots.length)),
        select: {
          id: true,
          companyName: true,
          email: true,
          contactPersonName: true,
          contactPerson: true,
        },
      });
      const normalizedCandidates = leads.flatMap((lead) => {
        if (!lead.email) return [];
        const recipient = normalizeRecipient(lead.email);
        if (!validRecipient(recipient)) return [];
        return [{ ...lead, recipient, recipientDedupeKey: `recipient:${recipient}` }];
      });
      const existingRecipients = normalizedCandidates.length > 0
        ? await tx.coldEmail.findMany({
          where: { recipientDedupeKey: { in: normalizedCandidates.map((lead) => lead.recipientDedupeKey) } },
          select: { recipientDedupeKey: true },
        })
        : [];
      const blockedRecipients = new Set(existingRecipients.map((email) => email.recipientDedupeKey));
      const seenRecipients = new Set<string>();
      const candidates = normalizedCandidates.filter((lead) => {
        if (blockedRecipients.has(lead.recipientDedupeKey) || seenRecipients.has(lead.recipient)) return false;
        seenRecipients.add(lead.recipient);
        return true;
      }).slice(0, slots.length);

      const batchKey = `automatic-${dayKey}`;
      const created = [];
      for (let index = 0; index < candidates.length; index += 1) {
        const lead = candidates[index];
        const templateKey = coldEmailTemplateForSequence(state.templateSequence + index);
        const content = renderAutomaticColdEmail(
          templateKey,
          lead.companyName,
          lead.contactPersonName ?? lead.contactPerson,
        );
        created.push(await tx.coldEmail.create({ data: {
          leadId: lead.id,
          campaignId: state.id,
          campaignDayKey: dayKey,
          templateKey,
          dedupeKey: `lead:${lead.id}`,
          recipientDedupeKey: lead.recipientDedupeKey,
          createdById: admin.id,
          batchKey,
          fromAddress: config.COLD_EMAIL_FROM_ADDRESS,
          recipient: lead.recipient,
          subject: content.subject,
          bodyText: content.bodyText,
          scheduledFor: slots[index],
          allowOutsideWindow: false,
        } }));
      }
      if (created.length > 0) {
        await tx.coldEmailCampaign.update({
          where: { id: state.id },
          data: { templateSequence: { increment: created.length } },
        });
      }
      const shortage = Math.max(0, dailyLimit - reserved - created.length);
      const reason = coldEmailShortageReason(shortage, created.length);
      return {
        dayKey,
        dailyLimit,
        created,
        totalForDay: reserved + created.length,
        shortage,
        reason,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const queueResults = await Promise.allSettled(
      result.created.map((email) => triggerColdEmailWorker(email.id, email.scheduledFor)),
    );
    queueResults.forEach((queueResult, index) => {
      if (queueResult.status === "rejected") {
        console.error(JSON.stringify({
          step: "cold_email_queue_failed",
          emailId: result.created[index]?.id,
          message: safeColdEmailError(queueResult.reason),
        }));
      }
    });
    const summary = await summarizeColdEmailRun(result.dayKey, now);
    await requestLeadBufferRefill(`generation:email-buffer:${result.dayKey}:${result.totalForDay}`).catch((error) => {
      console.error(JSON.stringify({ step: "generation_refill_queue_failed", message: safeColdEmailError(error) }));
    });
    return {
      dayKey: result.dayKey,
      dailyLimit: result.dailyLimit,
      scheduled: result.created.length,
      totalForDay: result.totalForDay,
      shortage: result.shortage,
      skipped: Boolean(result.reason) && result.created.length === 0,
      reason: result.reason,
      summary,
    };
  } finally {
    await lock.release();
  }
}

export { COLD_EMAIL_CAMPAIGN_ID };
