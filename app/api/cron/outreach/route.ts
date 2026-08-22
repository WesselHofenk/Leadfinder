import { NextRequest, NextResponse } from "next/server";

import { secureCompare } from "@/lib/auth/session";
import { ensureDailyColdEmailBatch } from "@/lib/email/campaign";
import { processColdEmailQueue, rescheduleStaleColdEmails } from "@/lib/email/service";
import { COLD_EMAIL_CAMPAIGN_ID, ensureColdEmailCampaignState } from "@/lib/email/state";
import { getColdEmailTaskSnapshot } from "@/lib/jobs/cold-email-task";
import { getLeadfinderTaskSnapshot } from "@/lib/jobs/automation-tasks";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !secureCompare(secret, provided)) {
    return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  }

  const now = new Date();
  const task = await ensureColdEmailCampaignState(now);
  if (request.nextUrl.searchParams.get("status") === "1") {
    const [coldEmail, leadfinder, newWithEmail, mxVerifiedNew] = await Promise.all([
      getColdEmailTaskSnapshot(now),
      getLeadfinderTaskSnapshot(),
      prisma.lead.count({ where: {
        isActive: true, isFiltered: false, isSuppressed: false, doNotContact: false,
        email: { not: null }, pipelineStage: { is: { slug: "nieuw" } },
      } }),
      prisma.lead.count({ where: {
        isActive: true, isFiltered: false, isSuppressed: false, doNotContact: false,
        email: { not: null }, emailMxVerified: true,
        emailValidationStatus: { not: "INVALID" }, pipelineStage: { is: { slug: "nieuw" } },
      } }),
    ]);
    return NextResponse.json({ coldEmail, leadfinder, eligibility: { newWithEmail, mxVerifiedNew } });
  }
  if (!task.enabled) {
    await prisma.coldEmailCampaign.update({
      where: { id: COLD_EMAIL_CAMPAIGN_ID },
      data: { status: "PAUSED", lastHeartbeatAt: now },
    });
    return NextResponse.json({ status: "disabled" });
  }

  await prisma.coldEmailCampaign.update({
    where: { id: COLD_EMAIL_CAMPAIGN_ID },
    data: { status: "RUNNING", lastHeartbeatAt: now },
  });
  try {
    const recovery = await rescheduleStaleColdEmails(now);
    const delivery = await processColdEmailQueue(now);
    const campaign = await ensureDailyColdEmailBatch(now, {
      operatorCatchUp: request.nextUrl.searchParams.get("catchUp") === "1",
    });
    const latestSent = await prisma.coldEmail.findFirst({
      where: { smtpAcceptedAt: { not: null } },
      orderBy: { smtpAcceptedAt: "desc" },
      select: { smtpAcceptedAt: true },
    });
    await prisma.coldEmailCampaign.update({
      where: { id: COLD_EMAIL_CAMPAIGN_ID },
      data: {
        status: "ACTIVE",
        lastHeartbeatAt: new Date(),
        lastSuccessfulSentAt: latestSent?.smtpAcceptedAt,
      },
    });
    return NextResponse.json({ recovery, campaign, delivery });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cold-emailtaak mislukt";
    await prisma.coldEmailCampaign.update({
      where: { id: COLD_EMAIL_CAMPAIGN_ID },
      data: { status: "ERROR", lastHeartbeatAt: new Date(), lastProviderError: message },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
