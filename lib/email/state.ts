import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { coldEmailConfig } from "./config";
import { localDayKey } from "./schedule";
import { safeColdEmailError } from "./errors";

export const COLD_EMAIL_CAMPAIGN_ID = "sitora-cold-email";

type CampaignClient = Pick<Prisma.TransactionClient, "coldEmailCampaign">;

export async function ensureColdEmailCampaignState(
  now = new Date(),
  client: CampaignClient = prisma,
) {
  const config = coldEmailConfig();
  const initialStart = config.COLD_EMAIL_WARMUP_START
    || localDayKey(now, config.COLD_EMAIL_TIME_ZONE);
  return client.coldEmailCampaign.upsert({
    where: { id: COLD_EMAIL_CAMPAIGN_ID },
    update: {},
    create: {
      id: COLD_EMAIL_CAMPAIGN_ID,
      startDayKey: initialStart,
      templateSequence: 0,
    },
  });
}

export async function pauseColdEmailProvider(error: unknown, now = new Date()) {
  const state = await ensureColdEmailCampaignState(now);
  return prisma.coldEmailCampaign.update({
    where: { id: state.id },
    data: {
      pausedUntil: new Date(now.getTime() + (30 * 60_000)),
      lastProviderError: safeColdEmailError(error),
    },
  });
}
