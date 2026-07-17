import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const requestedRunId = process.argv[2];

async function main() {
  const run = requestedRunId
    ? await prisma.generationRun.findUnique({ where: { id: requestedRunId } })
    : await prisma.generationRun.findFirst({ orderBy: { createdAt: "desc" } });
  if (!run) throw new Error("Geen generatierun gevonden.");

  const candidates = await prisma.generationCandidate.findMany({
    where: { runId: run.id },
    select: { source: true, sourceRecordId: true, status: true, attempts: true, lastError: true },
  });
  const sourceRecords = candidates.length ? await prisma.sourceRecord.findMany({
    where: { OR: candidates.map(({ source, sourceRecordId }) => ({ source, sourceRecordId })) },
    select: { sourceRecordId: true, decision: true, reasonCode: true, decisionEvidence: true, leadId: true, processedAt: true },
  }) : [];
  const validations = await prisma.validationCandidate.findMany({
    where: { originRunId: run.id },
    select: { sourceRecordId: true, status: true, retryCount: true, failureReason: true, lastErrorCode: true, lastErrorMessage: true, promotedLeadId: true },
  });
  const insertErrors = await prisma.sourceLog.findMany({
    where: { runId: run.id, message: { contains: "lead_insert_failed" } },
    orderBy: { createdAt: "asc" }, select: { createdAt: true, message: true },
  });
  const constraints = await prisma.$queryRaw<Array<{ name: string; definition: string }>>`
    SELECT c.conname AS name, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'Lead'
    ORDER BY c.conname
  `;
  const pipelineStage = await prisma.pipelineStage.findUnique({ where: { id: "pipeline-nieuw" }, select: { id: true, slug: true, isActive: true } });

  const countBy = <T>(items: T[], key: (item: T) => string) => Object.fromEntries(
    [...items.reduce((counts, item) => counts.set(key(item), (counts.get(key(item)) ?? 0) + 1), new Map<string, number>())].sort(),
  );
  console.log(JSON.stringify({
    run,
    reconciliation: {
      rawCandidatesFound: run.candidatesFound,
      queueRows: candidates.length,
      queueByStatusAndError: countBy(candidates, (item) => `${item.status}|${item.lastError ?? "-"}`),
      sourceDecisions: countBy(sourceRecords, (item) => `${item.decision ?? "-"}|${item.reasonCode ?? "-"}`),
      validationStates: countBy(validations, (item) => `${item.status}|${item.failureReason}`),
      promotedLeadIds: validations.filter(({ promotedLeadId }) => promotedLeadId).map(({ promotedLeadId }) => promotedLeadId),
    },
    insertErrors,
    database: { pipelineStage, leadConstraints: constraints },
    sourceRecords,
    validations,
  }, null, 2));
}

main().finally(() => prisma.$disconnect());
