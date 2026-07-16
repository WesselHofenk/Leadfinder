type GenerationSummaryRun = {
  id: string;
  status: string;
  targetCount?: number;
  stored?: number;
  candidatesChecked?: number;
  websitesFound?: number;
  permanentlyClosed?: number;
  temporarilyClosed?: number;
  duplicates?: number;
  rejected?: number;
  sourceFailures?: number;
  multipleLocationsRejected?: number;
  chainRejected?: number;
  franchiseRejected?: number;
  sameNameMultipleAddresses?: number;
  samePhoneMultipleAddresses?: number;
  locationCountUncertain?: number;
  duplicateListingsMerged?: number;
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
    savedCount: run?.stored ?? 0,
    candidatesChecked: run?.candidatesChecked ?? 0,
    rejectedWithWebsite,
    rejectedClosed: (run?.permanentlyClosed ?? 0) + (run?.temporarilyClosed ?? 0),
    rejectedDuplicate: run?.duplicates ?? 0,
    rejectedInvalid: Math.max(0, (run?.rejected ?? 0) - rejectedWithWebsite),
    failedQueries: run?.sourceFailures ?? 0,
    rejectedMultipleLocations: run?.multipleLocationsRejected ?? 0,
    rejectedChains: run?.chainRejected ?? 0,
    rejectedFranchises: run?.franchiseRejected ?? 0,
    rejectedSameNameDifferentAddress: run?.sameNameMultipleAddresses ?? 0,
    rejectedSamePhoneDifferentAddress: run?.samePhoneMultipleAddresses ?? 0,
    uncertainLocationCount: run?.locationCountUncertain ?? 0,
    mergedDuplicateListings: run?.duplicateListingsMerged ?? 0,
    progress: run?.progress ?? 0,
    message: run?.stopReason || run?.message || fallbackMessage || "Geen actieve zoekrun.",
    run,
  };
}
