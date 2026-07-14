import { prisma } from "@/lib/prisma";

export class DailyQuotaExceeded extends Error {}
export const quotaAllows=(current:number,limit:number)=>current<limit;

export async function reserveApiCall(limit: number, provider = "GOOGLE_PLACES") {
  const dateKey = new Date().toISOString().slice(0, 10);
  return prisma.$transaction(async (tx) => {
    const usage = await tx.apiUsage.upsert({ where: { dateKey_provider: { dateKey, provider } }, create: { dateKey, provider }, update: {} });
    if (!quotaAllows(usage.calls,limit)) throw new DailyQuotaExceeded("De dagelijkse Google Places-limiet is bereikt");
    return tx.apiUsage.update({ where: { dateKey_provider: { dateKey, provider } }, data: { calls: { increment: 1 } } });
  }, { isolationLevel: "Serializable" });
}
