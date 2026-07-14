import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "leadfinder_session";
const hashToken = (token: string) => { const secret=process.env.AUTH_SECRET; if(!secret||secret.length<32)throw new Error("AUTH_SECRET moet minimaal 32 tekens bevatten"); return createHmac("sha256",secret).update(token).digest("hex"); };

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const days = Math.min(30, Math.max(1, Number(process.env.SESSION_TTL_DAYS ?? 14)));
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  await prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.delete(COOKIE_NAME);
}

export async function currentUser() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session || session.expiresAt <= new Date() || !session.user.isActive) return null;
  return { id: session.user.id, name: session.user.name, username: session.user.username, email: session.user.email, role: session.user.role };
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireRole(role: UserRole) {
  const user = await requireUser();
  if (user.role !== role) redirect("/dashboard");
  return user;
}

export function secureCompare(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
