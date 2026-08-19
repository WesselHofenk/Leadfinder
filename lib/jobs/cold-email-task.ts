import "server-only";

import { addDays, format, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import { coldEmailConfig } from "@/lib/email/config";
import { coldEmailCampaignWeek, coldEmailDailyLimit, localDayKey, zonedDayBounds } from "@/lib/email/schedule";
import { COLD_EMAIL_CAMPAIGN_ID, ensureColdEmailCampaignState } from "@/lib/email/state";
import { coldEmailEligibleLeadWhere } from "@/lib/email/eligibility";
import { prisma } from "@/lib/prisma";

export async function getColdEmailTaskSnapshot(now = new Date()) {
  const config = coldEmailConfig();
  const campaign = await ensureColdEmailCampaignState(now);
  const dayKey = localDayKey(now, config.COLD_EMAIL_TIME_ZONE);
  const nextWeekDayKey = format(addDays(parseISO(dayKey), 7), "yyyy-MM-dd");
  const bounds = zonedDayBounds(dayKey, config.COLD_EMAIL_TIME_ZONE);
  const [sentToday, failedToday, availableLeads, lastSent, nextPending] = await Promise.all([
    prisma.coldEmail.count({ where: { smtpAcceptedAt: { gte: bounds.start, lt: bounds.end } } }),
    prisma.coldEmail.count({ where: {
      campaignId: COLD_EMAIL_CAMPAIGN_ID,
      campaignDayKey: dayKey,
      OR: [{ status: "CANCELLED" }, { status: "FAILED", attempts: { gte: 3 } }],
    } }),
    prisma.lead.count({ where: coldEmailEligibleLeadWhere() }),
    prisma.coldEmail.findFirst({
      where: { smtpAcceptedAt: { not: null } },
      orderBy: { smtpAcceptedAt: "desc" },
      select: { smtpAcceptedAt: true },
    }),
    prisma.coldEmail.findFirst({
      where: { status: { in: ["PENDING", "SENDING"] }, scheduledFor: { gte: now } },
      orderBy: { scheduledFor: "asc" },
      select: { scheduledFor: true },
    }),
  ]);

  const dailyLimit = coldEmailDailyLimit(dayKey, campaign.startDayKey);
  const bottleneckCode = sentToday < dailyLimit && availableLeads === 0 && !nextPending
    ? "NIEUW_EMPTY"
    : null;
  return {
    task: {
      ...campaign,
      timeZone: config.COLD_EMAIL_TIME_ZONE,
      windowStartHour: 9,
      windowEndHour: 17,
      lastError: campaign.lastProviderError,
    },
    sentToday,
    dailyLimit,
    nextWeekLimit: coldEmailDailyLimit(nextWeekDayKey, campaign.startDayKey),
    weekLevel: coldEmailCampaignWeek(dayKey, campaign.startDayKey),
    availableLeads,
    failedToday,
    lastSuccessfulSentAt: campaign.lastSuccessfulSentAt ?? lastSent?.smtpAcceptedAt ?? null,
    nextScheduled: nextPending
      ? formatInTimeZone(nextPending.scheduledFor, config.COLD_EMAIL_TIME_ZONE, "dd-MM-yyyy HH:mm")
      : "Nog niet ingepland",
    bottleneckCode,
    bottleneck: bottleneckCode === "NIEUW_EMPTY"
      ? `Dagdoel gepauzeerd: Nieuw bevat geen verzendbare leads (${sentToday}/${dailyLimit}).`
      : null,
  };
}
