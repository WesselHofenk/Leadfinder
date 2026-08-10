
import { NextRequest, NextResponse } from "next/server";

import { currentUser } from "@/lib/auth/session";
import { getLeadfinderTaskSnapshot, setLeadfinderTaskEnabled, stopLeadfinderTask } from "@/lib/jobs/automation-tasks";
import { hasValidOrigin, rateLimit, requestIp } from "@/lib/security/request";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function authorized() { return Boolean(await currentUser()); }

export async function GET() {
  if (!await authorized()) return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  return NextResponse.json(await getLeadfinderTaskSnapshot());
}

export async function POST(request: NextRequest) {
  if (!await authorized()) return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  if (!hasValidOrigin(request)) return NextResponse.json({ error: "Ongeldige herkomst" }, { status: 403 });
  if (!rateLimit(`generation:${requestIp(request)}`, 3, 60_000)) return NextResponse.json({ error: "Wacht even voordat je opnieuw genereert" }, { status: 429 });
  await setLeadfinderTaskEnabled(true);
  return NextResponse.json(await getLeadfinderTaskSnapshot(), { status: 200 });
}

export async function DELETE(request: NextRequest) {
  if (!await authorized()) return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  if (!hasValidOrigin(request)) return NextResponse.json({ error: "Ongeldige herkomst" }, { status: 403 });
  const result = await stopLeadfinderTask();
  return NextResponse.json({ ok: true, ...result, message: "De Leadfinder is gepauzeerd." });
}
