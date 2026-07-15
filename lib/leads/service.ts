import { Prisma, type LeadStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { LeadFilters } from "./filters";
import { fingerprintValues, type DedupeKeys } from "./deduplication";
import { normalizeText } from "./normalization";
import { getGoogleBusinessUrl } from "./google-business-url";
import { isNonOwnedWebsite, normalizeWebsite } from "./website";

export function activeLeadWhere(filters: LeadFilters): Prisma.LeadWhereInput {
  const showFiltered = filters.filtered === "yes";
  const where: Prisma.LeadWhereInput = { isActive: showFiltered ? undefined : true, isFiltered: showFiltered ? true : false, isSuppressed: false };
  if (!filters.status && !showFiltered) where.status = { not: "NOT_INTERESTED" };
  if (!filters.businessStatus && !showFiltered) where.businessStatus = { in: ["OPERATIONAL", "UNKNOWN", "FUTURE_OPENING"] };
  if (filters.q) where.OR = ["companyName","contactPersonName","email","phoneNumber","normalizedPhoneNumber","city","postalCode","category"].map((field) => ({ [field]: { contains: filters.q } })) as Prisma.LeadWhereInput[];
  if (filters.country) where.country = filters.country;
  if (filters.region) where.province = { contains: filters.region };
  if (filters.municipality) where.municipality = { contains: filters.municipality };
  if (filters.city) where.city = { contains: filters.city };
  if (filters.postalCode) where.postalCode = { startsWith: filters.postalCode };
  if (filters.category) where.category = { contains: filters.category };
  if (filters.status) where.status = filters.status;
  if (filters.businessStatus) where.businessStatus = filters.businessStatus;
  if (filters.source) where.source = filters.source;
  if (filters.websiteStatus) where.websiteStatus = filters.websiteStatus;
  else if (filters.leadType === "NO_WEBSITE") where.websiteStatus = "NO_WEBSITE_CONFIRMED";
  else if (filters.leadType === "OUTDATED_WEBSITE") where.websiteStatus = "WEBSITE_OUTDATED";
  else if (filters.leadType === "IMPROVABLE_WEBSITE") where.websiteStatus = { in: ["WEBSITE_BROKEN", "MANUAL_REVIEW_REQUIRED"] };
  else if (!showFiltered) where.websiteStatus = "NO_WEBSITE_CONFIRMED";
  if (filters.googleReview === "confirmed") {
    where.googleWebsitePresent = false;
    where.googleWebsiteVerifiedAt = { not: null };
  } else if (filters.googleReview === "pending") {
    where.googleWebsiteVerifiedAt = null;
    where.websiteStatus = "NO_WEBSITE_CONFIRMED";
  }
  if (filters.minScore !== undefined || filters.maxScore !== undefined) where.opportunityScore = { ...(filters.minScore !== undefined ? { gte: filters.minScore } : {}), ...(filters.maxScore !== undefined ? { lte: filters.maxScore } : {}) };
  if (filters.minConfidence !== undefined) where.websiteConfidence = { gte: filters.minConfidence };
  if (filters.called === "yes") where.status = { in: ["VOICEMAIL","CALL_BACK","INTERESTED","APPOINTMENT","QUOTE_SENT","CUSTOMER"] };
  if (filters.called === "no") where.status = "NEW";
  if (filters.hasPhone === "yes") where.phoneNumber = { not: "" };
  if (filters.hasPhone === "no") where.phoneNumber = "";
  if (filters.hasEmail === "yes") where.email = { not: null };
  if (filters.hasEmail === "no") where.email = null;
  if (filters.issue) where.evidence = { some: { OR: [{ checkType: { contains: filters.issue } }, { result: { contains: filters.issue } }] } };
  if (filters.newOnly) where.firstDiscoveredAt = { gte: new Date(Date.now() - 7 * 86_400_000) };
  if (filters.foundAfter || filters.foundBefore) where.firstDiscoveredAt = { ...(filters.foundAfter ? { gte: filters.foundAfter } : {}), ...(filters.foundBefore ? { lte: filters.foundBefore } : {}) };
  if (filters.verifiedBefore) where.lastVerifiedAt = { lte: filters.verifiedBefore };
  return where;
}

function orderBy(filters: LeadFilters): Prisma.LeadOrderByWithRelationInput[] {
  switch (filters.sort) {
    case "confidence_desc": return [{ websiteConfidence: "desc" }, { firstDiscoveredAt: "desc" }];
    case "opportunity_desc": return [{ opportunityScore: "desc" }, { firstDiscoveredAt: "desc" }];
    case "oldest": return [{ firstDiscoveredAt: "asc" }, { id: "asc" }];
    case "checked_desc": return [{ lastVerifiedAt: "desc" }, { id: "asc" }];
    case "city": return [{ city: "asc" }, { companyName: "asc" }];
    case "category": return [{ category: "asc" }, { companyName: "asc" }];
    case "status": return [{ status: "asc" }, { updatedAt: "desc" }];
    case "contacts_desc": return [{ email: { sort: "desc", nulls: "last" } }, { phoneNumber: "desc" }];
    default: return [{ firstDiscoveredAt: "desc" }, { id: "asc" }];
  }
}

export async function listLeads(filters: LeadFilters) {
  const { where, skip, take } = buildLeadListQuery(filters);
  const [items, total] = await prisma.$transaction([
    prisma.lead.findMany({ where, orderBy: orderBy(filters), skip, take }), prisma.lead.count({ where }),
  ]);
  return { items, total, page: filters.page, pageSize: filters.pageSize, pages: Math.max(1, Math.ceil(total / filters.pageSize)) };
}

export async function updateManualLeadFields(leadId: string, userId: string, input: { status: LeadStatus; notes?: string; filterReason?: string }) {
  return prisma.$transaction(async (tx) => {
    await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
    const lead = await tx.lead.update({ where: { id: leadId }, data: {
      status: input.status,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.filterReason !== undefined ? { filterReason: input.filterReason.trim() || null } : {}),
      lastContactAt: ["VOICEMAIL","CALL_BACK","INTERESTED"].includes(input.status) ? new Date() : undefined,
    } });
    await tx.leadHistory.create({ data: { leadId, actorId: userId, event: "MANUAL_FIELDS_UPDATED", details: { status: input.status } } });
    await tx.leadActivity.create({ data: { leadId, actorId: userId, type: "STATUS_CHANGED", summary: `Status gewijzigd naar ${input.status}` } });
    if (input.notes?.trim()) { await tx.leadNote.create({ data: { leadId, userId, content: input.notes } }); await tx.leadActivity.create({ data: { leadId, actorId: userId, type: "NOTE_ADDED", summary: "Notitie toegevoegd" } }); }
    return lead;
  });
}

export async function reviewLeadWebsite(
  leadId: string,
  userId: string,
  input: { websiteReview: "NO_WEBSITE_CONFIRMED" | "WEBSITE_FOUND"; websiteUrl?: string },
) {
  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
    const checkedAt = new Date();
    const evidenceUrl = getGoogleBusinessUrl(lead);
    if (input.websiteReview === "NO_WEBSITE_CONFIRMED") {
      const reason = "Handmatig op het actuele Google-bedrijfsprofiel gecontroleerd: er was geen websiteknop of eigen domein zichtbaar.";
      const updated = await tx.lead.update({ where: { id: leadId }, data: {
        website: null, websiteUrl: null, normalizedDomain: null, websiteStatus: "NO_WEBSITE_CONFIRMED",
        websiteStatusReason: reason, websiteConfidence: 100, websiteSource: "google_manual_review",
        googleWebsiteCheckAttemptedAt: checkedAt, googleWebsiteVerifiedAt: checkedAt, googleWebsitePresent: false,
        lastVerifiedAt: checkedAt, isActive: true, isFiltered: false, filterReason: null,
      } });
      await tx.verificationEvidence.create({ data: { leadId, checkType: "GOOGLE_BUSINESS_PROFILE_MANUAL", result: "NO_WEBSITE", confidence: 100, evidenceUrl, shortExplanation: reason } });
      await tx.leadActivity.create({ data: { leadId, actorId: userId, type: "WEBSITE_VERIFIED", summary: "Google handmatig gecontroleerd: geen website", details: { websiteStatus: "NO_WEBSITE_CONFIRMED" } } });
      await tx.leadHistory.create({ data: { leadId, actorId: userId, event: "WEBSITE_MANUALLY_VERIFIED", details: { websiteStatus: "NO_WEBSITE_CONFIRMED", evidenceUrl } } });
      return updated;
    }

    const websiteUrl = normalizeWebsite(input.websiteUrl);
    if (!websiteUrl || isNonOwnedWebsite(websiteUrl)) throw new Error("Vul een geldige eigen bedrijfswebsite in.");
    const normalizedDomain = new URL(websiteUrl).hostname.replace(/^www\./, "");
    const reason = `Eigen website handmatig gevonden: ${websiteUrl}`;
    const updated = await tx.lead.update({ where: { id: leadId }, data: {
      website: websiteUrl, websiteUrl, normalizedDomain, websiteStatus: "WEBSITE_FOUND", websiteStatusReason: reason,
      websiteConfidence: 100, websiteSource: "google_manual_review", googleWebsiteCheckAttemptedAt: checkedAt,
      googleWebsiteVerifiedAt: checkedAt, googleWebsitePresent: true, lastVerifiedAt: checkedAt,
      isActive: false, isFiltered: true, filterReason: reason,
    } });
    await tx.leadExclusion.upsert({ where: { identityKey: `external:${lead.externalPlaceId}` }, create: {
      identityKey: `external:${lead.externalPlaceId}`, source: lead.source, sourceRecordId: lead.externalPlaceId,
      phoneNormalized: lead.normalizedPhoneNumber, domainNormalized: normalizedDomain, nameNormalized: lead.normalizedCompanyName,
      postalCode: lead.postalCode, reason,
    }, update: { domainNormalized: normalizedDomain, reason, expiresAt: null } });
    await tx.verificationEvidence.create({ data: { leadId, checkType: "GOOGLE_BUSINESS_PROFILE_MANUAL", result: "WEBSITE_FOUND", confidence: 100, evidenceUrl: websiteUrl, shortExplanation: reason } });
    await tx.leadActivity.create({ data: { leadId, actorId: userId, type: "WEBSITE_FOUND", summary: "Google handmatig gecontroleerd: website gevonden", details: { websiteUrl } } });
    await tx.leadHistory.create({ data: { leadId, actorId: userId, event: "WEBSITE_MANUALLY_VERIFIED", details: { websiteStatus: "WEBSITE_FOUND", websiteUrl } } });
    return updated;
  });
}

export function buildLeadListQuery(filters: LeadFilters) { return { where: activeLeadWhere(filters), skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }; }

export async function suppressLead(leadId: string, userId: string, reason = "Handmatig verwijderd en geblokkeerd") {
  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
    const keys: DedupeKeys = { externalId: lead.externalPlaceId, phone: lead.normalizedPhoneNumber, email: lead.email ?? undefined, domain: lead.normalizedDomain ?? undefined,
      namePostal: lead.postalCode ? `${lead.normalizedCompanyName}|${normalizeText(lead.postalCode)}` : undefined,
      nameCityAddress: `${lead.normalizedCompanyName}|${normalizeText(lead.city)}|${normalizeText(lead.streetAddress)}`,
      nameCityCategory: `${lead.normalizedCompanyName}|${normalizeText(lead.city)}|${normalizeText(lead.category)}` };
    for (const { fingerprint } of fingerprintValues(keys)) await tx.suppressedLead.upsert({ where: { fingerprint }, create: { fingerprint, reason }, update: { reason } });
    const updated = await tx.lead.update({ where: { id: leadId }, data: { isSuppressed: true, isActive: false, isFiltered: true, filterReason: reason } });
    await tx.leadHistory.create({ data: { leadId, actorId: userId, event: "SUPPRESSED", details: { reason } } });
    await tx.leadActivity.create({ data: { leadId, actorId: userId, type: "EXCLUDED", summary: reason } });
    return updated;
  });
}
