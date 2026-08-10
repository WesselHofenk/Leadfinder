import type { Candidate } from "@/lib/leads/eligibility";

export const terminalGenerationStatuses = ["COMPLETE", "PARTIALLY_COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"] as const;

export function isTerminalGenerationStatus(status: string) {
  return (terminalGenerationStatuses as readonly string[]).includes(status);
}

export function phaseProgress(phase: "queued" | "validate" | "location" | "source" | "candidates" | "websites" | "dedupe" | "saving" | "done") {
  return { queued: 2, validate: 5, location: 10, source: 15, candidates: 45, websites: 70, dedupe: 85, saving: 92, done: 100 }[phase];
}

export function isStaleGenerationRun(updatedAt: Date, now = new Date(), watchdogSeconds = 60) {
  return now.getTime() - updatedAt.getTime() > watchdogSeconds * 1000;
}

export function isBatchDeadlineNear(deadlineMs: number, nowMs = Date.now(), reserveMs = 6_000) {
  return nowMs >= deadlineMs - reserveMs;
}

/** A search is continuous; only the user can end its overall run. */
export function isGenerationRunExpired(_startedAt: Date | null, _maxMinutes: number, _now = new Date()) {
  void _startedAt;
  void _maxMinutes;
  void _now;
  return false;
}

export function terminalStatusForStoredLeads(stored: number) {
  return stored > 0 ? "PARTIALLY_COMPLETED" as const : "COMPLETE" as const;
}

export function sourceAttemptDelta(sourceSucceeded: boolean) {
  return { processedSegments: sourceSucceeded ? 1 : 0, sourceFailures: sourceSucceeded ? 0 : 1 } as const;
}

export function shouldFetchFreshSource(input: { queuedCount: number; queuedOnlyRetries: boolean; batchNumber: number }) {
  if (input.queuedCount === 0) return true;
  return input.queuedOnlyRetries && input.batchNumber % 3 === 0;
}

export function shouldStopForSourceFailures(input: { sourceFailures: number; processedSegments: number; maxFailures: number }) {
  return input.sourceFailures >= input.maxFailures && input.sourceFailures > input.processedSegments;
}

export function generationCompletionStatus(input: { usable: number; target: number; processedSegments: number; maxSegments: number; pendingCandidates: number }) {
  if (input.usable >= input.target) return "COMPLETE" as const;
  if (input.processedSegments >= input.maxSegments && input.pendingCandidates === 0) {
    return input.usable > 0 ? "PARTIALLY_COMPLETED" as const : "COMPLETE" as const;
  }
  return null;
}

export function candidateRetryStatus(attemptsAfterClaim: number, maxAttempts = 3) {
  return attemptsAfterClaim >= maxAttempts ? "FAILED" as const : "PENDING" as const;
}

export function unwrapGenerationCandidatePayload(payload: unknown, expectedExternalPlaceId: string): Candidate {
  const value = payload as { externalPlaceId?: unknown; candidate?: unknown } | null;
  const direct = value && typeof value.externalPlaceId === "string" ? value : null;
  const nested = value?.candidate as { externalPlaceId?: unknown } | null | undefined;
  const candidate = direct ?? (nested && typeof nested.externalPlaceId === "string" ? nested : null);
  if (!candidate || candidate.externalPlaceId !== expectedExternalPlaceId) {
    throw new Error("Ongeldige kandidaatpayload in de persistente queue.");
  }
  return candidate as Candidate;
}

const reviewRetryReasons = new Set([
  "SKIPPED_WEBSITE_UNKNOWN",
  "website_check_failed",
  "email_validation_unavailable",
  "database_error",
  "vestigingsaantal_onzeker",
  "locatie_niet_nederlandstalig_vlaanderen",
  "deadline_before_final_checks",
]);

/** Reasons that lack conclusive evidence and therefore belong in review/retry, not rejection. */
export function isReviewRetryReason(reason: string) {
  return reviewRetryReasons.has(reason);
}
