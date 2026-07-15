export const terminalGenerationStatuses = ["COMPLETE", "FAILED", "CANCELLED", "TIMED_OUT"] as const;

export function isTerminalGenerationStatus(status: string) {
  return (terminalGenerationStatuses as readonly string[]).includes(status);
}

export function phaseProgress(phase: "queued" | "validate" | "location" | "source" | "candidates" | "websites" | "dedupe" | "saving" | "done") {
  return { queued: 2, validate: 5, location: 10, source: 15, candidates: 45, websites: 70, dedupe: 85, saving: 92, done: 100 }[phase];
}

export function isStaleGenerationRun(updatedAt: Date, now = new Date(), watchdogSeconds = 60) {
  return now.getTime() - updatedAt.getTime() > watchdogSeconds * 1000;
}
