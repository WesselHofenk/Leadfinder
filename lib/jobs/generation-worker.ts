import "server-only";

import { DuplicateMessageError, send } from "@vercel/queue";

export const GENERATION_QUEUE_TOPIC = "lead-generation";

export function generationWorkerAvailable() {
  return process.env.VERCEL === "1";
}

export function generationQueueKey(runId: string, batchNumber: number) {
  return `generation:${runId}:after-batch:${Math.max(0, batchNumber)}`;
}

export async function triggerGenerationWorker(runId: string, batchNumber: number) {
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
      },
    );
    return true;
  } catch (error) {
    // The same run/batch key means an equivalent continuation is already queued.
    if (error instanceof DuplicateMessageError) return true;
    throw error;
  }
}
