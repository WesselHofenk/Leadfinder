import { handleCallback } from "@vercel/queue";

import { handleGenerationQueueMessage } from "@/lib/jobs/generation-queue";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const queueCallback = handleCallback<{ runId: string }>(
  handleGenerationQueueMessage,
  {
    visibilityTimeoutSeconds: 90,
  },
);

export async function POST(request: Request) {
  return queueCallback(request);
}
