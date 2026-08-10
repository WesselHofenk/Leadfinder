import { createGenerationRun, processGenerationBatch } from "@/lib/jobs/generation";
import { prisma } from "@/lib/prisma";

const terminal = new Set(["COMPLETE", "PARTIALLY_COMPLETED", "FAILED", "TIMED_OUT", "CANCELLED"]);

async function main() {
  if (process.env.CONFIRM_SOURCE_OUTAGE_E2E !== "yes") {
    throw new Error("Set CONFIRM_SOURCE_OUTAGE_E2E=yes for the isolated development-database run.");
  }
  const beforeLeadCount = await prisma.lead.count();
  const created = await createGenerationRun();
  await Promise.all([
    processGenerationBatch(created.id),
    processGenerationBatch(created.id),
  ]);
  let run = await prisma.generationRun.findUniqueOrThrow({ where: { id: created.id } });
  const concurrentBatchNumber = run.batchNumber;
  for (let batch = 0; batch < 6 && !terminal.has(run.status); batch += 1) {
    run = await processGenerationBatch(created.id);
  }
  const [afterLeadCount, sourceLogs] = await Promise.all([
    prisma.lead.count(),
    prisma.sourceLog.count({ where: { runId: created.id, source: "OPENSTREETMAP" } }),
  ]);
  const readback = await prisma.generationRun.findUniqueOrThrow({ where: { id: created.id } });
  console.info(JSON.stringify({
    runId: readback.id,
    status: readback.status,
    sourceRequests: readback.sourceRequests,
    sourceSuccesses: readback.sourceSuccesses,
    sourceRequestFailures: readback.sourceRequests - readback.sourceSuccesses,
    sourceBatchFailures: readback.sourceFailures,
    candidatesFound: readback.candidatesFound,
    candidatesChecked: readback.candidatesChecked,
    validCandidates: readback.validCandidates,
    databaseInsertAttempts: readback.databaseInsertAttempts,
    databaseInsertFailures: readback.databaseInsertFailures,
    stored: readback.stored,
    totalDurationMs: readback.totalDurationMs,
    beforeLeadCount,
    afterLeadCount,
    existingLeadsPreserved: beforeLeadCount === afterLeadCount,
    sourceLogs,
    concurrencyProtected: concurrentBatchNumber === 1,
    stopReason: readback.stopReason,
  }));
  if (!terminal.has(readback.status)) throw new Error("Run did not reach a truthful terminal status.");
  if (beforeLeadCount !== afterLeadCount) throw new Error("Source-outage run unexpectedly changed Lead rows.");
}

main().finally(() => prisma.$disconnect());
