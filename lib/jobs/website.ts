import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { analyzeWebsite } from "@/lib/website/analyze";
import { acquireJobLock } from "./lock";

export async function queueWebsiteAnalysis(leadId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, websiteUrl: true } });
  if (!lead?.websiteUrl) throw new Error("Deze lead heeft geen website om te analyseren");
  const existing = await prisma.scanJob.findFirst({
    where: { leadId, type: "WEBSITE_ANALYSIS", status: { in: ["PENDING", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;
  return prisma.scanJob.create({ data: { leadId, type: "WEBSITE_ANALYSIS", status: "PENDING" } });
}

export async function runWebsiteAnalysisJob() {
  const lock = await acquireJobLock("website-analysis", 15 * 60_000);
  if (!lock) return { skipped: true, reason: "Er draait al een websiteanalyse" };
  try {
    const job = await prisma.scanJob.findFirst({
      where: { type: "WEBSITE_ANALYSIS", status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: new Date() }, attempt: { lt: 5 } },
      orderBy: { createdAt: "asc" }, include: { lead: true },
    });
    if (!job?.lead?.websiteUrl) return { skipped: true, reason: "Geen analysejob klaar" };
    await prisma.scanJob.update({ where: { id: job.id }, data: { status: "RUNNING", startedAt: new Date(), attempt: { increment: 1 }, errorMessage: null } });
    try {
      const result = await analyzeWebsite(job.lead.websiteUrl);
      const accepted = result.classification !== "USABLE";
      const leadType = result.classification === "OUTDATED" ? "OUTDATED_WEBSITE" : "IMPROVABLE_WEBSITE";
      const websiteStatus = result.classification === "OUTDATED" ? "OUTDATED" : result.classification === "IMPROVABLE" ? "IMPROVABLE" : "OWN_WEBSITE";
      await prisma.$transaction([
        prisma.websiteAnalysis.create({ data: {
          leadId: job.lead.id, websiteUrl: result.websiteUrl, opportunityScore: result.opportunityScore,
          mobileScore: result.mobileScore, desktopScore: result.desktopScore, conversionQualityScore: result.conversionQualityScore,
          isReachable: result.isReachable, isMobileFriendly: result.isMobileFriendly, hasContactForm: result.hasContactForm,
          hasClearCta: result.hasClearCta, hasBrokenLinks: result.hasBrokenLinks, brokenLinkCount: result.brokenLinkCount,
          hasViewportMeta: result.hasViewportMeta, hasOutdatedCopyright: result.hasOutdatedCopyright,
          hasPlaceholderContent: result.hasPlaceholderContent, hasHttps: result.hasHttps, hasInvalidSsl: result.hasInvalidSsl,
          hasBrokenImages: result.hasBrokenImages, brokenImageCount: result.brokenImageCount,
          hasLegacyTechnology: result.hasLegacyTechnology, hasTinyText: result.hasTinyText, loadTimeMs: result.loadTimeMs,
          reasons: result.reasons, rawSignals: result.rawSignals as Prisma.InputJsonValue,
        } }),
        prisma.lead.update({ where: { id: job.lead.id }, data: {
          leadType, websiteStatus, opportunityScore: result.opportunityScore, conversionQualityScore: result.conversionQualityScore,
          lastWebsiteAnalysisAt: new Date(), isActive: accepted, isFiltered: !accepted,
          status: accepted && job.lead.status === "FILTERED" ? "NEW" : job.lead.status,
          filterReason: accepted ? result.reasons[0]?.label ?? null : "Website scoort 0–29 en lijkt bruikbaar",
        } }),
        prisma.scanJob.update({ where: { id: job.id }, data: { status: "COMPLETE", finishedAt: new Date(), recordsFound: 1, recordsStored: accepted ? 1 : 0 } }),
      ]);
      return { skipped: false, leadId: job.lead.id, accepted, score: result.opportunityScore, classification: result.classification };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Websiteanalyse mislukt";
      await prisma.scanJob.update({ where: { id: job.id }, data: { status: "FAILED", finishedAt: new Date(), errorMessage: message, nextAttemptAt: new Date(Date.now() + 2 ** Math.max(1, job.attempt) * 60 * 60_000) } });
      throw error;
    }
  } finally { await lock.release(); }
}
