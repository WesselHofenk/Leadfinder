import { prisma } from "@/lib/prisma";
import type { Candidate } from "@/lib/leads/eligibility";
import { verifyWebsiteCandidate } from "@/lib/leads/website-verification";
import { createGenerationRun, runLeadGeneration } from "./generation";
import { acquireJobLock } from "./lock";

export async function runDiscoveryJob() {
  const active = await prisma.generationRun.findFirst({ where: { status: { in: ["PENDING", "RUNNING"] } } });
  if (active) return { skipped: true, reason: "Er draait al een leadgeneratie", runId: active.id };
  const run = await createGenerationRun();
  await runLeadGeneration(run.id);
  const finished = await prisma.generationRun.findUniqueOrThrow({ where: { id: run.id } });
  return { skipped: false, runId: run.id, status: finished.status, found: finished.candidatesFound, stored: finished.stored, sourceFailures: finished.sourceFailures };
}

export async function reverifyStaleLeads() {
  const lock = await acquireJobLock("local-reverify");
  if (!lock) return { skipped: true, reason: "Er draait al een herverificatie" };
  try {
    const staleBefore = new Date(Date.now() - 30 * 86_400_000);
    const stale = await prisma.lead.findMany({
      where: { isSuppressed: false, lastVerifiedAt: { lte: staleBefore } },
      include: { sourceRecords: { orderBy: { fetchedAt: "desc" }, take: 1 } },
      take: 20,
      orderBy: { lastVerifiedAt: "asc" },
    });
    let verified = 0; let unavailable = 0;
    for (const lead of stale) {
      const payload = lead.sourceRecords[0]?.payload as Candidate | null;
      if (!payload) { unavailable += 1; continue; }
      const result = await verifyWebsiteCandidate(payload);
      const checkedAt = new Date();
      const hasWebsite = result.status === "WEBSITE_FOUND";
      await prisma.$transaction([
        prisma.lead.update({ where: { id: lead.id }, data: {
          website: result.website, websiteUrl: result.website, normalizedDomain: result.website ? new URL(result.website).hostname.replace(/^www\./, "") : null,
          websiteStatus: result.status, websiteStatusReason: result.reason, websiteConfidence: result.confidence,
          lastVerifiedAt: checkedAt, isActive: hasWebsite ? false : lead.isActive,
          isFiltered: hasWebsite ? true : lead.isFiltered, status: hasWebsite ? "HAS_WEBSITE" : lead.status,
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
