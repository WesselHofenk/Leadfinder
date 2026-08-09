import { JobStatus } from "@prisma/client";
import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/lib/auth/session";
import { cancelGenerationRun, createGenerationRun, latestGenerationRun, markStaleGenerationRuns, processGenerationBatch } from "@/lib/jobs/generation";
import { generationResponse } from "@/lib/jobs/generation-response";
import { generationWorkerAvailable, scheduleGenerationWatchdog, triggerGenerationWorker } from "@/lib/jobs/generation-worker";
import { acquireJobLock } from "@/lib/jobs/lock";
import { prisma } from "@/lib/prisma";
import { hasValidOrigin, rateLimit, requestIp } from "@/lib/security/request";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const runInput = z.object({ runId: z.string().cuid() });

async function authorized() { return Boolean(await currentUser()); }

export async function GET(request: NextRequest) {
  if (!rateLimit(`generation-status:${requestIp(request)}`, 30, 60_000)) {
    return NextResponse.json(
      { error: "De voortgang wordt te vaak opgevraagd. Probeer het zo opnieuw." },
      { status: 429, headers: { "Retry-After": "5", "Cache-Control": "private, no-store" } },
    );
  }
  if (!await authorized()) return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  const run = await latestGenerationRun();
  if (
    run
    && generationWorkerAvailable()
    && (run.status === JobStatus.PENDING || run.status === JobStatus.RUNNING)
    && Date.now() - run.updatedAt.getTime() >= 75_000
  ) {
    after(() => triggerGenerationWorker(run.id, run.batchNumber).catch((error) => {
      console.error(JSON.stringify({
        jobId: run.id,
        step: "background_worker_watchdog_failed",
        message: error instanceof Error ? error.message : String(error),
      }));
    }));
  }
  return NextResponse.json(generationResponse(run), { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  if (!await authorized()) return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  if (!hasValidOrigin(request)) return NextResponse.json({ error: "Ongeldige herkomst" }, { status: 403 });
  if (!rateLimit(`generation:${requestIp(request)}`, 3, 60_000)) return NextResponse.json({ error: "Wacht even voordat je opnieuw genereert" }, { status: 429 });
  const startLock = await acquireJobLock("lead-generation:start", 15_000);
  if (!startLock) {
    const active = await prisma.generationRun.findFirst({ where: { status: { in: [JobStatus.PENDING, JobStatus.RUNNING] } }, orderBy: { createdAt: "desc" } });
    return NextResponse.json(generationResponse(active, false, "Een andere aanvraag start al een leadgeneratie."), { status: 409 });
  }
  try {
    await markStaleGenerationRuns();
    const active = await prisma.generationRun.findFirst({ where: { status: { in: [JobStatus.PENDING, JobStatus.RUNNING] } }, orderBy: { createdAt: "desc" } });
    if (active) {
      if (generationWorkerAvailable()) after(async () => {
        await Promise.allSettled([
          triggerGenerationWorker(active.id, active.batchNumber),
          scheduleGenerationWatchdog(active.id, active.startedAt ?? active.createdAt),
        ]);
      });
      return NextResponse.json(generationResponse(active, false, "Er draait al een leadgeneratie."), { status: 409 });
    }
    const run = await createGenerationRun();
    if (generationWorkerAvailable()) {
      after(async () => {
        const results = await Promise.allSettled([
          triggerGenerationWorker(run.id, run.batchNumber),
          scheduleGenerationWatchdog(run.id, run.startedAt ?? run.createdAt),
        ]);
        for (const result of results) {
          if (result.status === "rejected") {
            console.error(JSON.stringify({ jobId: run.id, step: "background_worker_start_failed", message: result.reason instanceof Error ? result.reason.message : String(result.reason) }));
          }
        }
      });
    }
    return NextResponse.json(generationResponse(run), { status: 202 });
  } finally {
    await startLock.release();
  }
}

export async function PATCH(request: NextRequest) {
  if (!await authorized()) return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  if (!hasValidOrigin(request)) return NextResponse.json({ error: "Ongeldige herkomst" }, { status: 403 });
  const parsed = runInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ongeldige zoekrun" }, { status: 400 });
  try {
    const run = await processGenerationBatch(parsed.data.runId);
    return NextResponse.json(generationResponse(run, run.status !== JobStatus.FAILED));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Zoekbatch mislukt" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!await authorized()) return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  if (!hasValidOrigin(request)) return NextResponse.json({ error: "Ongeldige herkomst" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const parsed = runInput.safeParse(body);
  const run = await cancelGenerationRun(parsed.success ? parsed.data.runId : undefined);
  return NextResponse.json({ ...generationResponse(run, Boolean(run), run ? "Zoekrun geannuleerd." : "Er draait geen zoekrun."), ok: true });
}
