import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { reserveBudgetedApiCall } from "@/lib/jobs/quota";
import { backoffDelayMs } from "@/lib/jobs/backoff";
import { scoreWebsite } from "./score";

export type WebsiteAnalysisResult = {
  websiteUrl: string; opportunityScore: number; mobileScore: number | null; desktopScore: number | null;
  conversionQualityScore: number; classification: "USABLE" | "IMPROVABLE" | "OUTDATED"; isReachable: boolean;
  isMobileFriendly: boolean | null; hasContactForm: boolean | null; hasClearCta: boolean | null;
  hasBrokenLinks: boolean | null; brokenLinkCount: number; hasViewportMeta: boolean | null;
  hasOutdatedCopyright: boolean | null; hasPlaceholderContent: boolean | null; loadTimeMs: number | null;
  hasHttps: boolean | null; hasInvalidSsl: boolean | null; hasBrokenImages: boolean | null;
  brokenImageCount: number; hasLegacyTechnology: boolean | null; hasTinyText: boolean | null;
  reasons: { code: string; label: string; weight: number }[]; rawSignals: Record<string, unknown>;
};

function privateAddress(address: string) {
  return /^(127\.|10\.|0\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|169\.254\.|192\.168\.|198\.(1[89])\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i.test(address);
}

export async function assertPublicUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Ongeldige website-URL");
  if (["localhost", "metadata.google.internal"].includes(url.hostname.toLowerCase())) throw new Error("Lokale adressen zijn niet toegestaan");
  const records = await lookup(url.hostname, { all: true });
  if (!records.length || records.some((record) => privateAddress(record.address) || !isIP(record.address))) throw new Error("Privéadressen zijn niet toegestaan");
  return url;
}

async function safeFetch(urlValue: string, init: RequestInit = {}, timeoutMs = 12_000) {
  let url = await assertPublicUrl(urlValue);
  for (let redirect = 0; redirect < 4; redirect += 1) {
    const response = await fetch(url, {
      ...init, redirect: "manual", signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "LeadfinderSitora/2.0 website-quality-check", "Accept": "text/html,application/xhtml+xml", ...(init.headers || {}) },
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      url = await assertPublicUrl(new URL(response.headers.get("location")!, url).toString());
      continue;
    }
    return response;
  }
  throw new Error("Te veel redirects");
}

async function readLimitedBody(response: Response, maxBytes: number) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0; let result = "";
  try {
    while (total < maxBytes) {
      const { value, done } = await reader.read();
      if (done) break;
      const remaining = maxBytes - total;
      const chunk = value.length > remaining ? value.slice(0, remaining) : value;
      total += chunk.length; result += decoder.decode(chunk, { stream: total < maxBytes });
      if (value.length > remaining) break;
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return result;
}

type Psi = { lighthouseResult?: { categories?: { performance?: { score?: number } }; runtimeError?: unknown } };
async function pagespeed(url: string, strategy: "mobile" | "desktop", apiKey: string, dailyLimit: number, monthlyLimit: number) {
  await reserveBudgetedApiCall({ provider: "PAGESPEED", dailyLimit, monthlyLimit });
  const endpoint = new URL("https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url); endpoint.searchParams.set("strategy", strategy); endpoint.searchParams.set("category", "performance"); endpoint.searchParams.set("key", apiKey);
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(90_000), cache: "no-store" });
  if (!response.ok) throw new Error(`PageSpeed-fout (${response.status})`);
  return response.json() as Promise<Psi>;
}

async function probe(url: string, timeoutMs = 6_000) {
  try { const response = await safeFetch(url, { method: "HEAD" }, timeoutMs); return response.status < 400 || response.status === 405; }
  catch { return false; }
}

export async function analyzeWebsite(websiteUrl: string, options: { quick?: boolean } = {}): Promise<WebsiteAnalysisResult> {
  const parsed = await assertPublicUrl(websiteUrl); const url = parsed.toString();
  const maxBytes = Math.min(2_000_000, Math.max(100_000, Number(process.env.WEBSITE_FETCH_MAX_BYTES ?? 1_000_000)));
  let html = ""; let reachable = false; let loadTimeMs: number | null = null; let fetchError = "";
  const attempts = options.quick ? 1 : 3; const fetchTimeout = options.quick ? 6_000 : 12_000;
  for (let attempt = 0; attempt < attempts && !reachable; attempt += 1) {
    const started = Date.now();
    try {
      const response = await safeFetch(url, {}, fetchTimeout); loadTimeMs = Date.now() - started; reachable = response.ok;
      if (response.ok) html = await readLimitedBody(response, maxBytes);
      else fetchError = `HTTP ${response.status}`;
    } catch (error) { fetchError = error instanceof Error ? error.message : "Netwerkfout"; }
    if (!reachable && attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, backoffDelayMs(attempt)));
  }

  const lower = html.toLowerCase();
  const viewport = html ? /<meta[^>]+name=["']viewport["']/i.test(html) : null;
  const cta = html ? /(offerte|afspraak|contact|bel ons|boek nu|reserveer|vraag aan|maak een afspraak)/i.test(lower) : null;
  const form = html ? /<form[\s>]/i.test(html) : null;
  const placeholder = html ? /(coming soon|under construction|binnenkort beschikbaar|website in aanbouw|domain for sale|domein te koop|maintenance mode)/i.test(lower) : null;
  const legacyTechnology = html ? /(<frameset|<frame[\s>]|\.swf(?:["'?\s]|$)|jquery[.-](?:1\.|2\.0))/i.test(lower) : null;
  const tinyText = html ? /font-size\s*:\s*(?:[0-9]|10)(?:px|pt)/i.test(lower) : null;
  const years = [...lower.matchAll(/(?:©|copyright)[^\d]{0,20}(20\d{2})/g)].map((match) => Number(match[1]));
  const outdatedCopyright = years.length ? Math.max(...years) < new Date().getFullYear() - 2 : null;
  let brokenLinkCount = 0; let brokenImageCount = 0;
  if (html) {
    const origin = parsed.origin;
    const sampleSize = options.quick ? 3 : 5;
    const links = [...html.matchAll(/href=["']([^"'#]+)["']/gi)].map((match) => { try { return new URL(match[1], url); } catch { return null; } }).filter((value): value is URL => Boolean(value) && value!.origin === origin).slice(0, sampleSize);
    const images = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((match) => { try { return new URL(match[1], url); } catch { return null; } }).filter((value): value is URL => Boolean(value)).slice(0, sampleSize);
    const [linkChecks, imageChecks] = await Promise.all([Promise.all(links.map((link) => probe(link.toString(), options.quick ? 4_000 : 6_000))), Promise.all(images.map((image) => probe(image.toString(), options.quick ? 4_000 : 6_000)))]);
    brokenLinkCount = linkChecks.filter((ok) => !ok).length; brokenImageCount = imageChecks.filter((ok) => !ok).length;
  }

  let mobileScore: number | null = null; let desktopScore: number | null = null; let psiMobile: Psi | null = null;
  const key = process.env.PAGESPEED_API_KEY; const pagespeedEnabled = process.env.PAGESPEED_ENABLED === "true";
  if (key && pagespeedEnabled && reachable) {
    try {
      const daily = Number(process.env.PAGESPEED_DAILY_LIMIT ?? 25); const monthly = Number(process.env.PAGESPEED_MONTHLY_LIMIT ?? 100);
      const [mobile, desktop] = await Promise.all([pagespeed(url, "mobile", key, daily, monthly), pagespeed(url, "desktop", key, daily, monthly)]);
      psiMobile = mobile; mobileScore = Math.round((mobile.lighthouseResult?.categories?.performance?.score ?? 0) * 100); desktopScore = Math.round((desktop.lighthouseResult?.categories?.performance?.score ?? 0) * 100);
    } catch { /* Gratis HTML-signalen blijven leidend. */ }
  }
  const invalidSsl = parsed.protocol === "https:" && !reachable && /cert|ssl|tls/i.test(fetchError);
  const scores = scoreWebsite({ reachable, mobileScore, desktopScore, viewport, cta, form, placeholder, outdatedCopyright, brokenLinks: brokenLinkCount, brokenImages: brokenImageCount, loadTimeMs, https: parsed.protocol === "https:", invalidSsl, legacyTechnology, tinyText });
  return {
    websiteUrl: url, ...scores, mobileScore, desktopScore, isReachable: reachable, isMobileFriendly: viewport,
    hasContactForm: form, hasClearCta: cta, hasBrokenLinks: html ? brokenLinkCount > 0 : null, brokenLinkCount,
    hasViewportMeta: viewport, hasOutdatedCopyright: outdatedCopyright, hasPlaceholderContent: placeholder, loadTimeMs,
    hasHttps: parsed.protocol === "https:", hasInvalidSsl: invalidSsl, hasBrokenImages: html ? brokenImageCount > 0 : null,
    brokenImageCount, hasLegacyTechnology: legacyTechnology, hasTinyText: tinyText,
    reasons: scores.reasons, rawSignals: { fetchError: fetchError || null, bytesRead: Buffer.byteLength(html), checkedLinks: html ? Math.min(5, [...html.matchAll(/href=/gi)].length) : 0, checkedImages: html ? Math.min(5, [...html.matchAll(/<img/gi)].length) : 0, horizontalOverflow: "niet betrouwbaar server-side meetbaar", lighthouseRuntimeError: psiMobile?.lighthouseResult?.runtimeError ?? null },
  };
}
