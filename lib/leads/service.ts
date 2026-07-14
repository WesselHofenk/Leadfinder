import { Prisma, type LeadStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { LeadFilters } from "./filters";

export function activeLeadWhere(filters: LeadFilters): Prisma.LeadWhereInput {
  const showFiltered=filters.filtered==="yes"||filters.status==="FILTERED";const where: Prisma.LeadWhereInput = { isActive: showFiltered?undefined:true, isFiltered:showFiltered?true:false, businessStatus: "OPERATIONAL", phoneNumber: { not: "" } };
  if (filters.q) where.OR = ["companyName","contactPersonName","email","phoneNumber","normalizedPhoneNumber","city","postalCode","category"].map((field) => ({ [field]: { contains: filters.q, mode: "insensitive" } })) as Prisma.LeadWhereInput[];
  if (filters.country) where.country = filters.country;
  if (filters.region) where.province = { contains: filters.region, mode: "insensitive" };
  if (filters.municipality) where.municipality = { contains: filters.municipality, mode: "insensitive" };
  if (filters.city) where.city = { contains: filters.city, mode: "insensitive" };
  if (filters.postalCode) where.postalCode = { startsWith: filters.postalCode, mode: "insensitive" };
  if (filters.category) where.category = { contains: filters.category, mode: "insensitive" };
  if (filters.status) where.status=filters.status;
  if (filters.leadType) where.leadType=filters.leadType;
  if (filters.minScore!==undefined) where.opportunityScore={gte:filters.minScore};
  if (filters.issue) where.websiteAnalyses={some:{reasons:{array_contains:[{code:filters.issue}]}}};
  if (filters.newOnly) where.firstDiscoveredAt = { gte: new Date(Date.now() - 7 * 86_400_000) };
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
