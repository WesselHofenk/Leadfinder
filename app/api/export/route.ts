import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { parseLeadFilters } from "@/lib/leads/filters";
import { activeLeadWhere } from "@/lib/leads/service";
import { leadsToCsv } from "@/lib/export/csv";
import { leadsToXlsx } from "@/lib/export/xlsx";
import { prisma } from "@/lib/prisma";
export async function GET(request: NextRequest) {
  if (!(await currentUser())) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const filters = parseLeadFilters(Object.fromEntries(request.nextUrl.searchParams));
  const leads = await prisma.lead.findMany({ where: activeLeadWhere(filters), orderBy: { firstDiscoveredAt: "desc" }, take: 5000, include: { pipelineStage: true } });
  const format=request.nextUrl.searchParams.get("format");const date=new Date().toISOString().slice(0,10);if(format==="xlsx"){const file=await leadsToXlsx(leads);return new NextResponse(file,{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="leadfinder-${date}.xlsx"`,"Cache-Control":"no-store"}})}
  if(format==="json")return NextResponse.json({version:1,exportedAt:new Date().toISOString(),filters,leads},{headers:{"Content-Disposition":`attachment; filename="leadfinder-${date}.json"`,"Cache-Control":"no-store"}});
  return new NextResponse(leadsToCsv(leads), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="leadfinder-${date}.csv"`, "Cache-Control": "no-store" } });
}
