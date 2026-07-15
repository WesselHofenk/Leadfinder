import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth/session";
import { leadStatuses } from "@/lib/leads/filters";
import { reviewLeadWebsite, suppressLead, updateManualLeadFields } from "@/lib/leads/service";
import { hasValidOrigin } from "@/lib/security/request";
const schema = z.union([
  z.object({ status: z.enum(leadStatuses), notes: z.string().max(5000).optional(), filterReason: z.string().max(500).optional() }),
  z.object({ websiteReview: z.enum(["NO_WEBSITE_CONFIRMED", "WEBSITE_FOUND"]), websiteUrl: z.string().trim().max(500).optional() }),
]);
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  if (!hasValidOrigin(request)) return NextResponse.json({ error: "Ongeldige aanvraag" }, { status: 403 });
  const input = schema.safeParse(await request.json().catch(() => null)); if (!input.success) return NextResponse.json({ error: "Ongeldige velden" }, { status: 400 });
  const { id } = await context.params;
  try {
    const lead = "websiteReview" in input.data
      ? await reviewLeadWebsite(id, user.id, input.data)
      : await updateManualLeadFields(id, user.id, input.data);
    return NextResponse.json({ lead });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Websitecontrole opslaan mislukt" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  if (!hasValidOrigin(request)) return NextResponse.json({ error: "Ongeldige aanvraag" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { reason?: string };
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : undefined;
  const { id } = await context.params; await suppressLead(id, user.id, reason); return NextResponse.json({ ok: true });
}
