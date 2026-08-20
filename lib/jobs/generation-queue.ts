import "server-only";

import type { MessageMetadata } from "@vercel/queue";
import { z } from "zod";

import { getLeadfinderTaskSnapshot, LEADFINDER_TASK_ID } from "./automation-tasks";
import { runGenerationWatchdog } from "./generation";
import { generationContinuationDelaySeconds, generationQueueKey, triggerGenerationWorker } from "./generation-worker";

const messageSchema = z.object({ taskId: z.literal(LEADFINDER_TASK_ID) });

export async function handleGenerationQueueMessage(message: unknown, metadata: MessageMetadata) {
  const parsed = messageSchema.safeParse(message);
  if (!parsed.success) {
    console.error(JSON.stringify({ step: "generation_queue_message_invalid", messageId: metadata.messageId }));
    return;
  }

  const result = await runGenerationWatchdog();
  if (!result.active) return;
  if (result.reason === "buffer_ready") return;

  const snapshot = await getLeadfinderTaskSnapshot();
  if (!snapshot.task.enabled || !snapshot.run) return;

  await triggerGenerationWorker(
    generationQueueKey(snapshot.run.id, snapshot.run.batchNumber),
    generationContinuationDelaySeconds(),
  );
}
