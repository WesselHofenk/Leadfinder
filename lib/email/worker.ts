import "server-only";
import { DuplicateMessageError, send } from "@vercel/queue";
import { prisma } from "@/lib/prisma";

export const COLD_EMAIL_QUEUE_TOPIC = "cold-email-delivery";
const MAX_QUEUE_DELAY_SECONDS = 7 * 24 * 60 * 60;

export function coldEmailWorkerAvailable() {
  return process.env.VERCEL === "1";
}

export async function triggerColdEmailWorker(emailId: string, scheduledFor: Date, attempt = 0) {
  if (!coldEmailWorkerAvailable()) return false;
  const delaySeconds = Math.max(0, Math.ceil((scheduledFor.getTime() - Date.now()) / 1_000));
  if (delaySeconds > MAX_QUEUE_DELAY_SECONDS) return false;
  try {
    await send(COLD_EMAIL_QUEUE_TOPIC, { emailId }, {
      idempotencyKey: `cold-email:${emailId}:${scheduledFor.getTime()}:${attempt}`,
      retentionSeconds: MAX_QUEUE_DELAY_SECONDS,
      ...(delaySeconds > 0 ? { delaySeconds } : {}),
    });
    return true;
  } catch (error) {
    if (error instanceof DuplicateMessageError) return true;
    throw error;
  }
}

export async function handleColdEmailQueueMessage(message: { emailId: string }) {
  const { deliverColdEmail } = await import("./service");
  try {
    const delivered = await deliverColdEmail(message.emailId);
    if (["PENDING", "FAILED"].includes(delivered.status) && delivered.attempts < 3 && delivered.scheduledFor > new Date()) {
      await triggerColdEmailWorker(delivered.id, delivered.scheduledFor, delivered.attempts);
    }
  } catch (error) {
    const email = await prisma.coldEmail.findUnique({ where: { id: message.emailId } });
    if (email?.status === "FAILED" && email.attempts < 3) {
      await triggerColdEmailWorker(email.id, email.scheduledFor, email.attempts);
      return;
    }
    if (email?.status === "FAILED" && email.attempts >= 3) return;
    throw error;
  } finally {
    const email = await prisma.coldEmail.findUnique({ where: { id: message.emailId } }).catch(() => null);
    if (email && (["SENT", "CANCELLED"].includes(email.status) || (email.status === "FAILED" && email.attempts >= 3))) {
      const { ensureDailyColdEmailBatch } = await import("./campaign");
      await ensureDailyColdEmailBatch(new Date()).catch(() => undefined);
    }
  }
}
