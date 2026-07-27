import "server-only";

export function generationWorkerAvailable() {
  return Boolean(process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 32);
}

export async function triggerGenerationWorker(runId: string, requestUrl: string) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) {
    console.warn(JSON.stringify({ jobId: runId, step: "background_worker_unavailable", reason: "CRON_SECRET ontbreekt" }));
    return false;
  }
  const endpoint = new URL("/api/cron/generation", requestUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ runId }),
    cache: "no-store",
    signal: AbortSignal.timeout(58_000),
  });
  if (!response.ok) throw new Error(`Achtergrondworker antwoordde met HTTP ${response.status}.`);
  return true;
}
