import { PrismaClient } from "@prisma/client";
import { determineWebsiteStatus, logWebsiteStatusDecision } from "../lib/leads/website";

const prisma = new PrismaClient();

async function main() {
  const leads = await prisma.lead.findMany({ orderBy: { createdAt: "asc" } });
  let repaired = 0, ownWebsite = 0, noWebsite = 0, unknown = 0;
  for (const lead of leads) {
    const decision = determineWebsiteStatus(lead);
    logWebsiteStatusDecision(lead.companyName, decision);
    if (decision.status === "has_website") ownWebsite += 1;
    else if (decision.status === "no_website") noWebsite += 1;
    else if (decision.status === "unknown") unknown += 1;

    const hasExistingAuditOpportunity = ["OUTDATED", "IMPROVABLE"].includes(lead.websiteStatus);
    const targetStatus = decision.status === "has_website"
      ? hasExistingAuditOpportunity ? lead.websiteStatus : "OWN_WEBSITE"
      : decision.status === "unknown" ? "UNKNOWN"
      : lead.websiteStatus === "NO_OWN_WEBSITE" || lead.leadType === "NO_WEBSITE" ? "NO_OWN_WEBSITE" : lead.websiteStatus;
    const mustExclude = targetStatus === "OWN_WEBSITE" || targetStatus === "UNKNOWN";
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
  console.info("[website-repair:summary]", JSON.stringify({ checked: leads.length, repaired, ownWebsite, noWebsite, unknown }));
}

main().finally(() => prisma.$disconnect());
