import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

export async function acquireJobLock(name: string, ttlMs = 10 * 60_000) {
  const owner = randomUUID(); const now = new Date(); const expiresAt = new Date(now.getTime() + ttlMs);
  try {
    const lock = await prisma.$transaction(async (tx) => {
      const current = await tx.jobLock.findUnique({ where: { name } });
      if (current && current.expiresAt > now) return null;
      if (current) return tx.jobLock.update({ where: { name }, data: { owner, expiresAt } });
      return tx.jobLock.create({ data: { name, owner, expiresAt } });
    }, { isolationLevel: "Serializable" });
    return lock ? { owner, release: () => prisma.jobLock.deleteMany({ where: { name, owner } }) } : null;
  } catch { return null; }
}
