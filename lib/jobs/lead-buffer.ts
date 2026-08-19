import "server-only";

import { coldEmailEligibleLeadWhere } from "@/lib/email/eligibility";
import { serverEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { generationWorkerAvailable, triggerGenerationWorker } from "./generation-worker";

export async function getLeadBufferSnapshot() {
  const target = serverEnv().LEAD_NEW_BUFFER_TARGET;
  const [eligible, latest] = await Promise.all([
    prisma.lead.count({ where: coldEmailEligibleLeadWhere() }),
    prisma.lead.findFirst({
      where: { batchId: { not: null } },
      orderBy: { firstDiscoveredAt: "desc" },
      select: { firstDiscoveredAt: true },
    }),
  ]);
  return {
    eligible,
    target,
    needsRefill: eligible < target,
    lastSuccessfulLeadAt: latest?.firstDiscoveredAt ?? null,
  };
}

/** Email reservations can drain Nieuw; only a manually active task may be woken. */
export async function requestLeadBufferRefill(idempotencyKey: string) {
  if (!generationWorkerAvailable()) return false;
  const task = await prisma.leadfinderTask.findUnique({ where: { id: "leadfinder-continuous" }, select: { enabled: true } });
  if (!task?.enabled) return false;
  const buffer = await getLeadBufferSnapshot();
  if (!buffer.needsRefill) return false;
  return triggerGenerationWorker(idempotencyKey);
}
