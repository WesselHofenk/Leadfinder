import { randomUUID } from "node:crypto";
import { chmod, mkdir, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { prisma } from "../lib/prisma";
import { identityFingerprint } from "../lib/leads/deduplication";

function inside(child: string, parent: string) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function main() {
  if (process.env.CONFIRM_LEAD_RESET !== "DELETE_ALL_LEADS") {
    throw new Error("Reset geweigerd. Stel CONFIRM_LEAD_RESET exact in op DELETE_ALL_LEADS.");
  }
  const workspace = await realpath(process.cwd());
  const backupDir = resolve(process.env.LEAD_BACKUP_DIR || join(homedir(), ".leadfinder-backups"));
  if (inside(backupDir, workspace)) throw new Error("Persoonsgegevensback-ups mogen niet binnen de Git-workspace staan.");
  await mkdir(backupDir, { recursive: true, mode: 0o700 });

  const leads = await prisma.lead.findMany({
    include: {
      history: true,
      websiteAnalyses: true,
      leadNotes: true,
      scanJobs: true,
      evidence: true,
      sourceRecords: true,
      activities: true,
    },
  });
  const generationRuns = await prisma.generationRun.findMany({ include: { candidates: true, qualifiedDrafts: true, logs: true } });
  const backupPath = join(backupDir, `lead-reset-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.json`);
  await writeFile(backupPath, JSON.stringify({ createdAt: new Date().toISOString(), leads, generationRuns }, (_, value) =>
    typeof value === "bigint" ? value.toString() : value, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(backupPath, 0o600);

  const exclusions = leads.flatMap((lead) => {
    const values: Array<[string, string | null]> = [
      ["external", lead.externalPlaceId],
      ["phone", lead.normalizedPhoneNumber],
      ["domain", lead.normalizedDomain],
      ["name_address", `${lead.normalizedCompanyName}|${lead.normalizedAddress}`],
    ];
    return values.filter((item): item is [string, string] => Boolean(item[1])).map(([kind, value]) => ({
      identityKey: identityFingerprint(kind, value),
      reason: "Eenmalige opschoning; niet opnieuw genereren",
    }));
  });

  await prisma.$transaction(async (tx) => {
    for (const exclusion of exclusions) {
      await tx.leadExclusion.upsert({
        where: { identityKey: exclusion.identityKey },
        create: exclusion,
        update: {
          source: null, sourceRecordId: null, phoneNormalized: null, domainNormalized: null,
          nameNormalized: null, postalCode: null, reason: exclusion.reason, expiresAt: null,
        },
      });
    }
    await tx.leadExclusion.updateMany({
      data: { source: null, sourceRecordId: null, phoneNormalized: null, domainNormalized: null, nameNormalized: null, postalCode: null },
    });
    await tx.sourceRecord.updateMany({ where: { leadId: { not: null } }, data: { leadId: null } });
    await tx.scanJob.updateMany({ where: { leadId: { not: null } }, data: { leadId: null } });
    await tx.duplicateFingerprint.updateMany({ data: { leadId: null } });
    await tx.lead.deleteMany();
    await tx.generationRun.deleteMany();
  }, { timeout: 120_000 });

  const [activeLeads, linkedSources, linkedJobs, pipelineItems] = await Promise.all([
    prisma.lead.count({ where: { isActive: true, isSuppressed: false } }),
    prisma.sourceRecord.count({ where: { leadId: { not: null } } }),
    prisma.scanJob.count({ where: { leadId: { not: null } } }),
    prisma.lead.count(),
  ]);
  if (activeLeads || linkedSources || linkedJobs || pipelineItems) throw new Error("Nacontrole mislukt: er zijn nog actieve of gekoppelde leadgegevens.");
  console.info(JSON.stringify({
    event: "lead_reset_complete",
    removedLeads: leads.length,
    exclusionFingerprints: exclusions.length,
    activeLeads,
    linkedSources,
    linkedJobs,
    pipelineItems,
    backupPath,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Leadreset mislukt");
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
