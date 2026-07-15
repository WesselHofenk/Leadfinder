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

export function isGenerationRunExpired(startedAt: Date | null, maxMinutes: number, now = new Date()) {
  return Boolean(startedAt && now.getTime() - startedAt.getTime() >= maxMinutes * 60_000);
}

export function sourceAttemptDelta(sourceSucceeded: boolean) {
  return { processedSegments: sourceSucceeded ? 1 : 0, sourceFailures: sourceSucceeded ? 0 : 1 } as const;
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

export function generationProgress(input: { stored: number; target: number; processedSegments: number; sourceFailures: number; maxSegments: number }) {
  const resultProgress = Math.min(72, Math.round((input.stored / Math.max(1, input.target)) * 72));
  const attemptedSegments = input.processedSegments + input.sourceFailures;
  const searchProgress = Math.min(18, Math.max(attemptedSegments > 0 ? 1 : 0, Math.round((attemptedSegments / Math.max(1, input.maxSegments)) * 18)));
  const phaseFloor = attemptedSegments > 0 ? phaseProgress("source") : phaseProgress("validate");
  return Math.min(94, Math.max(phaseFloor, phaseProgress("validate") + resultProgress + searchProgress));
}
