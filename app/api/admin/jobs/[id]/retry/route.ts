import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { hasValidOrigin } from "@/lib/security/request";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Niet toegestaan" }, { status: 403 });
  if (!hasValidOrigin(request)) return NextResponse.json({ error: "Ongeldige aanvraag" }, { status: 403 });
  const { id } = await context.params; const job = await prisma.scanJob.findUnique({ where: { id } }); if (!job || job.status !== "FAILED") return NextResponse.json({ error: "Job is niet opnieuw uitvoerbaar" }, { status: 409 });
  await prisma.$transaction([prisma.scanJob.update({ where: { id }, data: { status: "PENDING", nextAttemptAt: new Date(), errorMessage: null } }), ...(job.coverageAreaId ? [prisma.coverageArea.update({ where: { id: job.coverageAreaId }, data: { status: "PENDING", nextScanAt: new Date(), errorMessage: null } })] : [])]);
  return NextResponse.json({ ok: true });
}
