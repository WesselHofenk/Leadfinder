import { hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth/session";
import { hasValidOrigin, rateLimit, requestIp } from "@/lib/security/request";

const schema = z.object({ name: z.string().trim().min(2).max(80),
  username: z.string().trim().min(3).max(80).regex(/^[a-zA-Z0-9._-]+$/).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(200), confirmation: z.string().min(12).max(200),
}).refine((value) => value.password === value.confirmation, { message: "Wachtwoorden komen niet overeen", path: ["confirmation"] });

export async function POST(request: NextRequest) {
  if (!hasValidOrigin(request)) return NextResponse.json({ error: "Ongeldige aanvraag" }, { status: 403 });
  if (!rateLimit(`setup:${requestIp(request)}`, 5, 15 * 60_000)) return NextResponse.json({ error: "Te veel pogingen." }, { status: 429 });
  if (await prisma.user.count() > 0) return NextResponse.json({ error: "Deze omgeving is al geconfigureerd." }, { status: 409 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Controleer de invoer." }, { status: 400 });
  const user = await prisma.user.create({ data: { name: parsed.data.name, username: parsed.data.username,
    email: `${parsed.data.username}@leadfinder.local`, passwordHash: await hash(parsed.data.password, 12), role: "ADMIN" } });
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
