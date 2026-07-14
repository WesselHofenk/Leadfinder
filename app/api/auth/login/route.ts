import { compare } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth/session";
import { rateLimit, requestIp, hasValidOrigin } from "@/lib/security/request";

const schema = z.object({ username: z.string().trim().min(3).max(80).transform((v) => v.toLowerCase()), password: z.string().min(8).max(200) });
export async function POST(request: NextRequest) {
  if (!hasValidOrigin(request)) return NextResponse.json({ error: "Ongeldige aanvraag" }, { status: 403 });
  if (!rateLimit(`login:${requestIp(request)}`, 8, 15 * 60_000)) return NextResponse.json({ error: "Te veel pogingen. Probeer later opnieuw." }, { status: 429 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Controleer je gebruikersnaam en wachtwoord." }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { username: parsed.data.username } });
  if (!user || !user.isActive || !(await compare(parsed.data.password, user.passwordHash))) return NextResponse.json({ error: "Ongeldige inloggegevens." }, { status: 401 });
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
