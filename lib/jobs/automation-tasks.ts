import { JobStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const LEADFINDER_TASK_ID = "leadfinder-continuous";
export const LEADFINDER_TASK_NAME = "Leadfinder doorlopend zoeken";
export const COLD_EMAIL_TASK_ID = "cold-email-continuous";
export const COLD_EMAIL_TASK_NAME = "Cold emails automatisch versturen";

export async function ensureLeadfinderTask() {
  return prisma.leadfinderTask.upsert({
    where: { id: LEADFINDER_TASK_ID },
    create: { id: LEADFINDER_TASK_ID, name: LEADFINDER_TASK_NAME, enabled: true, status: "ACTIVE" },
    update: { name: LEADFINDER_TASK_NAME },
  });
}

export async function setLeadfinderTaskEnabled(enabled: boolean) {
  return prisma.leadfinderTask.upsert({
    where: { id: LEADFINDER_TASK_ID },
    create: { id: LEADFINDER_TASK_ID, name: LEADFINDER_TASK_NAME, enabled, status: enabled ? "ACTIVE" : "PAUSED" },
    update: { name: LEADFINDER_TASK_NAME, enabled, status: enabled ? "ACTIVE" : "PAUSED", lastError: null },
  });
}

export async function getLeadfinderTaskSnapshot() {
  const task = await ensureLeadfinderTask();
  const run = task.currentRunId
    ? await prisma.generationRun.findUnique({ where: { id: task.currentRunId } })
    : await prisma.generationRun.findFirst({ orderBy: { createdAt: "desc" } });
  return { task, run };
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

export async function ensureColdEmailTask() {
  return prisma.coldEmailTask.upsert({
    where: { id: COLD_EMAIL_TASK_ID },
    create: { id: COLD_EMAIL_TASK_ID, name: COLD_EMAIL_TASK_NAME },
    update: { name: COLD_EMAIL_TASK_NAME },
  });
}
