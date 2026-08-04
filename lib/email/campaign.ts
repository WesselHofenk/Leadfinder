import "server-only";
import { Prisma, type WebsiteStatus } from "@prisma/client";
import { fromZonedTime } from "date-fns-tz";
import { prisma } from "@/lib/prisma";
import { acquireJobLock } from "@/lib/jobs/lock";
import { coldEmailConfig } from "./config";
import { triggerColdEmailWorker } from "./worker";
import {
  COLD_EMAIL_MAX_DAILY,
  coldEmailSlot,
  localDayKey,
  zonedDayBounds,
} from "./schedule";

const activeEmailStatuses = ["PENDING", "SENDING", "SENT_PENDING_ARCHIVE", "SENT", "FAILED"] as const;
const minimumLeadTimeMs = 2 * 60_000;

function safeInline(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function automaticColdEmailSubject(companyName: string) {
  return `Online vindbaarheid voor ${safeInline(companyName).slice(0, 100)}`;
}

export function automaticColdEmailBody(companyName: string, city: string, websiteStatus: WebsiteStatus) {
  const company = safeInline(companyName);
  const place = safeInline(city);
  const observation = websiteStatus === "NO_WEBSITE_CONFIRMED"
    ? `Ik kwam ${company} in ${place} tegen en zag dat er nog geen eigen website bij uw bedrijfsvermelding staat.`
    : `Ik kwam ${company} in ${place} tegen en zag kansen om uw online presentatie duidelijker en makkelijker vindbaar te maken.`;
  return `Beste ondernemer,

${observation}

Met Sitora help ik lokale ondernemers aan een duidelijke website, zodat potentiële klanten het bedrijf beter online kunnen vinden en gemakkelijk contact kunnen opnemen.

Zal ik vrijblijvend een kort voorstel sturen voor ${company}?

Met vriendelijke groet,

Sitora
info@sitora.nl

Geen interesse? Antwoord met "afmelden"; dan ontvangt u geen verdere e-mails.`;
}

export function remainingColdEmailSlots(dayKey: string, count: number, now: Date, timeZone: string) {
  if (count <= 0) return [];
  const end = fromZonedTime(`${dayKey}T17:00:00`, timeZone);
  const earliest = new Date(Math.max(
    fromZonedTime(`${dayKey}T09:00:00`, timeZone).getTime(),
    now.getTime() + minimumLeadTimeMs,
  ));
  if (earliest >= end) return [];

  const normal = Array.from({ length: COLD_EMAIL_MAX_DAILY }, (_, index) =>
    coldEmailSlot(dayKey, index, COLD_EMAIL_MAX_DAILY, timeZone),
  ).filter((slot) => slot >= earliest);
  if (normal.length >= count) return normal.slice(0, count);

  const availableMs = end.getTime() - earliest.getTime();
  return Array.from({ length: count }, (_, index) => new Date(
    earliest.getTime() + Math.floor(((index + 0.5) * availableMs) / count),
  ));
}

export async function ensureDailyColdEmailBatch(now = new Date()) {
  const config = coldEmailConfig();
  const dayKey = localDayKey(now, config.COLD_EMAIL_TIME_ZONE);
  if (dayKey < config.COLD_EMAIL_WARMUP_START) {
    return { dayKey, scheduled: 0, totalForDay: 0, shortage: 0, skipped: true, reason: "warmup-not-started" };
  }

  const lock = await acquireJobLock(`cold-email-daily-batch:${dayKey}`, 5 * 60_000);
  if (!lock) return { dayKey, scheduled: 0, totalForDay: 0, shortage: 0, skipped: true, reason: "locked" };
  try {
    const bounds = zonedDayBounds(dayKey, config.COLD_EMAIL_TIME_ZONE);
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.coldEmail.count({
        where: { scheduledFor: { gte: bounds.start, lt: bounds.end }, status: { in: [...activeEmailStatuses] } },
      });
      const missing = Math.max(0, COLD_EMAIL_MAX_DAILY - existing);
      const slots = remainingColdEmailSlots(dayKey, missing, now, config.COLD_EMAIL_TIME_ZONE);
      if (missing === 0 || slots.length === 0) {
        return { created: [], totalForDay: existing, shortage: missing };
      }

      const admin = await tx.user.findFirst({
        where: { role: "ADMIN", isActive: true },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (!admin) throw new Error("Geen actieve beheerder gevonden voor de verzendaudit.");

      const leads = await tx.lead.findMany({
        where: {
          country: "NL",
          source: { not: "MANUAL" },
          isActive: true,
          isFiltered: false,
          isSuppressed: false,
          doNotContact: false,
          email: { not: null },
          emailMxVerified: true,
          pipelineStage: { is: { slug: "nieuw" } },
          coldEmails: { none: { status: { not: "CANCELLED" } } },
        },
        orderBy: [{ opportunityScore: "desc" }, { firstDiscoveredAt: "asc" }],
        take: slots.length,
        select: { id: true, companyName: true, city: true, email: true, websiteStatus: true },
      });

      const batchKey = `automatic-${dayKey}`;
      const created = [];
      for (let index = 0; index < leads.length; index += 1) {
        const lead = leads[index];
        if (!lead.email) continue;
        created.push(await tx.coldEmail.create({ data: {
          leadId: lead.id,
          createdById: admin.id,
          batchKey,
          fromAddress: config.COLD_EMAIL_FROM_ADDRESS,
          recipient: lead.email,
          subject: automaticColdEmailSubject(lead.companyName),
          bodyText: automaticColdEmailBody(lead.companyName, lead.city, lead.websiteStatus),
          scheduledFor: slots[index],
          allowOutsideWindow: false,
        } }));
      }
      return {
        created,
        totalForDay: existing + created.length,
        shortage: Math.max(0, COLD_EMAIL_MAX_DAILY - existing - created.length),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    for (const email of result.created) {
      await triggerColdEmailWorker(email.id, email.scheduledFor);
    }
    return {
      dayKey,
      scheduled: result.created.length,
      totalForDay: result.totalForDay,
      shortage: result.shortage,
      skipped: false,
    };
  } finally {
    await lock.release();
  }
}
