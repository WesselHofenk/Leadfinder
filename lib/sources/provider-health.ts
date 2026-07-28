import type { OverpassEvent } from "@/lib/openstreetmap/overpass";
import { prisma } from "@/lib/prisma";

const failureThreshold = 2;
const unknownLatencyMs = 30_000;

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
    select: {
      provider: true,
      unhealthyUntil: true,
      consecutiveFailures: true,
      totalFailures: true,
      totalSuccesses: true,
      averageDurationMs: true,
      lastSuccessAt: true,
    },
  }).catch(() => []);
  const byProvider = new Map(rows.map((row) => [row.provider, row]));
  const healthy = endpoints.filter((endpoint) => {
    const row = byProvider.get(endpoint);
    return !row?.unhealthyUntil || row.unhealthyUntil <= now;
  });
  const rank = (endpoint: string) => {
    const row = byProvider.get(endpoint);
    if (!row) return 0;
    const attempts = (row.totalSuccesses ?? 0) + (row.totalFailures ?? 0);
    const successRate = (row.totalSuccesses ?? 0) / Math.max(1, attempts);
    const recentSuccessHours = row.lastSuccessAt
      ? Math.max(0, now.getTime() - row.lastSuccessAt.getTime()) / 3_600_000
      : 10_000;
    const recentSuccessBoost = recentSuccessHours <= 24 ? 1_000 - recentSuccessHours * 10 : 0;
    const latencyPenalty = Math.min(500, (row.averageDurationMs || unknownLatencyMs) / 100);
    return recentSuccessBoost + successRate * 500 - (row.consecutiveFailures ?? 0) * 150 - latencyPenalty;
  };
  // An open PostgreSQL circuit is a real skip, not merely a sort hint. A host
  // is eligible again automatically after unhealthyUntil, at which point a
  // normal request acts as the half-open recovery probe.
  return healthy.slice().sort((left, right) => rank(right) - rank(left)).slice(0, 3);
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
