import { prisma } from "@/lib/prisma";
import { serverEnv } from "@/lib/env";
import { getPlaceDetails, searchPlaces } from "@/lib/google/places";
import { validateCandidateBasics, type Candidate } from "@/lib/leads/eligibility";
import { canPublishReconciledGoogleLead, GOOGLE_REVIEW_REQUIRED_REASON, selectGoogleBusinessMatch } from "@/lib/leads/google-verification";
import { determineWebsiteStatus, logWebsiteStatusDecision } from "@/lib/leads/website";
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

async function findBusinessOnGoogle(apiKey: string, existing: {
  externalPlaceId: string; googlePlaceId: string | null; source: string; companyName: string; phoneNumber: string;
  internationalPhoneNumber: string | null; country: string; category: string; city: string; postalCode: string | null;
  streetAddress: string; latitude: unknown; longitude: unknown; googleMapsUrl: string;
}) {
  const knownPlaceId = existing.googlePlaceId || (existing.source === "GOOGLE_PLACES" && !existing.externalPlaceId.startsWith("osm:") ? existing.externalPlaceId : null);
  if (knownPlaceId) return getPlaceDetails(apiKey, knownPlaceId, existing.country);

  const original: Candidate = {
    externalPlaceId: existing.externalPlaceId, source: "OPENSTREETMAP", companyName: existing.companyName,
    phoneNumber: existing.phoneNumber, internationalPhoneNumber: existing.internationalPhoneNumber ?? undefined,
    country: existing.country, category: existing.category, city: existing.city, postalCode: existing.postalCode ?? undefined,
    streetAddress: existing.streetAddress, latitude: Number(existing.latitude), longitude: Number(existing.longitude),
    googleMapsUrl: existing.googleMapsUrl,
  };
  const query = [existing.companyName, existing.streetAddress, existing.postalCode, existing.city].filter(Boolean).join(" ");
  const result = await searchPlaces({
    apiKey, query, city: existing.city, country: existing.country, latitude: Number(existing.latitude),
    longitude: Number(existing.longitude), radius: 3_000,
  });
  return selectGoogleBusinessMatch(original, result.candidates);
}

export async function reverifyStaleLeads() {
  const env = serverEnv();
  if (!env.PAID_PROVIDERS_ENABLED || !env.GOOGLE_PLACES_API_KEY) {
    return { skipped: true, reason: "Betaalde herverificatie staat uit; bestaande leads blijven behouden" };
  }
  const lock = await acquireJobLock("reverify");
  if (!lock) return { skipped: true, reason: "Er draait al een herverificatie" };
  try {
    const staleBefore = new Date(Date.now() - 30 * 86_400_000);
    const retryBefore = new Date(Date.now() - 7 * 86_400_000);
    const stale = await prisma.lead.findMany({
      where: {
        isSuppressed: false,
        OR: [
          { googleWebsiteVerifiedAt: null, googleWebsiteCheckAttemptedAt: null },
          { googleWebsiteVerifiedAt: null, googleWebsiteCheckAttemptedAt: { lte: retryBefore } },
          { googleWebsiteVerifiedAt: { lte: staleBefore }, OR: [
            { googleWebsiteCheckAttemptedAt: null },
            { googleWebsiteCheckAttemptedAt: { lte: retryBefore } },
          ] },
        ],
      },
      take: 20, orderBy: [{ googleWebsiteCheckAttemptedAt: "asc" }, { lastVerifiedAt: "asc" }],
    });
    const job = await prisma.scanJob.create({ data: { type: "REVERIFY", status: "RUNNING", startedAt: new Date(), attempt: 1 } });
    let calls = 0, verified = 0, sourceFailures = 0;
    for (const existing of stale) {
      try {
        const attemptedAt = new Date();
        await prisma.lead.update({ where: { id: existing.id }, data: { googleWebsiteCheckAttemptedAt: attemptedAt } });
        await reserveBudgetedApiCall({ provider: "GOOGLE_PLACES", dailyLimit: env.GOOGLE_PLACES_DAILY_LIMIT, monthlyLimit: env.GOOGLE_PLACES_MONTHLY_LIMIT, estimatedCostCents: env.GOOGLE_PLACES_ESTIMATED_COST_CENTS });
        calls += 1;
        const candidate = await findBusinessOnGoogle(env.GOOGLE_PLACES_API_KEY, existing);
        if (!candidate) {
          sourceFailures += 1;
          await prisma.lead.update({ where: { id: existing.id }, data: {
            websiteStatus: "UNKNOWN", websiteStatusReason: "Geen eenduidige Google Places-match gevonden; lead blijft verborgen",
            websiteSource: "google_places.no_exact_match", isActive: false, isFiltered: true,
            filterReason: GOOGLE_REVIEW_REQUIRED_REASON, status: existing.status === "DO_NOT_CONTACT" ? "DO_NOT_CONTACT" : "FILTERED",
          } });
          continue;
        }
        const basic = validateCandidateBasics(candidate);
        if (!basic.ok) {
          const closed = ["CLOSED_PERMANENTLY", "PERMANENTLY_CLOSED"].includes(candidate.businessStatus ?? "") ? "CLOSED_PERMANENTLY" : ["CLOSED_TEMPORARILY", "TEMPORARILY_CLOSED"].includes(candidate.businessStatus ?? "") ? "CLOSED_TEMPORARILY" : null;
          if (closed) await prisma.$transaction([
            prisma.lead.update({ where: { id: existing.id }, data: { isActive: false, isFiltered: true, businessStatus: closed, status: ["DO_NOT_CONTACT", "FILTERED"].includes(existing.status) ? existing.status : "FILTERED", filterReason: closed === "CLOSED_PERMANENTLY" ? "Bedrijf permanent gesloten" : "Bedrijf tijdelijk gesloten", lastVerifiedAt: new Date() } }),
            prisma.leadHistory.create({ data: { leadId: existing.id, event: "DEACTIVATED", details: { reason: closed } } }),
          ]);
          continue;
        }
        const websiteDecision = determineWebsiteStatus(candidate, { absenceVerified: true });
        logWebsiteStatusDecision(candidate.companyName, websiteDecision);
        const noWebsite = websiteDecision.status === "no_website";
        const ownWebsite = websiteDecision.status === "has_website" || websiteDecision.status === "outdated_website";
        const publish = canPublishReconciledGoogleLead(existing, websiteDecision);
        const verifiedAt = new Date();
        await prisma.$transaction([
          prisma.lead.update({ where: { id: existing.id }, data: { companyName: basic.lead.companyName, normalizedCompanyName: basic.lead.normalizedCompanyName, phoneNumber: basic.lead.phoneNumber || basic.lead.normalizedPhoneNumber, normalizedPhoneNumber: basic.lead.normalizedPhoneNumber, internationalPhoneNumber: basic.lead.internationalPhoneNumber || basic.lead.normalizedPhoneNumber, email: basic.lead.email, businessStatus: basic.lead.businessStatus, confidenceScore: basic.lead.confidenceScore, confidenceLevel: basic.lead.confidenceLevel,
            website: websiteDecision.normalizedUrl, websiteUrl: websiteDecision.normalizedUrl, normalizedDomain: websiteDecision.normalizedUrl ? new URL(websiteDecision.normalizedUrl).hostname.replace(/^www\./, "") : null,
            websiteStatus: noWebsite ? "NO_OWN_WEBSITE" : ownWebsite ? "OWN_WEBSITE" : "UNKNOWN",
            websiteStatusReason: websiteDecision.reason, websiteSource: "google_places.websiteUri",
            googlePlaceId: candidate.externalPlaceId, googleWebsiteCheckAttemptedAt: verifiedAt, googleWebsiteVerifiedAt: verifiedAt, googleWebsitePresent: noWebsite ? false : ownWebsite ? true : null,
            googleMapsUrl: candidate.googleMapsUrl,
            leadType: noWebsite ? "NO_WEBSITE" : "IMPROVABLE_WEBSITE",
            isActive: noWebsite ? (publish ? true : existing.isActive) : false,
            isFiltered: noWebsite ? (publish ? false : existing.isFiltered) : true,
            status: noWebsite && publish ? "NEW" : noWebsite ? existing.status : existing.status === "DO_NOT_CONTACT" ? "DO_NOT_CONTACT" : "FILTERED",
            filterReason: noWebsite && publish ? null : noWebsite ? existing.filterReason : websiteDecision.reason,
            lastVerifiedAt: verifiedAt } }),
          prisma.leadHistory.create({ data: { leadId: existing.id, event: "GOOGLE_WEBSITE_VERIFIED", details: { googlePlaceId: candidate.externalPlaceId, noWebsite } } }),
        ]);
        verified += 1;
      } catch { sourceFailures += 1; }
    }
    await prisma.scanJob.update({ where: { id: job.id }, data: { status: "COMPLETE", finishedAt: new Date(), recordsFound: stale.length, recordsStored: verified, apiCallsUsed: calls, errorMessage: sourceFailures ? `${sourceFailures} broncontroles konden niet worden afgerond` : null } });
    return { skipped: false, checked: stale.length, verified, calls, sourceFailures };
  } finally { await lock.release(); }
}
