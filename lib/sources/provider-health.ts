import type { OverpassEvent } from "@/lib/openstreetmap/overpass";
import { prisma } from "@/lib/prisma";

const failureThreshold = 2;

function cooldownMs(errorType?: string) {
  if (errorType === "http_429") return 5 * 60_000;
  if (errorType === "timeout") return 2 * 60_000;
  if (errorType?.startsWith("http_5")) return 3 * 60_000;
  return 60_000;
}

/** Persisted circuit state survives separate Vercel function invocations. */
export async function healthySourceEndpoints(endpoints: string[], now = new Date()) {
  if (!process.env.NEON_POSTGRES_PRISMA_URL) return endpoints;
  const rows = await prisma.sourceProviderHealth.findMany({
    where: { provider: { in: endpoints } },
    select: { provider: true, unhealthyUntil: true, consecutiveFailures: true },
  }).catch(() => []);
  const byProvider = new Map(rows.map((row) => [row.provider, row]));
  const healthy = endpoints.filter((endpoint) => {
    const row = byProvider.get(endpoint);
    return !row?.unhealthyUntil || row.unhealthyUntil <= now;
  });
  const coolingDown = endpoints.filter((endpoint) => !healthy.includes(endpoint))
    .sort((left, right) => (byProvider.get(left)?.unhealthyUntil?.getTime() ?? 0) - (byProvider.get(right)?.unhealthyUntil?.getTime() ?? 0));
  // Persistent health is advisory: always retain at least two independent
  // half-open fallbacks so stale serverless circuit state cannot pin a run to
  // one provider that is still unavailable.
  return [...healthy, ...coolingDown].slice(0, Math.min(3, Math.max(2, endpoints.length)));
}

export async function recordSourceProviderEvent(event: OverpassEvent, now = new Date()) {
  if (!process.env.NEON_POSTGRES_PRISMA_URL) return;
  if (event.errorType === "cancelled") return;
  const current = await prisma.sourceProviderHealth.findUnique({ where: { provider: event.endpoint } });
  const checks = (current?.totalFailures ?? 0) + (current?.totalSuccesses ?? 0);
  const averageDurationMs = Math.round((((current?.averageDurationMs ?? 0) * checks) + event.durationMs) / (checks + 1));
  if (!event.errorType && event.statusCode && event.statusCode >= 200 && event.statusCode < 300) {
    return prisma.sourceProviderHealth.upsert({
      where: { provider: event.endpoint },
      create: { provider: event.endpoint, totalSuccesses: 1, lastDurationMs: event.durationMs, averageDurationMs, lastCheckedAt: now, lastSuccessAt: now },
      update: { consecutiveFailures: 0, totalSuccesses: { increment: 1 }, unhealthyUntil: null, lastErrorCode: null, lastErrorMessage: null, lastDurationMs: event.durationMs, averageDurationMs, lastCheckedAt: now, lastSuccessAt: now },
    });
  }
  const failures = (current?.consecutiveFailures ?? 0) + 1;
  return prisma.sourceProviderHealth.upsert({
    where: { provider: event.endpoint },
    create: {
      provider: event.endpoint, consecutiveFailures: 1, totalFailures: 1,
      unhealthyUntil: failures >= failureThreshold ? new Date(now.getTime() + cooldownMs(event.errorType)) : null,
      lastErrorCode: event.errorType ?? "SOURCE_ERROR", lastErrorMessage: event.message.slice(0, 500),
      lastDurationMs: event.durationMs, averageDurationMs, lastCheckedAt: now,
    },
    update: {
      consecutiveFailures: { increment: 1 }, totalFailures: { increment: 1 },
      unhealthyUntil: failures >= failureThreshold ? new Date(now.getTime() + cooldownMs(event.errorType)) : null,
      lastErrorCode: event.errorType ?? "SOURCE_ERROR", lastErrorMessage: event.message.slice(0, 500),
      lastDurationMs: event.durationMs, averageDurationMs, lastCheckedAt: now,
    },
  });
}
