import "server-only";

import type { Lead } from "@prisma/client";

import { acquireJobLock } from "@/lib/jobs/lock";
import type { Candidate } from "@/lib/leads/eligibility";
import { validatePublicBusinessEmail, type BusinessEmailValidation } from "@/lib/leads/business-email";
import { prisma } from "@/lib/prisma";
import { coldEmailEligibleLeadWhere } from "./eligibility";

const verifiedBufferTarget = 150;
const maximumBatchSize = 30;
const validationConcurrency = 6;

type LegacyLead = Pick<Lead,
  | "id" | "externalPlaceId" | "companyName" | "phoneNumber" | "internationalPhoneNumber"
  | "email" | "emailSource" | "emailSourceUrl" | "source" | "sourceUrl" | "sourceFetchedAt"
  | "country" | "category" | "city" | "streetAddress" | "latitude" | "longitude"
  | "googleMapsUrl" | "website" | "websiteUrl"
>;

export function legacyLeadEmailCandidate(lead: LegacyLead): Candidate {
  const source = lead.source === "GOOGLE_PLACES" || lead.source === "OPENSTREETMAP"
    ? lead.source
    : undefined;
  return {
    externalPlaceId: lead.externalPlaceId,
    companyName: lead.companyName,
    phoneNumber: lead.phoneNumber,
    internationalPhoneNumber: lead.internationalPhoneNumber ?? undefined,
    email: lead.email ?? undefined,
    emailSource: lead.emailSource ?? lead.source,
    emailSourceUrl: lead.emailSourceUrl ?? undefined,
    emailPubliclyListed: Boolean(lead.emailSourceUrl),
    source,
    sourceUrl: lead.sourceUrl ?? undefined,
    sourceUpdatedAt: lead.sourceFetchedAt?.toISOString(),
    country: lead.country,
    category: lead.category,
    city: lead.city,
    streetAddress: lead.streetAddress,
    latitude: Number(lead.latitude),
    longitude: Number(lead.longitude),
    googleMapsUrl: lead.googleMapsUrl,
    website: lead.website ?? lead.websiteUrl ?? undefined,
  };
}

export function legacyLeadEmailUpdate(result: BusinessEmailValidation) {
  if (result.status === "VALID") {
    const checkedAt = new Date(result.checkedAt);
    return {
      email: result.email,
      emailSource: result.source,
      emailSourceUrl: result.sourceUrl,
      emailMxVerified: true,
      emailVerifiedAt: checkedAt,
      emailValidationStatus: "DELIVERABLE" as const,
      emailValidationSource: result.sourceUrl,
      emailValidatedAt: checkedAt,
    };
  }
  if (result.status === "INVALID") {
    return {
      emailMxVerified: false,
      emailValidationStatus: "INVALID" as const,
      emailValidatedAt: new Date(),
    };
  }
  return {
    emailMxVerified: false,
    emailValidationStatus: "PENDING" as const,
  };
}

async function mapLimited<T, R>(values: T[], mapper: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(validationConcurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index]);
    }
  }));
  return results;
}

/**
 * Additive repair for leads created before MX verification was introduced.
 * Every address is rechecked against its public source and DNS before it can
 * enter the cold-email buffer; an unverified legacy address is never queued.
 */
export async function reverifyLegacyColdEmailLeads(requestedLimit = maximumBatchSize) {
  const lock = await acquireJobLock("cold-email-legacy-mx-reverification", 4 * 60_000);
  if (!lock) return { checked: 0, verified: 0, invalid: 0, retry: 0, skipped: true, reason: "locked" };
  try {
    const eligible = await prisma.lead.count({ where: coldEmailEligibleLeadWhere() });
    if (eligible >= verifiedBufferTarget) {
      return { checked: 0, verified: 0, invalid: 0, retry: 0, skipped: true, reason: "buffer-ready" };
    }
    const leads = await prisma.lead.findMany({
      where: {
        isActive: true,
        isFiltered: false,
        isSuppressed: false,
        doNotContact: false,
        email: { not: null },
        emailMxVerified: false,
        emailValidationStatus: { not: "INVALID" },
        pipelineStage: { is: { slug: "nieuw" } },
        coldEmails: { none: {
          OR: [
            { smtpAcceptedAt: { not: null } },
            { status: { in: ["PENDING", "SENDING", "SENT_PENDING_ARCHIVE", "SENT", "FAILED"] } },
          ],
        } },
      },
      orderBy: [{ opportunityScore: "desc" }, { firstDiscoveredAt: "asc" }],
      take: Math.min(maximumBatchSize, Math.max(1, requestedLimit)),
      select: {
        id: true, externalPlaceId: true, companyName: true, phoneNumber: true, internationalPhoneNumber: true,
        email: true, emailSource: true, emailSourceUrl: true, source: true, sourceUrl: true, sourceFetchedAt: true,
        country: true, category: true, city: true, streetAddress: true, latitude: true, longitude: true,
        googleMapsUrl: true, website: true, websiteUrl: true,
      },
    });
    const results = await mapLimited(leads, async (lead) => ({
      lead,
      validation: await validatePublicBusinessEmail(legacyLeadEmailCandidate(lead)),
    }));
    await prisma.$transaction(results.map(({ lead, validation }) => prisma.lead.update({
      where: { id: lead.id },
      data: legacyLeadEmailUpdate(validation),
    })));
    return {
      checked: results.length,
      verified: results.filter(({ validation }) => validation.status === "VALID").length,
      invalid: results.filter(({ validation }) => validation.status === "INVALID").length,
      retry: results.filter(({ validation }) => validation.status === "RETRY" || validation.status === "MISSING").length,
      skipped: false,
      reason: null,
    };
  } finally {
    await lock.release();
  }
}
