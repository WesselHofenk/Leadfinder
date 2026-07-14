import { NextRequest, NextResponse } from "next/server";
import { secureCompare } from "@/lib/auth/session";
import { reverifyStaleLeads } from "@/lib/jobs/sync";
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? ""; const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !secureCompare(secret, provided)) return NextResponse.json({ error: "Niet toegestaan" }, { status: 401 });
  try { return NextResponse.json(await reverifyStaleLeads()); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Controle mislukt" }, { status: 500 }); }
}
