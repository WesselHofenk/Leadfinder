import { createGenerationRun, processGenerationBatch } from "@/lib/jobs/generation";
import { generationResponse } from "@/lib/jobs/generation-response";
import { prisma } from "@/lib/prisma";

const terminal = new Set(["COMPLETE", "PARTIALLY_COMPLETED", "FAILED", "TIMED_OUT", "CANCELLED"]);

async function finishRun() {
  const created = await createGenerationRun();
  await Promise.all([
    processGenerationBatch(created.id),
    processGenerationBatch(created.id),
  ]);
  let run = await prisma.generationRun.findUniqueOrThrow({ where: { id: created.id } });
  const concurrencyProtected = run.batchNumber === 1;
  for (let batch = 0; batch < 12 && !terminal.has(run.status); batch += 1) {
    run = await processGenerationBatch(created.id);
  }
  const readback = await prisma.generationRun.findUniqueOrThrow({ where: { id: created.id } });
  if (!terminal.has(readback.status)) throw new Error(`Run ${created.id} bereikte geen terminale status.`);
  return {
    readback,
    response: generationResponse(readback),
    segments: Array.isArray(readback.placesUsed) ? readback.placesUsed.filter((value): value is string => typeof value === "string") : [],
    concurrencyProtected,
  };
}

async function main() {
  if (process.env.CONFIRM_TWO_RUN_E2E !== "yes") {
    throw new Error("Set CONFIRM_TWO_RUN_E2E=yes for the isolated development-database run.");
  }
  const beforeLeads = await prisma.lead.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  const first = await finishRun();
  const second = await finishRun();
  const afterLeads = await prisma.lead.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  const firstSegments = new Set(first.segments);
  const overlap = second.segments.filter((segment) => firstSegments.has(segment));
  const preservedIds = beforeLeads.every(({ id }) => afterLeads.some((lead) => lead.id === id));
  const logs = await prisma.sourceLog.groupBy({
    by: ["runId", "level"],
    where: { runId: { in: [first.readback.id, second.readback.id] } },
    _count: { _all: true },
  });
  const result = {
    runIdsDifferent: first.readback.id !== second.readback.id,
    segmentOverlap: overlap,
    existingLeadIdsPreserved: preservedIds,
    leadCountBefore: beforeLeads.length,
    leadCountAfter: afterLeads.length,
    first: {
      runId: first.readback.id,
      status: first.readback.status,
      exhausted: first.readback.exhausted,
      sourceRequests: first.readback.sourceRequests,
      sourceSuccesses: first.readback.sourceSuccesses,
      sourceFailures: first.readback.sourceFailures,
      candidatesFound: first.readback.candidatesFound,
      candidatesChecked: first.readback.candidatesChecked,
      stored: first.readback.stored,
      segments: first.segments,
      concurrencyProtected: first.concurrencyProtected,
      responseRunId: first.response.run?.id,
      stopReason: first.readback.stopReason,
    },
    second: {
      runId: second.readback.id,
      status: second.readback.status,
      exhausted: second.readback.exhausted,
      sourceRequests: second.readback.sourceRequests,
      sourceSuccesses: second.readback.sourceSuccesses,
      sourceFailures: second.readback.sourceFailures,
      candidatesFound: second.readback.candidatesFound,
      candidatesChecked: second.readback.candidatesChecked,
      stored: second.readback.stored,
      segments: second.segments,
      concurrencyProtected: second.concurrencyProtected,
      responseRunId: second.response.run?.id,
      stopReason: second.readback.stopReason,
    },
    logs,
  };
  console.info(JSON.stringify(result));
  if (!result.runIdsDifferent) throw new Error("De tweede klik kreeg geen nieuwe run-ID.");
  if (overlap.length) throw new Error(`Runs hergebruikten zoeksegmenten: ${overlap.join(", ")}`);
  if (!preservedIds) throw new Error("Een bestaand leadrecord is verdwenen.");
  if (!first.concurrencyProtected || !second.concurrencyProtected) throw new Error("Gelijktijdige batchcalls doorbraken de run-lock.");
  if (first.response.run?.id !== first.readback.id || second.response.run?.id !== second.readback.id) {
    throw new Error("De API/UI-response wijst niet naar de eigen persistente run.");
  }
}

main().finally(() => prisma.$disconnect());
