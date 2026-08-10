import { NextRequest, NextResponse } from "next/server";

import { secureCompare } from "@/lib/auth/session";
import { getDailyOutreachSummary, resendTodayOutreach, runDailyOutreach, sendOutreachTestEmail, verifyOutreachMailbox } from "@/lib/jobs/outreach";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !secureCompare(secret, provided)) {
    return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  }

  const now = new Date();
  try {
    if (request.nextUrl.searchParams.get("verify") === "1") {
      return NextResponse.json(await verifyOutreachMailbox());
    }
    if (request.nextUrl.searchParams.get("test") === "1") {
      return NextResponse.json(await sendOutreachTestEmail());
    }
    if (request.nextUrl.searchParams.get("status") === "1") {
      return NextResponse.json(await getDailyOutreachSummary(now));
    }
    if (request.nextUrl.searchParams.get("resend") === "1") {
      return NextResponse.json(await resendTodayOutreach({ now }));
    }
    if (request.nextUrl.searchParams.get("outdated") === "1") {
      return NextResponse.json(await runDailyOutreach({ now, campaign: "OUTDATED_WEBSITE" }));
    }
    if (request.nextUrl.searchParams.get("extraOutdated") === "1") {
      return NextResponse.json(await runDailyOutreach({ now, campaign: "OUTDATED_WEBSITE", additionalBatchSize: 5 }));
    }
    const result = await runDailyOutreach({ now, campaign: "NEW_PIPELINE", scheduled: true });
    console.info("Dagelijkse cold-emailrun", {
      status: result.status,
      sent: result.sent,
      sentToday: "sentToday" in result ? result.sentToday : undefined,
      dailyLimit: "dailyLimit" in result ? result.dailyLimit : undefined,
      failures: "failures" in result && Array.isArray(result.failures) ? result.failures.length : undefined,
      archiveFailures: "archiveFailures" in result && Array.isArray(result.archiveFailures) ? result.archiveFailures.length : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Dagelijkse e-mailrun mislukt",
    }, { status: 500 });
  }
}
