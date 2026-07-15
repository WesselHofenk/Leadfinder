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
  if (process.env.PAID_PROVIDERS_ENABLED !== "true" || !process.env.GOOGLE_PLACES_API_KEY) {
    return NextResponse.json({ error: "Google Places is nog niet geconfigureerd. Zonder Google-controle worden geen leads gegenereerd." }, { status: 503 });
  }
  if (!rateLimit(`generation:${requestIp(request)}`, 2, 60_000)) return NextResponse.json({ error: "Wacht even voordat je opnieuw genereert" }, { status: 429 });
  const active = await prisma.generationRun.findFirst({ where: { status: { in: ["PENDING", "RUNNING"] } } });
  if (active) return NextResponse.json({ error: "Er draait al een leadgeneratie", run: active }, { status: 409 });
  const run = await createGenerationRun();
  after(async () => { await runLeadGeneration(run.id); });
  return NextResponse.json({ run }, { status: 202 });
}
