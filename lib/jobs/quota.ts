import { prisma } from "@/lib/prisma";

export class DailyQuotaExceeded extends Error {}
export class MonthlyQuotaExceeded extends Error {}
export const quotaAllows=(current:number,limit:number)=>current<limit;

export async function reserveApiCall(limit: number, provider = "GOOGLE_PLACES") {
  const dateKey = new Date().toISOString().slice(0, 10);
  return prisma.$transaction(async (tx) => {
    const usage = await tx.apiUsage.upsert({ where: { dateKey_provider: { dateKey, provider } }, create: { dateKey, provider }, update: {} });
    if (!quotaAllows(usage.calls,limit)) throw new DailyQuotaExceeded("De dagelijkse Google Places-limiet is bereikt");
    return tx.apiUsage.update({ where: { dateKey_provider: { dateKey, provider } }, data: { calls: { increment: 1 } } });
  }, { isolationLevel: "Serializable" });
}

export async function reserveBudgetedApiCall(input: { provider: string; dailyLimit: number; monthlyLimit: number; estimatedCostCents?: number }) {
  const dateKey = new Date().toISOString().slice(0, 10);
  const monthKey = dateKey.slice(0, 7);
  return prisma.$transaction(async (tx) => {
    const [usage, monthly] = await Promise.all([
      tx.apiUsage.upsert({ where: { dateKey_provider: { dateKey, provider: input.provider } }, create: { dateKey, provider: input.provider }, update: {} }),
      tx.apiUsage.aggregate({ where: { provider: input.provider, dateKey: { startsWith: monthKey } }, _sum: { calls: true, estimatedCostCents: true } }),
    ]);
    if (!quotaAllows(usage.calls, input.dailyLimit)) throw new DailyQuotaExceeded(`De dagelijkse limiet voor ${input.provider} is bereikt`);
    if (!quotaAllows(monthly._sum.calls ?? 0, input.monthlyLimit)) throw new MonthlyQuotaExceeded(`De maandelijkse limiet voor ${input.provider} is bereikt`);
    return tx.apiUsage.update({
      where: { dateKey_provider: { dateKey, provider: input.provider } },
      data: { calls: { increment: 1 }, estimatedCostCents: { increment: input.estimatedCostCents ?? 0 } },
    });
  }, { isolationLevel: "Serializable" });
}
