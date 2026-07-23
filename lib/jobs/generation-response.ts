import { MAX_CANDIDATES_PER_RUN } from "./generation-config";

type GenerationSummaryRun = {
  id: string;
  status: string;
  targetCount?: number;
  maxCandidates?: number;
  candidatesReserved?: number;
  stored?: number;
  candidatesChecked?: number;
  websitesFound?: number;
  permanentlyClosed?: number;
  temporarilyClosed?: number;
  duplicates?: number;
  rejected?: number;
  sourceFailures?: number;
  consecutiveSourceFailures?: number;
  multipleLocationsRejected?: number;
  chainRejected?: number;
  franchiseRejected?: number;
  sameNameMultipleAddresses?: number;
  samePhoneMultipleAddresses?: number;
  locationCountUncertain?: number;
  duplicateListingsMerged?: number;
  emailsFound?: number;
  emailsMissing?: number;
  emailsInvalid?: number;
  emailRetries?: number;
  emailsExternallyVerified?: number;
  remainingSegments?: number | null;
  progress?: number;
  message?: string | null;
  stopReason?: string | null;
};

/** Stable top-level API summary; `run` remains available for resumable UI polling. */
export function generationResponse(run: GenerationSummaryRun | null, success = true, fallbackMessage?: string) {
  const rejectedWithWebsite = run?.websitesFound ?? 0;
  return {
    success,
    jobId: run?.id ?? null,
    status: run?.status ?? null,
    requestedCount: run?.targetCount ?? 50,
    maxCandidates: Math.min(run?.maxCandidates ?? MAX_CANDIDATES_PER_RUN, MAX_CANDIDATES_PER_RUN),
    candidatesReserved: run?.candidatesReserved ?? 0,
    savedCount: run?.stored ?? 0,
    candidatesChecked: run?.candidatesChecked ?? 0,
    rejectedWithWebsite,
    rejectedClosed: (run?.permanentlyClosed ?? 0) + (run?.temporarilyClosed ?? 0),
    rejectedDuplicate: run?.duplicates ?? 0,
    rejectedInvalid: Math.max(0, (run?.rejected ?? 0) - rejectedWithWebsite),
    failedQueries: run?.sourceFailures ?? 0,
    consecutiveFailedQueries: run?.consecutiveSourceFailures ?? 0,
    rejectedMultipleLocations: run?.multipleLocationsRejected ?? 0,
    rejectedChains: run?.chainRejected ?? 0,
    rejectedFranchises: run?.franchiseRejected ?? 0,
    rejectedSameNameDifferentAddress: run?.sameNameMultipleAddresses ?? 0,
    rejectedSamePhoneDifferentAddress: run?.samePhoneMultipleAddresses ?? 0,
    uncertainLocationCount: run?.locationCountUncertain ?? 0,
    mergedDuplicateListings: run?.duplicateListingsMerged ?? 0,
    emailsFound: run?.emailsFound ?? 0,
    emailsMissing: run?.emailsMissing ?? 0,
    emailsInvalid: run?.emailsInvalid ?? 0,
    emailRetries: run?.emailRetries ?? 0,
    emailsExternallyVerified: run?.emailsExternallyVerified ?? 0,
    remainingSegments: run?.remainingSegments ?? null,
    progress: run?.progress ?? 0,
    message: run?.stopReason || run?.message || fallbackMessage || "Geen actieve zoekrun.",
    run,
  };
}
