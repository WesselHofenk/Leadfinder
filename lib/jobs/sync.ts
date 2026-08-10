
import { prisma } from "@/lib/prisma";
import type { Candidate } from "@/lib/leads/eligibility";
import { verifyWebsiteCandidate } from "@/lib/leads/website-verification";
import { createGenerationRun, markStaleGenerationRuns, processGenerationBatch } from "./generation";
import { acquireJobLock } from "./lock";
import { isBlockedLocation, visibleLeadWhere } from "@/lib/leads/blocked-location";

export async function runDiscoveryJob() {
  await markStaleGenerationRuns();
  const active = await prisma.generationRun.findFirst({ where: { status: { in: ["PENDING", "RUNNING"] } } });
  const run = active ?? await createGenerationRun();
  const deadline = Date.now() + 250_000;
  let current = run;
  do {
    current = await processGenerationBatch(run.id);
  } while (["PENDING", "RUNNING"].includes(current.status) && Date.now() < deadline);
  return {
    skipped: false,
    runId: run.id,
    status: current.status,
    found: current.candidatesFound,
    qualified: current.stored,
    sourceFailures: current.sourceFailures,
    continuationRequired: ["PENDING", "RUNNING"].includes(current.status),
  };
}

export async function reverifyStaleLeads() {
  const lock = await acquireJobLock("local-reverify");
  if (!lock) return { skipped: true, reason: "Er draait al een herverificatie" };
  try {
    const staleBefore = new Date(Date.now() - 30 * 86_400_000);
    const stale = await prisma.lead.findMany({
      where: visibleLeadWhere({ isSuppressed: false, lastVerifiedAt: { lte: staleBefore } }),
      include: { sourceRecords: { orderBy: { fetchedAt: "desc" }, take: 1 } },
      take: 20,
      orderBy: { lastVerifiedAt: "asc" },
    });
    let verified = 0; let unavailable = 0;
    for (const lead of stale) {
      const payload = lead.sourceRecords[0]?.payload as Candidate | null;
      if (!payload) { unavailable += 1; continue; }
      if (isBlockedLocation(payload as Candidate & Record<string, unknown>)) {
        await prisma.lead.update({ where: { id: lead.id }, data: { isSuppressed: true, isActive: false, isFiltered: true, filterReason: "BLOCKED_LOCATION" } });
        unavailable += 1;
        continue;
      }
      const result = await verifyWebsiteCandidate(payload);
      const checkedAt = new Date();
      const hasWebsite = result.status === "WEBSITE_FOUND";
      await prisma.$transaction([
        prisma.lead.update({ where: { id: lead.id }, data: {
          website: result.website, websiteUrl: result.website, normalizedDomain: result.website ? new URL(result.website).hostname.replace(/^www\./, "") : null,
          websiteStatus: result.status, websiteStatusReason: result.reason, websiteConfidence: result.confidence,
          lastVerifiedAt: checkedAt, isActive: hasWebsite ? false : lead.isActive,
          isFiltered: hasWebsite ? true : lead.isFiltered,
          filterReason: hasWebsite ? "Eigen website gevonden bij lokale hercontrole" : lead.filterReason,
        } }),
        prisma.verificationEvidence.createMany({ data: result.evidence.map((evidence) => ({ leadId: lead.id, ...evidence, checkedAt })) }),
        prisma.leadActivity.create({ data: { leadId: lead.id, type: "WEBSITE_RECHECKED", summary: result.reason, details: { status: result.status } } }),
      ]);
      verified += 1;
    }
    return { skipped: false, checked: stale.length, verified, unavailable };
  } finally { await lock.release(); }
}
