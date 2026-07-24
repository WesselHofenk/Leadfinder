import { validatePublicBusinessEmail } from "@/lib/leads/business-email";
import { applySingleLocationDecision, assessSingleLocation } from "@/lib/leads/single-location";
import { validateStrictLead } from "@/lib/leads/strict-validation";
import { verifyWebsiteCandidate } from "@/lib/leads/website-verification";
import { saveValidatedLead } from "@/lib/jobs/generation";
import { initialOverpassSearchCursor } from "@/lib/openstreetmap/overpass";
import { prisma } from "@/lib/prisma";
import { OpenStreetMapAdapter } from "@/lib/sources/openstreetmap";

async function main() {
  if (process.env.CONFIRM_QUALIFIED_LEAD_E2E !== "yes") {
    throw new Error("Set CONFIRM_QUALIFIED_LEAD_E2E=yes to run the real qualified-lead E2E.");
  }

  const adapter = new OpenStreetMapAdapter();
  const search = await adapter.searchBusinesses({
    country: "NL",
    city: "Amsterdam",
    latitude: 52.3676,
    longitude: 4.9041,
    radius: 12_000,
    category: "kapper",
    tileCursor: initialOverpassSearchCursor("NL", "Amsterdam", "kapper"),
  });

  const outcomes: Array<Record<string, unknown>> = [];
  for (const sourceCandidate of search.candidates) {
    const existing = await prisma.lead.findFirst({
      where: {
        OR: [
          { externalPlaceId: sourceCandidate.externalPlaceId },
          { sourceRecords: { some: { source: "OPENSTREETMAP", sourceRecordId: sourceCandidate.externalPlaceId } } },
        ],
      },
      select: { id: true, companyName: true, pipelineStageId: true },
    });
    if (existing) {
      outcomes.push({ outcome: "already_stored", ...existing });
      continue;
    }

    const email = await validatePublicBusinessEmail(sourceCandidate);
    if (email.status !== "VALID") {
      outcomes.push({ companyName: sourceCandidate.companyName, outcome: "email_rejected", reason: email.reason });
      continue;
    }

    let related;
    try {
      related = await adapter.findIdentityMatches(sourceCandidate);
    } catch (error) {
      outcomes.push({
        companyName: sourceCandidate.companyName,
        outcome: "identity_retry",
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const location = assessSingleLocation(sourceCandidate, related, true);
    const candidate = applySingleLocationDecision({
      ...sourceCandidate,
      email: email.email,
      emailSource: email.source,
      emailSourceUrl: email.sourceUrl,
      emailPubliclyListed: true,
      emailMxVerified: true,
      emailVerifiedAt: email.checkedAt,
    }, location);
    const website = await verifyWebsiteCandidate(candidate);
    const strict = validateStrictLead(candidate, website);
    if (!strict.valid) {
      outcomes.push({
        companyName: candidate.companyName,
        outcome: "strict_rejected",
        reasons: strict.reasons,
        websiteStatus: website.status,
        locationStatus: candidate.singleLocationStatus,
      });
      continue;
    }

    const stored = await saveValidatedLead(candidate, website);
    if (!stored.stored || !stored.leadId) {
      outcomes.push({ companyName: candidate.companyName, outcome: "storage_rejected", reason: stored.reason });
      continue;
    }
    const readback = await prisma.lead.findUniqueOrThrow({
      where: { id: stored.leadId },
      select: {
        id: true,
        companyName: true,
        phoneNumber: true,
        email: true,
        pipelineStageId: true,
        isActive: true,
        sourceRecords: {
          where: { source: "OPENSTREETMAP", sourceRecordId: candidate.externalPlaceId },
          take: 1,
          select: { decision: true, reasonCode: true },
        },
      },
    });
    if (
      readback.pipelineStageId !== "pipeline-nieuw"
      || !readback.isActive
      || !readback.phoneNumber
      || !readback.email
      || readback.sourceRecords[0]?.decision !== "stored"
    ) {
      throw new Error(`E2E database readback failed for ${readback.id}.`);
    }
    console.info(JSON.stringify({
      success: true,
      source: "OPENSTREETMAP",
      companyName: readback.companyName,
      leadId: readback.id,
      pipelineStageId: readback.pipelineStageId,
      hasPhone: true,
      hasPublicMxVerifiedEmail: true,
      sourceDecision: readback.sourceRecords[0].decision,
      sourceReasonCode: readback.sourceRecords[0].reasonCode,
    }));
    return;
  }

  console.info(JSON.stringify({ success: false, sourceCandidates: search.candidates.length, outcomes }));
  throw new Error("No real source candidate passed every fixed qualification check.");
}

main().finally(() => prisma.$disconnect());
