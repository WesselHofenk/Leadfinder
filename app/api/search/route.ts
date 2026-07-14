import { NextResponse } from "next/server";
import { searchSchema } from "@/lib/validation/search";
import { getLeadProvider } from "@/lib/providers";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "local";
  if (!rateLimit(`search:${ip}`, 20)) {
    return NextResponse.json({ error: "Te veel zoekopdrachten. Probeer het over een minuut opnieuw." }, { status: 429 });
  }
  const parsed = searchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Controleer de zoekvelden", issues: parsed.error.flatten() }, { status: 400 });
  }
  const provider = getLeadProvider();
  const leads = await provider.search(parsed.data);
  return NextResponse.json({ leads, provider: provider.name, query: parsed.data });
}
