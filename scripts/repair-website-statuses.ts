import { PrismaClient } from "@prisma/client";
import { determineWebsiteStatus, logWebsiteStatusDecision } from "../lib/leads/website";

const prisma = new PrismaClient();

// Facts explicitly supplied and verified by the operator can repair data that the old importer discarded.
// Keep these corrections narrow; the generic legacy rule below protects every other missing record.
const verifiedCorrections = new Map([
  ["by yoel|abcoude", { website: "https://byyoel.nl", source: "operator_verified" }],
]);

async function main() {
  const leads = await prisma.lead.findMany({ orderBy: { createdAt: "asc" } });
  let repaired = 0, ownWebsite = 0, noWebsite = 0, unknown = 0;
  const sourceCounts = new Map<string, number>();
  for (const lead of leads) {
    sourceCounts.set(lead.source, (sourceCounts.get(lead.source) ?? 0) + 1);
    const correction = verifiedCorrections.get(`${lead.companyName.trim().toLowerCase()}|${lead.city.trim().toLowerCase()}`);
    const decision = determineWebsiteStatus(
      correction ? { ...lead, website: correction.website, websiteUrl: correction.website } : lead,
      // Legacy empty values were never retained from their source. Reusing the old NO_OWN_WEBSITE
      // flag would repeat the original false positive, so absence must be treated as unverified.
      { absenceVerified: false },
    );
    if (correction && decision.normalizedUrl) decision.source = correction.source;
    logWebsiteStatusDecision(lead.companyName, decision);
    if (decision.status === "has_website") ownWebsite += 1;
    else if (decision.status === "no_website") noWebsite += 1;
    else if (decision.status === "unknown") unknown += 1;

    const hasExistingAuditOpportunity = ["OUTDATED", "IMPROVABLE"].includes(lead.websiteStatus);
    const hasGoogleNoWebsiteProof = decision.status === "no_website"
      && Boolean(lead.googlePlaceId && lead.googleWebsiteVerifiedAt && lead.googleWebsitePresent === false);
    const targetStatus = decision.status === "has_website"
      ? hasExistingAuditOpportunity ? lead.websiteStatus : "OWN_WEBSITE"
      : decision.status === "unknown" ? "UNKNOWN"
      : hasGoogleNoWebsiteProof ? "NO_OWN_WEBSITE" : "UNKNOWN";
    const mustExclude = targetStatus !== "NO_OWN_WEBSITE";
    const normalizedDomain = decision.normalizedUrl ? new URL(decision.normalizedUrl).hostname.replace(/^www\./, "") : null;
    const nextWebsite = decision.status === "no_website" ? null : decision.normalizedUrl;
    const nextLeadType = targetStatus === "NO_OWN_WEBSITE" ? "NO_WEBSITE" : targetStatus === "OUTDATED" ? "OUTDATED_WEBSITE" : "IMPROVABLE_WEBSITE";
    const changed = lead.website !== nextWebsite || lead.websiteUrl !== nextWebsite || lead.websiteStatus !== targetStatus
      || lead.websiteStatusReason !== decision.reason || lead.websiteSource !== decision.source || lead.normalizedDomain !== normalizedDomain
      || (mustExclude && (lead.isActive || !lead.isFiltered));
    if (!changed) continue;

    await prisma.$transaction([
      prisma.lead.update({ where: { id: lead.id }, data: {
        website: nextWebsite, websiteUrl: nextWebsite, normalizedDomain, websiteStatus: targetStatus,
        websiteStatusReason: decision.reason, websiteSource: decision.source, leadType: nextLeadType,
        isActive: mustExclude ? false : lead.isActive, isFiltered: mustExclude ? true : lead.isFiltered,
        status: mustExclude && lead.status === "NEW" ? "FILTERED" : lead.status,
        filterReason: mustExclude ? decision.reason : lead.filterReason,
      } }),
      prisma.leadHistory.create({ data: { leadId: lead.id, event: "WEBSITE_STATUS_REPAIRED", details: {
        from: lead.websiteStatus, to: targetStatus, rawValue: decision.rawValue, normalizedUrl: decision.normalizedUrl,
        source: decision.source, reason: decision.reason,
      } } }),
    ]);
    repaired += 1;
    if (lead.companyName.toLowerCase().includes("by yoel")) console.info("[website-repair:by-yoel]", JSON.stringify({ website: nextWebsite, websiteStatus: decision.status, databaseStatus: targetStatus, excludedFromNoWebsite: targetStatus !== "NO_OWN_WEBSITE" }));
  }
  console.info("[website-repair:summary]", JSON.stringify({ checked: leads.length, repaired, ownWebsite, noWebsite, unknown, sources: Object.fromEntries(sourceCounts) }));
}

main().finally(() => prisma.$disconnect());
