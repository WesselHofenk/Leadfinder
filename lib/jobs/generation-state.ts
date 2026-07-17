export const terminalGenerationStatuses = ["COMPLETE", "PARTIALLY_COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"] as const;

export function isTerminalGenerationStatus(status: string) {
  return (terminalGenerationStatuses as readonly string[]).includes(status);
}

export function phaseProgress(phase: "queued" | "validate" | "location" | "source" | "candidates" | "websites" | "dedupe" | "saving" | "done") {
  return { queued: 5, validate: 15, location: 30, source: 30, candidates: 50, websites: 65, dedupe: 88, saving: 95, done: 100 }[phase];
}

export function isStaleGenerationRun(updatedAt: Date, now = new Date(), watchdogSeconds = 60) {
  return now.getTime() - updatedAt.getTime() > watchdogSeconds * 1000;
}

export function isBatchDeadlineNear(deadlineMs: number, nowMs = Date.now(), reserveMs = 6_000) {
  return nowMs >= deadlineMs - reserveMs;
}

export function isGenerationRunExpired(startedAt: Date | null, maxMinutes: number, now = new Date()) {
  return Boolean(startedAt && now.getTime() - startedAt.getTime() >= maxMinutes * 60_000);
}

export function sourceAttemptDelta(sourceSucceeded: boolean) {
  return { processedSegments: sourceSucceeded ? 1 : 0, sourceFailures: sourceSucceeded ? 0 : 1 } as const;
}

export function sourceFailureWarningDue(sourceFailures: number, warningInterval: number) {
  return sourceFailures > 0 && sourceFailures % Math.max(1, warningInterval) === 0;
}

export function generationCompletionStatus(input: { usable: number; target: number; processedSegments: number; sourceFailures?: number; maxSegments: number; pendingCandidates: number }) {
  if (input.usable >= input.target) return "COMPLETE" as const;
  if (input.processedSegments + (input.sourceFailures ?? 0) >= input.maxSegments && input.pendingCandidates === 0) {
    return input.usable > 0 ? "PARTIALLY_COMPLETED" as const : "FAILED" as const;
  }
  return null;
}

export function candidateRetryStatus(attemptsAfterClaim: number, maxAttempts = 3) {
  return attemptsAfterClaim >= maxAttempts ? "FAILED" as const : "PENDING" as const;
}

export function generationRetryImportLimit(batchCandidates: number, alreadyRetried: number, maxPerRun = 2) {
  const batchShare = Math.min(maxPerRun, Math.max(1, Math.floor(batchCandidates / 3)));
  return Math.max(0, batchShare - alreadyRetried);
}

export function candidateReservationLimit(maxCandidates: number, alreadyReserved: number, available: number) {
  return Math.max(0, Math.min(available, maxCandidates - alreadyReserved));
}

export function generationProgress(input: { stored: number; target: number; candidatesChecked?: number; maxCandidates?: number; processedSegments: number; sourceFailures: number; maxSegments: number }) {
  const resultProgress = Math.min(10, Math.round((input.stored / Math.max(1, input.target)) * 10));
  const attemptedSegments = input.processedSegments + input.sourceFailures;
  const progressHorizon = Math.max(2, Math.min(100, input.maxSegments));
  const searchProgress = attemptedSegments > 0
    ? Math.min(12, Math.ceil((Math.log1p(attemptedSegments) / Math.log1p(progressHorizon)) * 12))
    : 0;
  const validationProgress = Math.min(42, Math.round(((input.candidatesChecked ?? 0) / Math.max(1, input.maxCandidates ?? input.target)) * 42));
  const phaseFloor = attemptedSegments > 0 ? phaseProgress("source") : phaseProgress("validate");
  return Math.min(94, Math.max(phaseFloor, phaseProgress("source") + resultProgress + searchProgress + validationProgress));
}
