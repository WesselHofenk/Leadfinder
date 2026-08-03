import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth/session";
import { deliverColdEmail, queueColdEmail } from "@/lib/email/service";
import { hasValidOrigin, rateLimit } from "@/lib/security/request";

const schema = z.object({
  subject: z.string().trim().min(1).max(180),
  bodyText: z.string().trim().min(1).max(10_000),
  sendImmediately: z.boolean().default(false),
});

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  if (!hasValidOrigin(request)) return NextResponse.json({ error: "Ongeldige aanvraag" }, { status: 403 });
  if (!rateLimit(`cold-email:${user.id}`, 20, 60_000)) return NextResponse.json({ error: "Te veel e-mailacties tegelijk" }, { status: 429 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Vul een onderwerp en e-mailtekst in" }, { status: 400 });
  const { id } = await context.params;
  try {
    const email = await queueColdEmail({ leadId: id, userId: user.id, ...input.data });
    if (!input.data.sendImmediately) return NextResponse.json({ email }, { status: 202 });
    try {
      return NextResponse.json({ email: await deliverColdEmail(email.id) });
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : "Verzenden mislukt",
        emailId: email.id,
      }, { status: 502 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "E-mail inplannen mislukt" }, { status: 400 });
  }
}
