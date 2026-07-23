import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { currentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { hasValidOrigin } from "@/lib/security/request";

const schema = z.object({
  country: z.enum(["NL", "BE"]),
  city: z.string().trim().min(2).max(100),
  priority: z.coerce.number().int().min(1).max(999),
});

export async function PATCH(request: NextRequest) {
  const user = await currentUser();
  if (user?.role !== "ADMIN") return NextResponse.json({ error: "Niet toegestaan" }, { status: 403 });
  if (!hasValidOrigin(request)) return NextResponse.json({ error: "Ongeldige aanvraag" }, { status: 403 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Ongeldig zoekgebied" }, { status: 400 });
  const result = await prisma.coverageArea.updateMany({
    where: { country: input.data.country, city: { equals: input.data.city, mode: "insensitive" } },
    data: { priority: input.data.priority, nextScanAt: new Date() },
  });
  if (!result.count) return NextResponse.json({ error: "Zoekgebied niet gevonden" }, { status: 404 });
  return NextResponse.json({ ok: true, updated: result.count });
}

