import { JobStatus } from "@prisma/client";

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
    prisma.coldEmailCampaign.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.generationRun.findMany({
      where: { status: { in: [JobStatus.PENDING, JobStatus.RUNNING] } },
      select: { id: true, status: true, continuousRequested: true, heartbeatAt: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.jobLock.findMany({
      where: { OR: [{ name: { contains: "generation" } }, { name: { contains: "cold-email" } }] },
      orderBy: { name: "asc" },
    }),
    prisma.coldEmail.count({ where: { campaignDayKey: localDateKey, smtpAcceptedAt: { not: null } } }),
    prisma.coldEmail.count({
      where: { status: "SENT_PENDING_ARCHIVE", smtpAcceptedAt: { not: null }, sentItemsConfirmedAt: null },
    }),
    prisma.coldEmail.count({
      where: { status: "FAILED", smtpAcceptedAt: null, attempts: { lt: 3 } },
    }),
    prisma.lead.count({
      where: {
        isActive: true,
        isFiltered: false,
        isSuppressed: false,
        doNotContact: false,
        email: { not: null },
        pipelineStage: { is: { slug: "nieuw" } },
        coldEmails: { none: { status: { not: "CANCELLED" } } },
      },
    }),
  ]);

  const healthy = leadfinderTasks.length === 1
    && leadfinderTasks[0]?.id === "leadfinder-continuous"
    && leadfinderTasks[0]?.name === "Leadfinder doorlopend zoeken"
    && coldEmailTasks.length === 1
    && coldEmailTasks[0]?.id === "sitora-cold-email"
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
