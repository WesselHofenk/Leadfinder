import { GENERATION_MAX_RUN_MINUTES } from "./generation-state";

export const ACTIVE_GENERATION_POLL_MS = 5_000;
export const HIDDEN_GENERATION_POLL_MS = 30_000;
export const MAX_GENERATION_POLL_MS = (GENERATION_MAX_RUN_MINUTES + 2) * 60_000;

export function generationPollingDelay(hidden: boolean, consecutiveFailures: number) {
  const base = hidden ? HIDDEN_GENERATION_POLL_MS : ACTIVE_GENERATION_POLL_MS;
  return Math.min(60_000, base * 2 ** Math.min(3, Math.max(0, consecutiveFailures)));
}

export function generationPollingExpired(startedAt: string | undefined, pollingStartedAt: number, now = Date.now()) {
  const parsedStartedAt = startedAt ? Date.parse(startedAt) : Number.NaN;
  const reference = Number.isFinite(parsedStartedAt) ? parsedStartedAt : pollingStartedAt;
  return now - reference >= MAX_GENERATION_POLL_MS;
}
