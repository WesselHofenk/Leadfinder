import { NextResponse } from "next/server";
import { z } from "zod";
import { leadsToCsv } from "@/lib/export/csv";

const schema = z.object({ leads: z.array(z.any()).max(500) });
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Ongeldige export" }, { status: 400 });
  return new NextResponse(leadsToCsv(parsed.data.leads), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=sitora-leads.csv" } });
}
