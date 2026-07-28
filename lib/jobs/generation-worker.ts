import "server-only";

import { DuplicateMessageError, send } from "@vercel/queue";
import { GENERATION_MAX_RUN_MINUTES } from "./generation-state";

export const GENERATION_QUEUE_TOPIC = "lead-generation";

export function generationWorkerAvailable() {
  return process.env.VERCEL === "1";
}

export function generationQueueKey(runId: string, batchNumber: number) {
  return `generation:${runId}:after-batch:${Math.max(0, batchNumber)}`;
}

export function generationWatchdogKey(runId: string) {
  return `generation:${runId}:deadline-watchdog`;
}

export async function triggerGenerationWorker(runId: string, batchNumber: number, delaySeconds = 0) {
  if (!generationWorkerAvailable()) {
    console.warn(JSON.stringify({ jobId: runId, step: "background_worker_unavailable", reason: "Vercel Queue is alleen op Vercel actief" }));
    return false;
  }

  try {
    await send(
      GENERATION_QUEUE_TOPIC,
      { runId },
      {
        idempotencyKey: generationQueueKey(runId, batchNumber),
        retentionSeconds: 86_400,
        ...(delaySeconds > 0 ? { delaySeconds: Math.min(300, Math.max(1, Math.ceil(delaySeconds))) } : {}),
      },
    );
    return true;
  } catch (error) {
    // The same run/batch key means an equivalent continuation is already queued.
    if (error instanceof DuplicateMessageError) return true;
    throw error;
  }
}

export function generationContinuationDelaySeconds(lastError?: string | null) {
  return lastError?.startsWith("SOURCE_CIRCUIT_OPEN:") ? 30 : 0;
}

export async function scheduleGenerationWatchdog(runId: string, startedAt: Date) {
  if (!generationWorkerAvailable()) return false;
  const deadline = startedAt.getTime() + GENERATION_MAX_RUN_MINUTES * 60_000;
  const delaySeconds = Math.max(1, Math.ceil((deadline - Date.now()) / 1_000) + 2);
  try {
    await send(
      GENERATION_QUEUE_TOPIC,
      { runId },
      {
        idempotencyKey: generationWatchdogKey(runId),
        retentionSeconds: 86_400,
        delaySeconds,
      },
    );
    return true;
  } catch (error) {
    if (error instanceof DuplicateMessageError) return true;
    throw error;
  }
}
