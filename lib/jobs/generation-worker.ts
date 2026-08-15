import "server-only";

import { DuplicateMessageError, send } from "@vercel/queue";

export const GENERATION_QUEUE_TOPIC = "lead-generation";

export function generationWorkerAvailable() {
  return process.env.VERCEL === "1";
}

export function generationQueueKey(runId: string, batchNumber: number) {
  return `generation:${runId}:after-batch:${Math.max(0, batchNumber)}`;
}

export function generationActivationKey(updatedAt: Date) {
  return `generation:manual-start:${updatedAt.getTime()}`;
}

export function generationRecoveryKey(now = new Date()) {
  return `generation:manual-recovery:${Math.floor(now.getTime() / 60_000)}`;
}

export async function triggerGenerationWorker(idempotencyKey: string, delaySeconds = 0) {
  if (!generationWorkerAvailable()) return false;
  try {
    await send(
      GENERATION_QUEUE_TOPIC,
      { taskId: "leadfinder-continuous" },
      {
        idempotencyKey,
        retentionSeconds: 86_400,
        ...(delaySeconds > 0 ? { delaySeconds: Math.min(300, Math.max(1, Math.ceil(delaySeconds))) } : {}),
      },
    );
    return true;
  } catch (error) {
    if (error instanceof DuplicateMessageError) return true;
    throw error;
  }
}

export function generationContinuationDelaySeconds(lastError?: string | null) {
  return lastError?.startsWith("SOURCE_CIRCUIT_OPEN:") ? 30 : 1;
}
