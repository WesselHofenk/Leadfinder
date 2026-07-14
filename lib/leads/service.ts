import { Prisma, type LeadStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { LeadFilters } from "./filters";
import { fingerprintValues, type DedupeKeys } from "./deduplication";
import { normalizeText } from "./normalization";

export function activeLeadWhere(filters: LeadFilters): Prisma.LeadWhereInput {
  const showFiltered=filters.filtered==="yes"||filters.status==="FILTERED";const where: Prisma.LeadWhereInput = { isActive: showFiltered?undefined:true, isFiltered:showFiltered?true:false, isSuppressed:false, businessStatus: { in: ["OPERATIONAL","UNKNOWN"] }, phoneNumber: { not: "" } };
  if (filters.q) where.OR = ["companyName","contactPersonName","email","phoneNumber","normalizedPhoneNumber","city","postalCode","category"].map((field) => ({ [field]: { contains: filters.q, mode: "insensitive" } })) as Prisma.LeadWhereInput[];
  if (filters.country) where.country = filters.country;
  if (filters.region) where.province = { contains: filters.region, mode: "insensitive" };
  if (filters.municipality) where.municipality = { contains: filters.municipality, mode: "insensitive" };
  if (filters.city) where.city = { contains: filters.city, mode: "insensitive" };
  if (filters.postalCode) where.postalCode = { startsWith: filters.postalCode, mode: "insensitive" };
  if (filters.category) where.category = { contains: filters.category, mode: "insensitive" };
  if (filters.status) where.status=filters.status;
  if (filters.leadType) where.leadType=filters.leadType;
  if (filters.websiteStatus) where.websiteStatus=filters.websiteStatus;
  if (filters.minScore!==undefined||filters.maxScore!==undefined) where.opportunityScore={...(filters.minScore!==undefined?{gte:filters.minScore}:{}),...(filters.maxScore!==undefined?{lte:filters.maxScore}:{})};
  if (filters.minConfidence!==undefined) where.confidenceScore={gte:filters.minConfidence};
  if (filters.called==="yes") where.status={in:["CALLED","NO_ANSWER","QUOTE_SENT","INVOICED"]};
  if (filters.called==="no") where.status="NEW";
  if (filters.issue) where.websiteAnalyses={some:{reasons:{array_contains:[{code:filters.issue}]}}};
  if (filters.newOnly) where.firstDiscoveredAt = { gte: new Date(Date.now() - 7 * 86_400_000) };
  if (filters.foundAfter||filters.foundBefore) where.firstDiscoveredAt={...(filters.foundAfter?{gte:filters.foundAfter}:{}),...(filters.foundBefore?{lte:filters.foundBefore}:{})};
  if (filters.verifiedBefore) where.lastVerifiedAt = { lte: filters.verifiedBefore };
  return where;
}

export async function listLeads(filters: LeadFilters) {
  const where = activeLeadWhere(filters); const skip = (filters.page - 1) * filters.pageSize;
  const [items, total] = await prisma.$transaction([
    prisma.lead.findMany({ where, orderBy: [{ firstDiscoveredAt: "desc" }, { id: "asc" }], skip, take: filters.pageSize }),
    prisma.lead.count({ where }),
  ]);
  return { items, total, page: filters.page, pageSize: filters.pageSize, pages: Math.max(1, Math.ceil(total / filters.pageSize)) };
}

export async function updateManualLeadFields(leadId: string, userId: string, input: { status: LeadStatus; notes?: string; filterReason?:string }) {
  return prisma.$transaction(async (tx) => {
    const filtered=input.status==="FILTERED";const blocked=input.status==="DO_NOT_CONTACT";
    const lead = await tx.lead.update({ where: { id: leadId }, data: { status: input.status, ...(input.notes!==undefined?{notes:input.notes}:{}), isFiltered:filtered, isActive:!filtered, doNotContact:blocked, filterReason:filtered?(input.filterReason||"Handmatig gefilterd"):null } });
    await tx.leadHistory.create({ data: { leadId, actorId: userId, event: "MANUAL_FIELDS_UPDATED", details: { status: input.status } } });
    if(input.notes?.trim())await tx.leadNote.create({data:{leadId,userId,content:input.notes}});
    return lead;
  });
}

export async function suppressLead(leadId: string, userId: string, reason = "Handmatig verwijderd en geblokkeerd") {
  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
    const keys: DedupeKeys = {
      externalId: lead.externalPlaceId, phone: lead.normalizedPhoneNumber, email: lead.email ?? undefined,
      domain: lead.normalizedDomain ?? undefined,
      namePostal: lead.postalCode ? `${lead.normalizedCompanyName}|${normalizeText(lead.postalCode)}` : undefined,
      nameCityAddress: `${lead.normalizedCompanyName}|${normalizeText(lead.city)}|${normalizeText(lead.streetAddress)}`,
      nameCityCategory: `${lead.normalizedCompanyName}|${normalizeText(lead.city)}|${normalizeText(lead.category)}`,
    };
    await tx.suppressedLead.createMany({ data: fingerprintValues(keys).map(({ fingerprint }) => ({ fingerprint, reason })), skipDuplicates: true });
    const updated = await tx.lead.update({ where: { id: leadId }, data: { isSuppressed: true, isActive: false, isFiltered: true, status: "FILTERED", filterReason: reason } });
    await tx.leadHistory.create({ data: { leadId, actorId: userId, event: "SUPPRESSED", details: { reason } } });
    return updated;
  });
}
