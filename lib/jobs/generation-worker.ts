import "server-only";

import { DuplicateMessageError, send } from "@vercel/queue";

export const GENERATION_QUEUE_TOPIC = "lead-generation-v2";
export const GENERATION_CONTINUATION_DELAY_SECONDS = 5 * 60;
export const GENERATION_RECOVERY_GRACE_SECONDS = 2 * 60;

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
        ...(delaySeconds > 0 ? { delaySeconds: Math.min(GENERATION_CONTINUATION_DELAY_SECONDS, Math.max(1, Math.ceil(delaySeconds))) } : {}),
      },
    );
    return true;
  } catch (error) {
    if (error instanceof DuplicateMessageError) return true;
    throw error;
  }
}

export function generationContinuationDelaySeconds() {
  return GENERATION_CONTINUATION_DELAY_SECONDS;
}

export function isGenerationWorkerHeartbeatHealthy(lastHeartbeatAt: Date | null, now = new Date()) {
  if (!lastHeartbeatAt) return false;
  const recoveryAfterMs = (GENERATION_CONTINUATION_DELAY_SECONDS + GENERATION_RECOVERY_GRACE_SECONDS) * 1_000;
  return now.getTime() - lastHeartbeatAt.getTime() < recoveryAfterMs;
}
