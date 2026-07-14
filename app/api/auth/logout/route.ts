import { NextRequest, NextResponse } from "next/server";
import { destroySession } from "@/lib/auth/session";
import { hasValidOrigin } from "@/lib/security/request";
export async function POST(request: NextRequest) {
  if (!hasValidOrigin(request)) return NextResponse.json({ error: "Ongeldige aanvraag" }, { status: 403 });
  await destroySession(); return NextResponse.json({ ok: true });
}
