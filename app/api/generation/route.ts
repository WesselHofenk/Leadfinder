import { JobStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/lib/auth/session";
import { cancelGenerationRun, createGenerationRun, latestGenerationRun, markStaleGenerationRuns, processGenerationBatch } from "@/lib/jobs/generation";
import { generationResponse } from "@/lib/jobs/generation-response";
import { acquireJobLock } from "@/lib/jobs/lock";
import { prisma } from "@/lib/prisma";
import { hasValidOrigin, rateLimit, requestIp } from "@/lib/security/request";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const runInput = z.object({ runId: z.string().cuid() });

async function authorized() { return Boolean(await currentUser()); }

export async function GET() {
  if (!await authorized()) return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  const run = await latestGenerationRun();
  return NextResponse.json(generationResponse(run));
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
    if (active) return NextResponse.json(generationResponse(active, false, "Er draait al een leadgeneratie."), { status: 409 });
    const run = await createGenerationRun();
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
