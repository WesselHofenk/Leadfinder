import { after, NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { createGenerationRun, runLeadGeneration } from "@/lib/jobs/generation";
import { hasValidOrigin, rateLimit, requestIp } from "@/lib/security/request";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET() {
  if (!await currentUser()) return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  const run = await prisma.generationRun.findFirst({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ run });
}

export async function POST(request: NextRequest) {
  if (!await currentUser()) return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  if (!hasValidOrigin(request)) return NextResponse.json({ error: "Ongeldige herkomst" }, { status: 403 });
  if (!rateLimit(`generation:${requestIp(request)}`, 2, 60_000)) return NextResponse.json({ error: "Wacht even voordat je opnieuw genereert" }, { status: 429 });
  const active = await prisma.generationRun.findFirst({ where: { status: { in: ["PENDING", "RUNNING"] } } });
  if (active) return NextResponse.json({ error: "Er draait al een leadgeneratie", run: active }, { status: 409 });
  const run = await createGenerationRun();
  after(async () => { await runLeadGeneration(run.id); });
  return NextResponse.json({ run }, { status: 202 });
}

export async function DELETE(request: NextRequest) {
  if (!await currentUser()) return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  if (!hasValidOrigin(request)) return NextResponse.json({ error: "Ongeldige herkomst" }, { status: 403 });
  const active = await prisma.generationRun.findFirst({ where: { status: { in: ["PENDING", "RUNNING"] } }, orderBy: { createdAt: "desc" } });
  if (!active) return NextResponse.json({ ok: true, message: "Er draait geen zoekrun." });
  await prisma.generationRun.update({ where: { id: active.id }, data: { cancelRequested: true, currentPhase: "Annuleren aangevraagd" } });
  return NextResponse.json({ ok: true });
}
