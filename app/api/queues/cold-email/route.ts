import { handleCallback } from "@vercel/queue";
import { handleColdEmailQueueMessage } from "@/lib/email/worker";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const queueCallback = handleCallback<{ emailId: string }>(handleColdEmailQueueMessage, {
  visibilityTimeoutSeconds: 90,
});

export async function POST(request: Request) {
  return queueCallback(request);
}
