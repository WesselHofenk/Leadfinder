import { JobStatus, OutreachEmailStatus } from "@prisma/client";

import { prisma } from "../lib/prisma";

const localDateKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Amsterdam",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

async function main() {
  const [
    leadfinderTasks,
    coldEmailTasks,
    activeRuns,
    automationLocks,
    sentToday,
    acceptedPendingArchive,
    failedPendingRetry,
    availableLeads,
  ] = await Promise.all([
    prisma.leadfinderTask.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.coldEmailTask.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.generationRun.findMany({
      where: { status: { in: [JobStatus.PENDING, JobStatus.RUNNING] } },
      select: { id: true, status: true, continuousRequested: true, heartbeatAt: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.jobLock.findMany({
      where: { name: { in: ["generation-watchdog", "generation", "daily-cold-outreach"] } },
      orderBy: { name: "asc" },
    }),
    prisma.outreachEmail.count({ where: { dateKey: localDateKey, status: OutreachEmailStatus.SENT } }),
    prisma.outreachEmail.count({
      where: { status: OutreachEmailStatus.RESERVED, providerAcceptedAt: { not: null }, archivedAt: null },
    }),
    prisma.outreachEmail.count({
      where: { status: OutreachEmailStatus.FAILED, messageId: null, attemptCount: { lt: 5 } },
    }),
    prisma.lead.count({
      where: {
        status: "NEW",
        isActive: true,
        isFiltered: false,
        isSuppressed: false,
        doNotContact: false,
        email: { not: null },
        outreachEmail: null,
      },
    }),
  ]);

  const healthy = leadfinderTasks.length === 1
    && leadfinderTasks[0]?.id === "leadfinder-continuous"
    && leadfinderTasks[0]?.name === "Leadfinder doorlopend zoeken"
    && coldEmailTasks.length === 1
    && coldEmailTasks[0]?.id === "cold-email-continuous"
    && activeRuns.length <= 1;

  console.log(JSON.stringify({
    healthy,
    checkedAt: new Date().toISOString(),
    dateKey: localDateKey,
    leadfinderTasks,
    coldEmailTasks,
    activeRuns,
    automationLocks,
    outreach: { sentToday, acceptedPendingArchive, failedPendingRetry, availableLeads },
  }, null, 2));

  if (!healthy) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
