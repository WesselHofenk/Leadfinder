import "server-only";

import { JobStatus } from "@prisma/client";
import type { MessageMetadata } from "@vercel/queue";
import { z } from "zod";

import { processGenerationBatch } from "./generation";
import { generationContinuationDelaySeconds, triggerGenerationWorker } from "./generation-worker";

const messageSchema = z.object({ runId: z.string().cuid() });
const activeStatuses = new Set<JobStatus>([JobStatus.PENDING, JobStatus.RUNNING]);

export async function handleGenerationQueueMessage(
  message: { runId: string },
  metadata: MessageMetadata,
) {
  const parsed = messageSchema.safeParse(message);
  if (!parsed.success) {
    console.error(JSON.stringify({
      step: "generation_queue_message_invalid",
      messageId: metadata.messageId,
    }));
    return;
  }

  const run = await processGenerationBatch(parsed.data.runId);
  if (activeStatuses.has(run.status)) {
    await triggerGenerationWorker(run.id, run.batchNumber, generationContinuationDelaySeconds(run.lastError));
  }
}
