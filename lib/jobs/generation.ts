import { JobStatus, Prisma, type GenerationRun } from "@prisma/client";

import { serverEnv } from "@/lib/env";
import { candidateDedupeKeys, fingerprintValues, RunDeduplicator } from "@/lib/leads/deduplication";
import { validateCandidateBasics, type Candidate } from "@/lib/leads/eligibility";
import { normalizeText } from "@/lib/leads/normalization";
import { verifyWebsiteCandidate, type WebsiteVerificationResult } from "@/lib/leads/website-verification";
import type { OverpassEvent } from "@/lib/openstreetmap/overpass";
import { prisma } from "@/lib/prisma";
import { enabledSourceAdapters } from "@/lib/sources/openstreetmap";
import { acquireJobLock } from "./lock";
import { phaseProgress, terminalGenerationStatuses } from "./generation-state";

type Stats = {
  found: number;
  checked: number;
  withoutWebsite: number;
  duplicates: number;
  existing: number;
  rejected: number;
  stored: number;
  manualReview: number;
  websitesChecked: number;
  permanentlyClosed: number;
  temporarilyClosed: number;
  noWebsite: number;
  outdatedWebsite: number;
  improvableWebsite: number;
  sourceFailures: number;
};

const terminalStatuses = new Set<JobStatus>(terminalGenerationStatuses as readonly JobStatus[]);
const errorMessage = (error: unknown) => error instanceof Error ? error.message.slice(0, 300) : "Onbekende bronfout";
const stringArray = (value: Prisma.JsonValue): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

function statsFromRun(run: GenerationRun): Stats {
  return {
    found: run.candidatesFound,
    checked: run.candidatesChecked,
    withoutWebsite: run.withoutWebsite,
    duplicates: run.duplicates,
    existing: run.existingLeads,
    rejected: run.rejected,
    stored: run.stored,
    manualReview: run.manualReview,
    websitesChecked: run.websitesChecked,
    permanentlyClosed: run.permanentlyClosed,
    temporarilyClosed: run.temporarilyClosed,
    noWebsite: run.noWebsite,
    outdatedWebsite: run.outdatedWebsite,
    improvableWebsite: run.improvableWebsite,
    sourceFailures: run.sourceFailures,
  };
}

function runData(stats: Stats, places: string[], errors: string[], warnings: string[]): Prisma.GenerationRunUpdateInput {
  return {
    candidatesFound: stats.found,
    candidatesChecked: stats.checked,
    withoutWebsite: stats.withoutWebsite,
    duplicates: stats.duplicates,
    existingLeads: stats.existing,
    rejected: stats.rejected,
    stored: stats.stored,
    manualReview: stats.manualReview,
    websitesChecked: stats.websitesChecked,
    permanentlyClosed: stats.permanentlyClosed,
    temporarilyClosed: stats.temporarilyClosed,
    noWebsite: stats.noWebsite,
    outdatedWebsite: stats.outdatedWebsite,
    improvableWebsite: stats.improvableWebsite,
    sourceFailures: stats.sourceFailures,
    estimatedCostCents: 0,
    placesUsed: places,
    branchesUsed: [],
    apiErrors: errors.slice(-50),
    warnings: warnings.slice(-50),
    heartbeatAt: new Date(),
  };
}

function capacity(stats: Stats) { return stats.stored + stats.manualReview; }

export async function createGenerationRun() {
  const target = Number(process.env.LEAD_GENERATION_TARGET || 50);
  return prisma.generationRun.create({
    data: {
      targetCount: Math.min(50, Math.max(1, target)),
      currentPhase: "Zoekopdracht klaarzetten",
      progress: phaseProgress("queued"),
      message: "De zoekopdracht is gevalideerd en staat klaar.",
      heartbeatAt: new Date(),
    },
  });
}

export async function markStaleGenerationRuns(now = new Date()) {
  const env = serverEnv();
  const staleBefore = new Date(now.getTime() - env.GENERATION_WATCHDOG_SECONDS * 1000);
  return prisma.generationRun.updateMany({
    where: { status: { in: [JobStatus.PENDING, JobStatus.RUNNING] }, updatedAt: { lt: staleBefore } },
    data: {
      status: JobStatus.TIMED_OUT,
      progress: 100,
      currentPhase: "Tijdslimiet bereikt",
      message: "De zoekrun gaf te lang geen voortgang en is veilig vrijgegeven. Probeer opnieuw.",
      stopReason: "De watchdog ontving geen heartbeat binnen de toegestane tijd.",
      finishedAt: now,
    },
  });
}

export async function latestGenerationRun() {
  await markStaleGenerationRuns();
  return prisma.generationRun.findFirst({ orderBy: { createdAt: "desc" } });
}

export async function cancelGenerationRun(runId?: string) {
  const active = runId
    ? await prisma.generationRun.findFirst({ where: { id: runId, status: { in: [JobStatus.PENDING, JobStatus.RUNNING] } } })
    : await prisma.generationRun.findFirst({ where: { status: { in: [JobStatus.PENDING, JobStatus.RUNNING] } }, orderBy: { createdAt: "desc" } });
  if (!active) return null;
  return prisma.generationRun.update({
    where: { id: active.id },
    data: {
      cancelRequested: true,
      status: JobStatus.CANCELLED,
      progress: 100,
      currentPhase: "Geannuleerd",
      message: "De zoekrun is geannuleerd. Er worden geen nieuwe kandidaten meer opgeslagen.",
      stopReason: "De zoekrun is door de gebruiker geannuleerd.",
      finishedAt: new Date(),
      heartbeatAt: new Date(),
    },
  });
}

async function logSource(runId: string, source: string, level: string, message: string, city?: string, category?: string) {
  await prisma.sourceLog.create({ data: { runId, source, level, message: message.slice(0, 500), city, category } });
}

async function logOverpassEvent(runId: string, city: string, category: string, event: OverpassEvent) {
  const entry = { jobId: runId, step: "source_fetch", ...event };
  const level = event.errorType ? "ERROR" : "INFO";
  console.info(JSON.stringify(entry));
  await logSource(runId, "OPENSTREETMAP", level, JSON.stringify(entry), city, category);
}

async function sourceRecord(candidate: Candidate) {
  return prisma.sourceRecord.upsert({
    where: { source_sourceRecordId: { source: candidate.source ?? "OPENSTREETMAP", sourceRecordId: candidate.externalPlaceId } },
    create: {
      source: candidate.source ?? "OPENSTREETMAP",
      sourceRecordId: candidate.externalPlaceId,
      sourceUrl: candidate.sourceUrl ?? candidate.googleMapsUrl,
      fetchedAt: candidate.fetchedAt ? new Date(candidate.fetchedAt) : new Date(),
      rawName: candidate.companyName,
      rawAddress: candidate.streetAddress,
      rawPhone: candidate.internationalPhoneNumber || candidate.phoneNumber,
      rawWebsite: candidate.website,
      rawBusinessStatus: candidate.businessStatus,
      payload: JSON.parse(JSON.stringify(candidate)),
    },
    update: {
      sourceUrl: candidate.sourceUrl ?? candidate.googleMapsUrl,
      fetchedAt: candidate.fetchedAt ? new Date(candidate.fetchedAt) : new Date(),
      rawName: candidate.companyName,
      rawAddress: candidate.streetAddress,
      rawPhone: candidate.internationalPhoneNumber || candidate.phoneNumber,
      rawWebsite: candidate.website,
      rawBusinessStatus: candidate.businessStatus,
      payload: JSON.parse(JSON.stringify(candidate)),
    },
  });
}

async function markDecision(candidate: Candidate, decision: string, reasonCode: string, leadId?: string) {
  await prisma.sourceRecord.update({
    where: { source_sourceRecordId: { source: candidate.source ?? "OPENSTREETMAP", sourceRecordId: candidate.externalPlaceId } },
    data: { decision, reasonCode, processedAt: new Date(), leadId },
  });
}

async function knownCandidateReason(candidate: Candidate) {
  const keys = candidateDedupeKeys(candidate);
  const fingerprints = fingerprintValues(keys).map(({ fingerprint }) => fingerprint);
  const source = await prisma.sourceRecord.findUnique({
    where: { source_sourceRecordId: { source: candidate.source ?? "OPENSTREETMAP", sourceRecordId: candidate.externalPlaceId } },
    select: { id: true },
  });
  if (source) return "duplicate_source_id";
  const [external, phone, nameAddress, domain, legacyExclusion, exclusion] = await Promise.all([
    prisma.lead.findUnique({ where: { externalPlaceId: candidate.externalPlaceId }, select: { id: true } }),
    keys.phone ? prisma.lead.findUnique({ where: { normalizedPhoneNumber: keys.phone }, select: { id: true } }) : null,
    prisma.lead.findFirst({ where: { normalizedCompanyName: normalizeText(candidate.companyName), normalizedAddress: normalizeText(candidate.streetAddress) }, select: { id: true } }),
    keys.domain ? prisma.lead.findFirst({ where: { normalizedDomain: keys.domain }, select: { id: true } }) : null,
    prisma.suppressedLead.findFirst({ where: { fingerprint: { in: fingerprints } }, select: { id: true } }),
    prisma.leadExclusion.findFirst({ where: { identityKey: { in: fingerprints }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { id: true } }),
  ]);
  if (external) return "duplicate_source_id";
  if (domain) return "duplicate_domain";
  if (phone) return "duplicate_phone";
  if (nameAddress) return "duplicate_name_address";
  if (legacyExclusion || exclusion) return "previously_rejected";
  return null;
}

async function excludeCandidate(candidate: Candidate, verification: WebsiteVerificationResult) {
  const keys = candidateDedupeKeys(candidate);
  const identityKey = fingerprintValues(keys)[0]?.fingerprint ?? `external:${candidate.externalPlaceId}`;
  await prisma.leadExclusion.upsert({
    where: { identityKey },
    create: {
      identityKey,
      source: candidate.source,
      sourceRecordId: candidate.externalPlaceId,
      phoneNormalized: keys.phone,
      domainNormalized: verification.website ? new URL(verification.website).hostname.replace(/^www\./, "") : undefined,
      nameNormalized: keys.nameCityCategory.split("|")[0],
      postalCode: candidate.postalCode,
      reason: verification.status === "WEBSITE_FOUND" ? "Eigen website gevonden" : verification.reason,
    },
    update: { reason: verification.reason, expiresAt: null },
  });
}

async function storeLead(candidate: Candidate, verification: WebsiteVerificationResult) {
  const basic = validateCandidateBasics(candidate);
  if (!basic.ok) return { stored: false, reviewOnly: false, reason: basic.reason, leadId: undefined };
  const reviewOnly = verification.status !== "NO_WEBSITE_CONFIRMED";
  const leadType = verification.status === "WEBSITE_OUTDATED" ? "OUTDATED_WEBSITE" : verification.status === "WEBSITE_BROKEN" ? "IMPROVABLE_WEBSITE" : "NO_WEBSITE";
  const opportunityScore = reviewOnly ? 55 : 90;
  const lead = await prisma.lead.create({ data: {
    externalPlaceId: basic.lead.externalPlaceId,
    companyName: basic.lead.companyName,
    normalizedCompanyName: basic.lead.normalizedCompanyName,
    phoneNumber: basic.lead.phoneNumber || basic.lead.normalizedPhoneNumber,
    normalizedPhoneNumber: basic.lead.normalizedPhoneNumber,
    internationalPhoneNumber: basic.lead.internationalPhoneNumber || basic.lead.normalizedPhoneNumber,
    email: basic.lead.email,
    category: basic.lead.category,
    subCategory: basic.lead.subCategory,
    country: basic.lead.country,
    province: basic.lead.province,
    municipality: basic.lead.municipality,
    city: basic.lead.city,
    postalCode: basic.lead.postalCode,
    streetAddress: basic.lead.streetAddress,
    houseNumber: basic.lead.houseNumber,
    normalizedAddress: basic.lead.normalizedAddress,
    latitude: new Prisma.Decimal(basic.lead.latitude),
    longitude: new Prisma.Decimal(basic.lead.longitude),
    googleMapsUrl: basic.lead.googleMapsUrl,
    website: verification.website,
    websiteUrl: verification.website,
    normalizedDomain: verification.website ? new URL(verification.website).hostname.replace(/^www\./, "") : null,
    websiteStatus: verification.status,
    websiteStatusReason: verification.reason,
    websiteConfidence: verification.confidence,
    websiteSource: "local_verification",
    sourceUrl: basic.lead.sourceUrl ?? basic.lead.googleMapsUrl,
    sourceFetchedAt: basic.lead.fetchedAt ? new Date(basic.lead.fetchedAt) : new Date(),
    leadType,
    opportunityScore,
    conversionQualityScore: 0,
    businessStatus: basic.lead.businessStatus,
    source: "OPENSTREETMAP",
    confidenceScore: basic.lead.confidenceScore,
    confidenceLevel: basic.lead.confidenceLevel,
    status: reviewOnly ? "NEEDS_REVIEW" : "NEW",
    isActive: !reviewOnly,
    isFiltered: reviewOnly,
    filterReason: reviewOnly ? "Handmatige controle van het actuele bedrijfsprofiel is vereist." : null,
    evidence: { create: verification.evidence },
    activities: { create: { type: "LEAD_GENERATED", summary: verification.reason, details: { source: candidate.source, websiteStatus: verification.status } } },
    history: { create: { event: "LEAD_GENERATED", details: { source: candidate.source, websiteStatus: verification.status } } },
  } });
  await prisma.sourceRecord.update({
    where: { source_sourceRecordId: { source: candidate.source ?? "OPENSTREETMAP", sourceRecordId: candidate.externalPlaceId } },
    data: { leadId: lead.id },
  });
  await Promise.all(fingerprintValues(candidateDedupeKeys(candidate)).map((item) => prisma.duplicateFingerprint.upsert({
    where: { fingerprint: item.fingerprint },
    create: { ...item, leadId: lead.id },
    update: { leadId: lead.id },
  })));
  return { stored: true, reviewOnly, reason: verification.reason, leadId: lead.id };
}

function rejectionCode(reason: string) {
  return ({ niet_operationeel: "likely_closed", keten_of_uitgesloten: "excluded_category", onbetrouwbare_status: "manual_verification_required" } as Record<string, string>)[reason] ?? "invalid_business";
}

async function nextSearchArea() {
  const area = await prisma.coverageArea.findFirst({
    where: { status: { not: "PAUSED" } },
    orderBy: [{ lastScannedAt: { sort: "asc", nulls: "first" } }, { priority: "asc" }, { city: "asc" }, { category: "asc" }],
  });
  if (!area) return null;
  const combination = await prisma.searchCombination.upsert({
    where: { country_city_category_source: { country: area.country, city: area.city, category: area.category, source: "OPENSTREETMAP" } },
    create: { country: area.country, city: area.city, category: area.category, source: "OPENSTREETMAP" },
    update: {},
  });
  return { area, combination, tileCursor: combination.tileCursor % 9 };
}

async function terminalRun(runId: string, status: JobStatus, stats: Stats, places: string[], errors: string[], warnings: string[], reason: string) {
  return prisma.generationRun.update({
    where: { id: runId },
    data: {
      ...runData(stats, places, errors, warnings),
      status,
      progress: 100,
      exhausted: status === JobStatus.COMPLETE && stats.stored < (await prisma.generationRun.findUniqueOrThrow({ where: { id: runId }, select: { targetCount: true } })).targetCount,
      currentPhase: status === JobStatus.CANCELLED ? "Geannuleerd" : status === JobStatus.TIMED_OUT ? "Tijdslimiet bereikt" : status === JobStatus.FAILED ? "Mislukt" : "Voltooid",
      message: reason,
      stopReason: reason,
      finishedAt: new Date(),
    },
  });
}

export async function processGenerationBatch(runId: string) {
  const env = serverEnv();
  await markStaleGenerationRuns();
  let run = await prisma.generationRun.findUniqueOrThrow({ where: { id: runId } });
  if (terminalStatuses.has(run.status)) return run;
  const lock = await acquireJobLock(`lead-generation:${runId}`, Math.max(35_000, env.OVERPASS_TOTAL_TIMEOUT_MS + 10_000));
  if (!lock) return run;

  const stats = statsFromRun(run);
  const errors = stringArray(run.apiErrors);
  const warnings = stringArray(run.warnings);
  const places = stringArray(run.placesUsed);
  const dedupe = new RunDeduplicator();
  const startedAt = run.startedAt ?? new Date();
  const deadline = startedAt.getTime() + env.GENERATION_MAX_DURATION_SECONDS * 1000;

  try {
    run = await prisma.generationRun.update({
      where: { id: runId },
      data: {
        status: JobStatus.RUNNING,
        startedAt,
        currentPhase: "Zoekopdracht valideren",
        progress: Math.max(run.progress, phaseProgress("validate")),
        message: "De volgende veilige zoekbatch wordt voorbereid.",
        heartbeatAt: new Date(),
      },
    });
    if (run.cancelRequested) return terminalRun(runId, JobStatus.CANCELLED, stats, places, errors, warnings, "De zoekrun is geannuleerd.");
    if (Date.now() >= deadline) return terminalRun(runId, JobStatus.TIMED_OUT, stats, places, errors, warnings, "De veilige maximale verwerkingstijd is bereikt.");
    if (run.processedSegments >= env.GENERATION_MAX_SOURCE_CALLS) return terminalRun(runId, JobStatus.COMPLETE, stats, places, errors, warnings, "Alle veilige zoeksegmenten voor deze run zijn verwerkt.");

    const adapters = enabledSourceAdapters();
    if (!adapters.length) throw new Error("Er is geen gratis databron ingeschakeld.");
    const selected = await nextSearchArea();
    if (!selected) return terminalRun(runId, JobStatus.COMPLETE, stats, places, errors, warnings, "Er zijn geen openbare zoekgebieden beschikbaar.");
    const { area, combination, tileCursor } = selected;
    const adapter = adapters[0];
    const region = `${area.city}, ${area.country}`;
    const tileLabel = `t${tileCursor}`;
    const segment = `${area.country}:${area.city}:${area.category}:${tileLabel}`;
    let batchMessage: string | null = null;

    await prisma.generationRun.update({
      where: { id: runId },
      data: {
        currentPhase: "Openbare bedrijfsvermeldingen ophalen",
        currentSource: adapter.id,
        currentRegion: region,
        currentTile: tileLabel,
        progress: Math.max(run.progress, phaseProgress("source")),
        message: `Kleine zoektegel ${tileLabel} voor ${area.category} in ${region} wordt opgehaald.`,
        heartbeatAt: new Date(),
      },
    });

    try {
      const result = await adapter.searchBusinesses({
        country: area.country,
        city: area.city,
        latitude: Number(area.latitude),
        longitude: Number(area.longitude),
        radius: area.radius,
        category: area.category,
        tileCursor,
        onEvent: (event) => logOverpassEvent(runId, area.city, area.category, event),
      });
      stats.found += result.candidates.length;
      warnings.push(...result.warnings);
      if (!places.includes(segment)) places.push(segment);
      await prisma.generationRun.update({
        where: { id: runId },
        data: {
          ...runData(stats, places, errors, warnings),
          currentPhase: "Kandidaten verwerken",
          progress: Math.max(run.progress, phaseProgress("candidates")),
          message: `${result.candidates.length} kandidaten ontvangen; duplicaten en basisgegevens worden gecontroleerd.`,
        },
      });

      let websiteChecksThisBatch = 0;
      let processedThisBatch = 0;
      for (const candidate of result.candidates) {
        if (processedThisBatch >= env.GENERATION_BATCH_CANDIDATES || websiteChecksThisBatch >= env.GENERATION_BATCH_WEBSITE_CHECKS || Date.now() >= deadline) break;
        const state = await prisma.generationRun.findUnique({ where: { id: runId }, select: { cancelRequested: true, status: true } });
        if (!state || state.cancelRequested || state.status === JobStatus.CANCELLED) return terminalRun(runId, JobStatus.CANCELLED, stats, places, errors, warnings, "De zoekrun is geannuleerd; de lopende batch is veilig gestopt.");
        processedThisBatch += 1;
        stats.checked += 1;
        const keys = candidateDedupeKeys(candidate);
        const inRunDuplicate = dedupe.hasOrAdd(keys);
        const knownReason = inRunDuplicate ? "duplicate_name_address" : await knownCandidateReason(candidate);
        await sourceRecord(candidate);
        if (knownReason) {
          stats.duplicates += 1;
          stats.existing += 1;
          await markDecision(candidate, "duplicate", knownReason);
        } else {
          const basic = validateCandidateBasics(candidate);
          if (!basic.ok) {
            const code = rejectionCode(basic.reason);
            if (code === "likely_closed") stats.permanentlyClosed += 1;
            else stats.rejected += 1;
            await markDecision(candidate, "rejected", code);
          } else {
            websiteChecksThisBatch += 1;
            stats.websitesChecked += 1;
            await prisma.generationRun.update({
              where: { id: runId },
              data: { ...runData(stats, places, errors, warnings), currentPhase: "Websitebewijs controleren", progress: Math.max(run.progress, phaseProgress("websites")), message: `${candidate.companyName} wordt met begrensde DNS- en websitechecks gecontroleerd.` },
            });
            const verification = await verifyWebsiteCandidate(candidate);
            if (verification.status === "WEBSITE_FOUND") {
              await excludeCandidate(candidate, verification);
              await markDecision(candidate, "rejected", "has_official_website");
              stats.rejected += 1;
            } else {
              try {
                await prisma.generationRun.update({ where: { id: runId }, data: { currentPhase: "Resultaat veilig opslaan", progress: Math.max(run.progress, phaseProgress("saving")), heartbeatAt: new Date() } });
                const saved = await storeLead(candidate, verification);
                if (saved.stored && saved.reviewOnly) {
                  stats.manualReview += 1;
                  await markDecision(candidate, "manual_review", "manual_verification_required", saved.leadId);
                } else if (saved.stored) {
                  stats.stored += 1;
                  stats.withoutWebsite += 1;
                  stats.noWebsite += 1;
                  await markDecision(candidate, "stored", "no_website_confirmed", saved.leadId);
                } else {
                  stats.rejected += 1;
                  await markDecision(candidate, "rejected", rejectionCode(saved.reason));
                }
              } catch (error) {
                if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                  stats.duplicates += 1;
                  stats.existing += 1;
                  await markDecision(candidate, "duplicate", "race_condition_duplicate");
                } else {
                  stats.rejected += 1;
                  errors.push(`${candidate.companyName}: ${errorMessage(error)}`);
                  await markDecision(candidate, "rejected", "database_error");
                }
              }
            }
          }
        }
        if (processedThisBatch % 3 === 0) {
          await prisma.generationRun.update({ where: { id: runId }, data: { ...runData(stats, places, errors, warnings), message: `${stats.checked} kandidaten gecontroleerd; ${stats.duplicates} duplicaten overgeslagen.` } });
        }
        if (capacity(stats) >= run.targetCount) break;
      }

      await prisma.$transaction([
        prisma.coverageArea.update({ where: { id: area.id }, data: { lastScannedAt: new Date(), resultsFound: { increment: result.candidates.length } } }),
        prisma.searchCombination.update({
          where: { id: combination.id },
          data: { useCount: { increment: 1 }, candidatesFound: { increment: result.candidates.length }, validLeads: { increment: stats.stored + stats.manualReview - run.stored - run.manualReview }, lastUsedAt: new Date(), tileCursor: (tileCursor + 1) % 9, lastTile: result.tile, lastError: null },
        }),
      ]);
    } catch (error) {
      const message = errorMessage(error);
      batchMessage = `OpenStreetMap kon deze tegel niet ophalen: ${message} De volgende zoektegel kan opnieuw worden geprobeerd.`;
      stats.sourceFailures += 1;
      errors.push(`${adapter.id} / ${region} / ${area.category}: ${message}`);
      await Promise.all([
        logSource(runId, adapter.id, "ERROR", JSON.stringify({ jobId: runId, step: "source_failed", region, category: area.category, tile: tileLabel, errorType: "source_error", message }), area.city, area.category),
        prisma.coverageArea.update({ where: { id: area.id }, data: { lastScannedAt: new Date() } }),
        prisma.searchCombination.update({ where: { id: combination.id }, data: { useCount: { increment: 1 }, lastUsedAt: new Date(), tileCursor: (tileCursor + 1) % 9, lastTile: tileLabel, lastError: message } }),
      ]);
    }

    const refreshed = await prisma.generationRun.findUniqueOrThrow({ where: { id: runId } });
    if (refreshed.cancelRequested || refreshed.status === JobStatus.CANCELLED) return terminalRun(runId, JobStatus.CANCELLED, stats, places, errors, warnings, "De zoekrun is geannuleerd.");
    if (capacity(stats) >= run.targetCount) return terminalRun(runId, JobStatus.COMPLETE, stats, places, errors, warnings, `Doel bereikt: ${stats.stored} bevestigde leads en ${stats.manualReview} kandidaten voor handmatige controle.`);
    if (Date.now() >= deadline) return terminalRun(runId, JobStatus.TIMED_OUT, stats, places, errors, warnings, `De maximale veilige zoektijd is bereikt. ${stats.stored + stats.manualReview} nieuwe kandidaten zijn bewaard.`);

    const progress = Math.min(94, Math.max(refreshed.progress, phaseProgress("candidates") + Math.round((capacity(stats) / run.targetCount) * 45)));
    return prisma.generationRun.update({
      where: { id: runId },
      data: {
        ...runData(stats, places, errors, warnings),
        status: JobStatus.RUNNING,
        processedSegments: { increment: 1 },
        progress,
        currentPhase: "Zoekbatch afgerond",
        message: batchMessage ?? `${stats.found} kandidaten gevonden, ${stats.existing} bestaande resultaten overgeslagen en ${stats.stored + stats.manualReview} nieuwe kandidaten bewaard. De volgende tegel kan starten.`,
      },
    });
  } catch (error) {
    errors.push(errorMessage(error));
    return terminalRun(runId, JobStatus.FAILED, stats, places, errors, warnings, errorMessage(error));
  } finally {
    await lock.release();
  }
}

/** Local/cron compatibility: the web UI uses one resumable batch per request. */
export async function runLeadGeneration(runId: string) {
  let run = await prisma.generationRun.findUniqueOrThrow({ where: { id: runId } });
  while (!terminalStatuses.has(run.status)) run = await processGenerationBatch(runId);
  return run;
}
