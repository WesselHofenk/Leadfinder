import { JobStatus } from "@prisma/client";
import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { secureCompare } from "@/lib/auth/session";
import { processGenerationBatch } from "@/lib/jobs/generation";
import { triggerGenerationWorker } from "@/lib/jobs/generation-worker";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const inputSchema = z.object({ runId: z.string().cuid() });
const activeStatuses = new Set<JobStatus>([JobStatus.PENDING, JobStatus.RUNNING]);

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !secureCompare(secret, provided)) {
    return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ongeldige zoekrun" }, { status: 400 });

  const run = await processGenerationBatch(parsed.data.runId);
  if (activeStatuses.has(run.status)) {
    after(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await triggerGenerationWorker(run.id, request.url).catch((error) => {
        console.error(JSON.stringify({
          jobId: run.id,
          step: "background_worker_chain_failed",
          message: error instanceof Error ? error.message : String(error),
        }));
      });
    });
  }
  return NextResponse.json({ ok: run.status !== JobStatus.FAILED, runId: run.id, status: run.status });
}
