import { JobStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { secureCompare } from "@/lib/auth/session";
import { processGenerationBatch, runGenerationWatchdog } from "@/lib/jobs/generation";
import { triggerGenerationWorker } from "@/lib/jobs/generation-worker";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const inputSchema = z.object({ runId: z.string().cuid() });
const activeStatuses = new Set<JobStatus>([JobStatus.PENDING, JobStatus.RUNNING]);

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return Boolean(secret && secureCompare(secret, provided));
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  }
  const result = await runGenerationWatchdog();
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ongeldige zoekrun" }, { status: 400 });

  const run = await processGenerationBatch(parsed.data.runId);
  if (activeStatuses.has(run.status)) {
    await triggerGenerationWorker(run.id, run.batchNumber);
  }
  return NextResponse.json({ ok: run.status !== JobStatus.FAILED, runId: run.id, status: run.status });
}
