import { JobStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getLeadBufferSnapshot } from "./lead-buffer";
import { isGenerationWorkerHeartbeatHealthy } from "./generation-worker";

export const LEADFINDER_TASK_ID = "leadfinder-continuous";
export const LEADFINDER_TASK_NAME = "Leadfinder doorlopend zoeken";

export async function ensureLeadfinderTask() {
  return prisma.leadfinderTask.upsert({
    where: { id: LEADFINDER_TASK_ID },
    create: { id: LEADFINDER_TASK_ID, name: LEADFINDER_TASK_NAME, enabled: false, status: "PAUSED" },
    update: { name: LEADFINDER_TASK_NAME },
  });
}

export async function setLeadfinderTaskEnabled(enabled: boolean) {
  return prisma.leadfinderTask.upsert({
    where: { id: LEADFINDER_TASK_ID },
    create: { id: LEADFINDER_TASK_ID, name: LEADFINDER_TASK_NAME, enabled, status: enabled ? "STARTING" : "PAUSED" },
    update: { name: LEADFINDER_TASK_NAME, enabled, status: enabled ? "STARTING" : "PAUSED", lastError: null },
  });
}

export async function getLeadfinderTaskSnapshot() {
  const task = await ensureLeadfinderTask();
  const run = task.currentRunId
    ? await prisma.generationRun.findUnique({ where: { id: task.currentRunId } })
    : await prisma.generationRun.findFirst({ orderBy: { createdAt: "desc" } });
  const attemptedCandidates = run ? await prisma.generationCandidate.findMany({
    where: { runId: run.id, attempts: { gt: 0 } },
    select: { source: true, sourceRecordId: true, status: true },
  }) : [];
  const decisions = attemptedCandidates.length ? await prisma.sourceRecord.findMany({
    where: { OR: attemptedCandidates.map(({ source, sourceRecordId }) => ({ source, sourceRecordId })) },
    select: { source: true, sourceRecordId: true, decision: true, reasonCode: true },
  }) : [];
  const decisionByCandidate = new Map(decisions.map((item) => [`${item.source}:${item.sourceRecordId}`, item.decision]));
  const candidateOutcomes = { qualified: 0, rejected: 0, duplicates: 0, retrying: 0, failed: 0, processing: 0, total: attemptedCandidates.length };
  for (const candidate of attemptedCandidates) {
    const decision = decisionByCandidate.get(`${candidate.source}:${candidate.sourceRecordId}`);
    if (candidate.status === "FAILED") candidateOutcomes.failed += 1;
    else if (decision === "stored" || decision === "qualified_draft") candidateOutcomes.qualified += 1;
    else if (decision === "duplicate") candidateOutcomes.duplicates += 1;
    else if (decision === "rejected" || decision === "skipped") candidateOutcomes.rejected += 1;
    else if (decision === "retry" || candidate.status === "PENDING") candidateOutcomes.retrying += 1;
    else candidateOutcomes.processing += 1;
  }
  const rejectionReasonCounts = new Map<string, number>();
  for (const decision of decisions) {
    if (!["rejected", "skipped"].includes(decision.decision ?? "") || !decision.reasonCode) continue;
    rejectionReasonCounts.set(decision.reasonCode, (rejectionReasonCounts.get(decision.reasonCode) ?? 0) + 1);
  }
  const rejectionReasons = [...rejectionReasonCounts]
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code))
    .slice(0, 3);
  const leadBuffer = await getLeadBufferSnapshot();
  const workerHealthy = task.enabled && isGenerationWorkerHeartbeatHealthy(task.lastHeartbeatAt);
  const operationalStatus = !task.enabled
    ? "PAUSED"
    : task.status === "BUFFER_READY"
      ? "BUFFER_READY"
    : task.status === "ERROR"
      ? "ERROR"
      : !run
        ? "STARTING"
        : !workerHealthy && (run.status === JobStatus.PENDING || run.status === JobStatus.RUNNING)
          ? "RECOVERING"
          : run.pendingCandidates > 0 || /valideren|controleren|opslaan/i.test(run.currentPhase)
            ? "PROCESSING"
            : /ophalen|zoeken/i.test(run.currentPhase)
              ? "SEARCHING"
              : "WAITING";
  const visibleRun = run && attemptedCandidates.length > run.candidatesChecked
    ? { ...run, candidatesChecked: attemptedCandidates.length }
    : run;
  return { task, run: visibleRun, operationalStatus, workerHealthy, candidateOutcomes, rejectionReasons, leadBuffer };
}

export async function stopLeadfinderTask() {
  const now = new Date();
  const [, cancelled] = await prisma.$transaction([
    prisma.leadfinderTask.upsert({
      where: { id: LEADFINDER_TASK_ID },
      create: { id: LEADFINDER_TASK_ID, name: LEADFINDER_TASK_NAME, enabled: false, status: "PAUSED" },
      update: { name: LEADFINDER_TASK_NAME, enabled: false, status: "PAUSED", currentRunId: null, lastError: null },
    }),
    prisma.generationRun.updateMany({
      where: { status: { in: [JobStatus.PENDING, JobStatus.RUNNING] } },
      data: {
        status: JobStatus.CANCELLED,
        cancelRequested: true,
        continuousRequested: false,
        progress: 100,
        currentPhase: "Gepauzeerd",
        message: "De permanente Leadfinder-taak is via de website gepauzeerd.",
        stopReason: "De permanente Leadfinder-taak is door de gebruiker gepauzeerd.",
        finishedAt: now,
        heartbeatAt: now,
      },
    }),
  ]);
  return { cancelled: cancelled.count, ...(await getLeadfinderTaskSnapshot()) };
}
