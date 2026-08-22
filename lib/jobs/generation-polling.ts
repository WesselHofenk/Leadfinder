import { GENERATION_MAX_RUN_MINUTES } from "./generation-state";

export const ACTIVE_GENERATION_POLL_MS = 60_000;
export const IDLE_GENERATION_POLL_MS = 5 * 60_000;
export const HIDDEN_GENERATION_POLL_MS = 5 * 60_000;
export const MAX_GENERATION_POLL_MS = (GENERATION_MAX_RUN_MINUTES + 2) * 60_000;

export function generationPollingDelay(hidden: boolean, consecutiveFailures: number, active = true) {
  const base = hidden ? HIDDEN_GENERATION_POLL_MS : active ? ACTIVE_GENERATION_POLL_MS : IDLE_GENERATION_POLL_MS;
  return Math.min(IDLE_GENERATION_POLL_MS, base * 2 ** Math.min(3, Math.max(0, consecutiveFailures)));
}

export function generationPollingExpired(startedAt: string | undefined, pollingStartedAt: number, now = Date.now()) {
  const parsedStartedAt = startedAt ? Date.parse(startedAt) : Number.NaN;
  const reference = Number.isFinite(parsedStartedAt) ? parsedStartedAt : pollingStartedAt;
  return now - reference >= MAX_GENERATION_POLL_MS;
}
