import { PrismaClient, type Lead } from "@prisma/client";
import type { Candidate } from "../lib/leads/eligibility";
import { candidateDedupeKeys, fingerprintValues } from "../lib/leads/deduplication";
import { verifyWebsiteCandidate } from "../lib/leads/website-verification";

const prisma = new PrismaClient();

function candidateFrom(lead: Lead, payload: unknown): Candidate {
  const raw = payload && typeof payload === "object" ? payload as Partial<Candidate> : {};
  return {
    ...raw,
    externalPlaceId: lead.externalPlaceId,
    source: lead.source === "GOOGLE_PLACES" ? "GOOGLE_PLACES" : "OPENSTREETMAP",
    companyName: lead.companyName,
    phoneNumber: lead.phoneNumber,
    internationalPhoneNumber: lead.internationalPhoneNumber ?? undefined,
    email: lead.email ?? undefined,
    website: lead.website ?? raw.website,
    websiteUrl: lead.websiteUrl ?? raw.websiteUrl,
    country: lead.country,
    category: lead.category,
    city: lead.city,
    province: lead.province ?? undefined,
    municipality: lead.municipality ?? undefined,
    postalCode: lead.postalCode ?? undefined,
    streetAddress: lead.streetAddress,
    houseNumber: lead.houseNumber ?? undefined,
    latitude: Number(lead.latitude),
    longitude: Number(lead.longitude),
    googleMapsUrl: lead.googleMapsUrl,
    sourceUrl: lead.sourceUrl ?? lead.googleMapsUrl,
  };
}

async function main() {
  const leads = await prisma.lead.findMany({ include: { sourceRecords: { orderBy: { fetchedAt: "desc" }, take: 1 } } });
  let confirmed = 0; let websitesFound = 0; let movedToReview = 0; let errors = 0;
  for (const lead of leads) {
    const manuallyConfirmed = lead.websiteStatus === "NO_WEBSITE_CONFIRMED"
      && lead.googleWebsitePresent === false && Boolean(lead.googleWebsiteVerifiedAt);
    if (manuallyConfirmed) { confirmed += 1; continue; }
    try {
      const verification = await verifyWebsiteCandidate(candidateFrom(lead, lead.sourceRecords[0]?.payload));
      const websiteFound = verification.status === "WEBSITE_FOUND" && Boolean(verification.website);
      const nextWebsiteStatus = websiteFound ? "WEBSITE_FOUND" : verification.status === "SOCIAL_ONLY" ? "SOCIAL_ONLY" : "MANUAL_REVIEW_REQUIRED";
      const reason = websiteFound
        ? verification.reason
        : `${verification.reason} Deze record is uit de actieve leadlijst gehaald totdat Google handmatig is gecontroleerd.`;
      await prisma.$transaction(async (tx) => {
        await tx.lead.update({ where: { id: lead.id }, data: {
          website: websiteFound ? verification.website : null,
          websiteUrl: websiteFound ? verification.website : null,
          normalizedDomain: websiteFound && verification.website ? new URL(verification.website).hostname.replace(/^www\./, "") : null,
          websiteStatus: nextWebsiteStatus, websiteStatusReason: reason, websiteConfidence: websiteFound ? verification.confidence : Math.min(55, verification.confidence),
          websiteSource: websiteFound ? "local_domain_repair" : "awaiting_google_manual_review",
          isActive: false, isFiltered: true, filterReason: reason,
          lastVerifiedAt: new Date(),
        } });
        await tx.verificationEvidence.createMany({ data: verification.evidence.map((item) => ({ leadId: lead.id, ...item })) });
        await tx.leadActivity.create({ data: { leadId: lead.id, type: websiteFound ? "WEBSITE_FOUND" : "WEBSITE_REVIEW_REQUIRED", summary: reason } });
        await tx.leadHistory.create({ data: { leadId: lead.id, event: "STRICT_WEBSITE_REPAIR", details: { from: lead.websiteStatus, to: nextWebsiteStatus, website: verification.website } } });
        if (websiteFound) {
          const identityKey = fingerprintValues(candidateDedupeKeys(candidateFrom(lead, lead.sourceRecords[0]?.payload)))[0]?.fingerprint ?? `external:${lead.externalPlaceId}`;
          await tx.leadExclusion.upsert({ where: { identityKey }, create: {
            identityKey, source: lead.source, sourceRecordId: lead.externalPlaceId, phoneNormalized: lead.normalizedPhoneNumber,
            domainNormalized: verification.website ? new URL(verification.website).hostname.replace(/^www\./, "") : null,
            nameNormalized: lead.normalizedCompanyName, postalCode: lead.postalCode, reason,
          }, update: { reason, domainNormalized: verification.website ? new URL(verification.website).hostname.replace(/^www\./, "") : null, expiresAt: null } });
        }
      });
      if (websiteFound) websitesFound += 1; else movedToReview += 1;
      console.info("[website-repair]", JSON.stringify({ companyName: lead.companyName, from: lead.websiteStatus, to: nextWebsiteStatus, website: verification.website, active: false }));
    } catch (error) {
      errors += 1;
      console.error("[website-repair:error]", JSON.stringify({ companyName: lead.companyName, error: error instanceof Error ? error.message : "Onbekende fout" }));
    }
  }
  console.info("[website-repair:summary]", JSON.stringify({ checked: leads.length, confirmed, websitesFound, movedToReview, errors }));
}

main().finally(() => prisma.$disconnect());
