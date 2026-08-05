import { NextRequest, NextResponse } from "next/server";
import { secureCompare } from "@/lib/auth/session";
import { ensureDailyColdEmailBatch } from "@/lib/email/campaign";
import { processColdEmailQueue, rescheduleStaleColdEmails } from "@/lib/email/service";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !secureCompare(secret, provided)) {
    return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  }
  try {
    const now = new Date();
    const recovery = await rescheduleStaleColdEmails(now);
    const campaign = await ensureDailyColdEmailBatch(now);
    const delivery = await processColdEmailQueue(now);
    return NextResponse.json({ recovery, campaign, delivery });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Dagelijkse e-mailbatch mislukt",
    }, { status: 500 });
  }
}
