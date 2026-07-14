import { prisma } from "@/lib/prisma";
import { serverEnv } from "@/lib/env";
import { getPlaceDetails } from "@/lib/google/places";
import { validateCandidateBasics } from "@/lib/leads/eligibility";
import { createGenerationRun, runLeadGeneration } from "./generation";
import { acquireJobLock } from "./lock";
import { reserveBudgetedApiCall } from "./quota";

export async function runDiscoveryJob() {
  const active = await prisma.generationRun.findFirst({ where: { status: { in: ["PENDING", "RUNNING"] } } });
  if (active) return { skipped: true, reason: "Er draait al een leadgeneratie", runId: active.id };
  const run = await createGenerationRun();
  await runLeadGeneration(run.id);
  const finished = await prisma.generationRun.findUniqueOrThrow({ where: { id: run.id } });
  return { skipped: false, runId: run.id, status: finished.status, found: finished.candidatesFound, stored: finished.stored, sourceFailures: finished.sourceFailures };
}

export async function reverifyStaleLeads() {
  const env = serverEnv();
  if (!env.PAID_PROVIDERS_ENABLED || !env.GOOGLE_PLACES_API_KEY) {
    return { skipped: true, reason: "Betaalde herverificatie staat uit; bestaande leads blijven behouden" };
  }
  const lock = await acquireJobLock("reverify");
  if (!lock) return { skipped: true, reason: "Er draait al een herverificatie" };
  try {
    const stale = await prisma.lead.findMany({
      where: { source: "GOOGLE_PLACES", isSuppressed: false, lastVerifiedAt: { lte: new Date(Date.now() - 30 * 86_400_000) } },
      take: 20, orderBy: { lastVerifiedAt: "asc" },
    });
    const job = await prisma.scanJob.create({ data: { type: "REVERIFY", status: "RUNNING", startedAt: new Date(), attempt: 1 } });
    let calls = 0, verified = 0, sourceFailures = 0;
    for (const existing of stale) {
      try {
        await reserveBudgetedApiCall({ provider: "GOOGLE_PLACES", dailyLimit: env.GOOGLE_PLACES_DAILY_LIMIT, monthlyLimit: env.GOOGLE_PLACES_MONTHLY_LIMIT, estimatedCostCents: env.GOOGLE_PLACES_ESTIMATED_COST_CENTS });
        calls += 1;
        const candidate = await getPlaceDetails(env.GOOGLE_PLACES_API_KEY, existing.externalPlaceId, existing.country);
        if (!candidate) { sourceFailures += 1; continue; }
        const basic = validateCandidateBasics(candidate);
        if (!basic.ok) {
          const closed = ["CLOSED_PERMANENTLY", "PERMANENTLY_CLOSED"].includes(candidate.businessStatus ?? "") ? "CLOSED_PERMANENTLY" : ["CLOSED_TEMPORARILY", "TEMPORARILY_CLOSED"].includes(candidate.businessStatus ?? "") ? "CLOSED_TEMPORARILY" : null;
          if (closed) await prisma.$transaction([
            prisma.lead.update({ where: { id: existing.id }, data: { isActive: false, isFiltered: true, businessStatus: closed, status: ["DO_NOT_CONTACT", "FILTERED"].includes(existing.status) ? existing.status : "FILTERED", filterReason: closed === "CLOSED_PERMANENTLY" ? "Bedrijf permanent gesloten" : "Bedrijf tijdelijk gesloten", lastVerifiedAt: new Date() } }),
            prisma.leadHistory.create({ data: { leadId: existing.id, event: "DEACTIVATED", details: { reason: closed } } }),
          ]);
          continue;
        }
        await prisma.$transaction([
          prisma.lead.update({ where: { id: existing.id }, data: { companyName: basic.lead.companyName, normalizedCompanyName: basic.lead.normalizedCompanyName, phoneNumber: basic.lead.phoneNumber || basic.lead.normalizedPhoneNumber, normalizedPhoneNumber: basic.lead.normalizedPhoneNumber, internationalPhoneNumber: basic.lead.internationalPhoneNumber || basic.lead.normalizedPhoneNumber, email: basic.lead.email, businessStatus: basic.lead.businessStatus, confidenceScore: basic.lead.confidenceScore, confidenceLevel: basic.lead.confidenceLevel, lastVerifiedAt: new Date() } }),
          prisma.leadHistory.create({ data: { leadId: existing.id, event: "VERIFIED" } }),
        ]);
        verified += 1;
      } catch { sourceFailures += 1; }
    }
    await prisma.scanJob.update({ where: { id: job.id }, data: { status: "COMPLETE", finishedAt: new Date(), recordsFound: stale.length, recordsStored: verified, apiCallsUsed: calls, errorMessage: sourceFailures ? `${sourceFailures} broncontroles konden niet worden afgerond` : null } });
    return { skipped: false, checked: stale.length, verified, calls, sourceFailures };
  } finally { await lock.release(); }
}
