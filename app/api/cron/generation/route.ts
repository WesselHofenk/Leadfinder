import { NextRequest, NextResponse } from "next/server";

import { secureCompare } from "@/lib/auth/session";
import { runGenerationWatchdog } from "@/lib/jobs/generation";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !secureCompare(secret, provided)) {
    return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runGenerationWatchdog()) });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Generatiewatchdog mislukt",
    }, { status: 500 });
  }
}
