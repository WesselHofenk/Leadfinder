import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { calculateWebsiteScore } from "@/lib/audit/website-score";

const schema = z.object({ url: z.string().url().max(300) });
const isUnsafe = (host: string) => host === "localhost" || host.endsWith(".local") || /^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(host);

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "local";
  if (!rateLimit(`audit:${ip}`, 12)) return NextResponse.json({ error: "Auditlimiet bereikt. Probeer het later opnieuw." }, { status: 429 });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Ongeldige URL" }, { status: 400 });
  const url = new URL(parsed.data.url);
  if (!["http:", "https:"].includes(url.protocol) || isUnsafe(url.hostname)) return NextResponse.json({ error: "Dit adres kan niet worden gecontroleerd" }, { status: 400 });
  if (url.hostname.endsWith("voorbeeld.nl")) {
    const base = { reachable: true, https: url.protocol === "https:", responseTimeMs: 840, viewport: false, title: true, metaDescription: false, favicon: true, socialLinks: false, contactPage: true, form: false, phone: true, email: true, performance: "gemiddeld" as const, copyrightYear: 2021 };
    return NextResponse.json({ ...base, score: calculateWebsiteScore(base), checkedAt: new Date().toISOString(), demo: true });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const start = Date.now();
    const res = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { "user-agent": "SitoraWebsiteAudit/1.0" } });
    const html = (await res.text()).slice(0, 750000), ms = Date.now() - start;
    const has = (rx: RegExp) => rx.test(html);
    const base = { reachable: res.ok, https: url.protocol === "https:", responseTimeMs: ms, viewport: has(/name=["']viewport/i), title: has(/<title[^>]*>[\s\S]+?<\/title>/i), metaDescription: has(/name=["']description/i), favicon: has(/rel=["'][^"']*icon/i), socialLinks: has(/linkedin|facebook|instagram/i), contactPage: has(/href=["'][^"']*(contact|over-ons)/i), form: has(/<form/i), phone: has(/(?:\+31|0)[1-9][\d\s-]{7,}/), email: has(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i), performance: ms < 800 ? "snel" as const : ms < 2000 ? "gemiddeld" as const : "traag" as const, copyrightYear: Number(html.match(/(?:©|copyright)\s*(20\d{2})/i)?.[1]) || undefined };
    return NextResponse.json({ ...base, score: calculateWebsiteScore(base), checkedAt: new Date().toISOString() });
  } catch {
    return NextResponse.json({ error: "Website niet bereikbaar binnen de tijdslimiet" }, { status: 504 });
  } finally { clearTimeout(timeout); }
}
