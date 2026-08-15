
import { NextRequest, NextResponse } from "next/server";

import { currentUser } from "@/lib/auth/session";
import { getLeadfinderTaskSnapshot, setLeadfinderTaskEnabled, stopLeadfinderTask } from "@/lib/jobs/automation-tasks";
import { runGenerationWatchdog } from "@/lib/jobs/generation";
import { generationActivationKey, generationRecoveryKey, generationWorkerAvailable, triggerGenerationWorker } from "@/lib/jobs/generation-worker";
import { hasValidOrigin, rateLimit, requestIp } from "@/lib/security/request";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function authorized() { return Boolean(await currentUser()); }

export async function GET() {
  if (!await authorized()) return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  let snapshot = await getLeadfinderTaskSnapshot();
  if (snapshot.task.enabled && snapshot.operationalStatus === "RECOVERING") {
    if (generationWorkerAvailable()) await triggerGenerationWorker(generationRecoveryKey());
    else await runGenerationWatchdog();
    snapshot = await getLeadfinderTaskSnapshot();
  }
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  if (!await authorized()) return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  if (!hasValidOrigin(request)) return NextResponse.json({ error: "Ongeldige herkomst" }, { status: 403 });
  if (!rateLimit(`generation:${requestIp(request)}`, 3, 60_000)) return NextResponse.json({ error: "Wacht even voordat je opnieuw genereert" }, { status: 429 });
  const task = await setLeadfinderTaskEnabled(true);
  if (generationWorkerAvailable()) await triggerGenerationWorker(generationActivationKey(task.updatedAt));
  else await runGenerationWatchdog();
  return NextResponse.json({ ...(await getLeadfinderTaskSnapshot()), message: "De Leadfinder is gestart; de eerste echte zoekbatch is ingepland." }, { status: 202 });
}

export async function DELETE(request: NextRequest) {
  if (!await authorized()) return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  if (!hasValidOrigin(request)) return NextResponse.json({ error: "Ongeldige herkomst" }, { status: 403 });
  const result = await stopLeadfinderTask();
  return NextResponse.json({ ok: true, ...result, message: "De Leadfinder is gepauzeerd." });
}
