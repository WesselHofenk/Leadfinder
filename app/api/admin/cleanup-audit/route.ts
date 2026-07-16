import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { blockedLeadWhere } from "@/lib/leads/blocked-location";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  await requireRole("ADMIN");
  const [audit, remainingBlocked, totalLeads, backups] = await Promise.all([
    prisma.blockedLocationCleanupAudit.findFirst({ orderBy: { createdAt: "desc" } }),
    prisma.lead.count({ where: blockedLeadWhere }),
    prisma.lead.count(),
    prisma.blockedLocationLeadBackup.count(),
  ]);
  return NextResponse.json({ audit, remainingBlocked, totalLeads, backups });
}
