import { resolveMx } from "node:dns/promises";
import { isIP } from "node:net";

import type { Candidate } from "./eligibility";
import { normalizeEmails } from "./normalization";

type MxResolver = (domain: string) => Promise<Array<{ exchange: string; priority: number }>>;
type Fetcher = typeof fetch;

export type BusinessEmailValidation =
  | { status: "VALID"; email: string; domain: string; source: string; sourceUrl: string; mxVerified: true; checkedAt: string }
  | { status: "MISSING"; reason: "BUSINESS_EMAIL_REQUIRED"; retryable: true }
  | { status: "INVALID"; email?: string; reason: "INVALID_EMAIL" | "DISPOSABLE_EMAIL" | "EMAIL_MX_MISSING"; retryable: false }
  | { status: "RETRY"; email: string; reason: "EMAIL_SOURCE_UNVERIFIED" | "EMAIL_MX_CHECK_FAILED"; retryable: true };

const disposableDomains = new Set([
  "10minutemail.com", "dispostable.com", "guerrillamail.com", "maildrop.cc",
  "mailinator.com", "sharklasers.com", "temp-mail.org", "tempmail.com", "yopmail.com",
]);
const reservedExampleDomains = new Set(["example.com", "example.net", "example.org"]);

function sourceEmailValues(candidate: Candidate) {
  const raw = candidate.rawData && typeof candidate.rawData === "object" && !Array.isArray(candidate.rawData)
    ? candidate.rawData as Record<string, unknown>
    : {};
  return normalizeEmails([
    candidate.email,
    ...(candidate.emailAddresses ?? []),
    typeof raw.email === "string" ? raw.email : undefined,
    typeof raw["contact:email"] === "string" ? raw["contact:email"] : undefined,
  ]);
}

export function candidateBusinessEmails(candidate: Candidate) {
  return sourceEmailValues(candidate);
}

export function hasPublicEmailEvidence(candidate: Candidate, email: string) {
  if (candidate.emailPubliclyListed === true && candidate.emailSourceUrl?.trim()) return true;
  if (candidate.source === "OPENSTREETMAP" && sourceEmailValues(candidate).includes(email)) {
    return /^https:\/\/www\.openstreetmap\.org\/(?:node|way|relation)\//.test(candidate.sourceUrl || candidate.googleMapsUrl);
  }
  return Boolean(candidate.emailSource?.trim() && candidate.emailSourceUrl?.trim() && sourceEmailValues(candidate).includes(email));
}

function invalidDomain(domain: string) {
  return reservedExampleDomains.has(domain)
    || disposableDomains.has(domain)
    || domain.endsWith(".invalid")
    || domain.endsWith(".test")
    || domain === "localhost"
    || /^\d+(?:\.\d+){3}$/.test(domain);
}

function permanentDnsFailure(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  return ["ENODATA", "ENOTFOUND", "ENXDOMAIN", "NOTFOUND", "NODATA"].includes(code);
}

function publicHttpUrl(value?: string) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const hostname = url.hostname.toLowerCase();
    const privateIp = isIP(hostname) && (
      /^127\.|^10\.|^192\.168\.|^169\.254\./.test(hostname)
      || /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname)
      || hostname === "::1"
      || /^f[cd][0-9a-f]{2}:/i.test(hostname)
      || /^fe80:/i.test(hostname)
    );
    if (privateIp || hostname === "localhost" || hostname.endsWith(".local")) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

async function fetchPublicPage(url: URL, fetchImpl: Fetcher, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("E-mailbron reageerde niet op tijd")), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      cache: "no-store",
      headers: { "User-Agent": "SitoraLeadfinder/4.0 (public-business-contact-verification)" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const type = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!type.includes("text/html") && !type.includes("text/plain")) return null;
    const announced = Number(response.headers.get("content-length") || 0);
    if (announced > 512_000) return null;
    const text = (await response.text()).slice(0, 512_000);
    return { text, finalUrl: response.url || url.toString() };
  } finally {
    clearTimeout(timer);
  }
}

function visibleEmails(html: string) {
  const decoded = html
    .replace(/&#64;|&commat;/gi, "@")
    .replace(/&#46;|&period;/gi, ".")
    .replace(/\s*(?:\[at\]|\(at\))\s*/gi, "@")
    .replace(/\s*(?:\[dot\]|\(dot\))\s*/gi, ".");
  return normalizeEmails(decoded.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []);
}

function contactPageUrls(html: string, sourceUrl: URL) {
  const values = [...html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)]
    .map((match) => match[1])
    .filter((href) => /contact|kontakt|over-ons|about/i.test(href));
  const urls = values.flatMap((href) => {
    try {
      const url = new URL(href, sourceUrl);
      return url.origin === sourceUrl.origin ? [url] : [];
    } catch {
      return [];
    }
  });
  return [...new Map(urls.map((url) => [url.toString(), url])).values()].slice(0, 1);
}

async function discoverPublicBusinessEmail(candidate: Candidate, fetchImpl: Fetcher, timeoutMs: number) {
  const raw = candidate.rawData && typeof candidate.rawData === "object" && !Array.isArray(candidate.rawData)
    ? candidate.rawData as Record<string, unknown>
    : {};
  const website = publicHttpUrl(candidate.website)
    ?? publicHttpUrl(typeof raw.website === "string" ? raw.website : undefined)
    ?? publicHttpUrl(typeof raw["contact:website"] === "string" ? raw["contact:website"] : undefined);
  if (!website) return null;
  const root = await fetchPublicPage(website, fetchImpl, timeoutMs);
  if (!root) return null;
  const rootEmails = visibleEmails(root.text);
  if (rootEmails.length) return { email: rootEmails[0], sourceUrl: root.finalUrl };
  for (const contactUrl of contactPageUrls(root.text, new URL(root.finalUrl))) {
    const contact = await fetchPublicPage(contactUrl, fetchImpl, timeoutMs);
    const emails = contact ? visibleEmails(contact.text) : [];
    if (contact && emails.length) return { email: emails[0], sourceUrl: contact.finalUrl };
  }
  return null;
}

async function resolveWithTimeout(domain: string, resolver: MxResolver, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      resolver(domain),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("MX lookup timed out"), { code: "ETIMEOUT" })), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function validatePublicBusinessEmail(
  candidate: Candidate,
  options: { resolver?: MxResolver; timeoutMs?: number; fetchImpl?: Fetcher; now?: () => Date } = {},
): Promise<BusinessEmailValidation> {
  const rawValues = [candidate.email, ...(candidate.emailAddresses ?? [])].filter((value): value is string => Boolean(value?.trim()));
  const emails = candidateBusinessEmails(candidate);
  const discovered = emails.length
    ? null
    : await discoverPublicBusinessEmail(candidate, options.fetchImpl ?? fetch, Math.min(3_000, options.timeoutMs ?? 2_500)).catch(() => null);
  if (discovered) emails.push(discovered.email);
  if (!emails.length) {
    return rawValues.length
      ? { status: "INVALID", reason: "INVALID_EMAIL", retryable: false }
      : { status: "MISSING", reason: "BUSINESS_EMAIL_REQUIRED", retryable: true };
  }
  const email = emails[0];
  const domain = email.split("@")[1];
  if (!domain || invalidDomain(domain)) return { status: "INVALID", email, reason: "DISPOSABLE_EMAIL", retryable: false };
  if (!discovered && !hasPublicEmailEvidence(candidate, email)) return { status: "RETRY", email, reason: "EMAIL_SOURCE_UNVERIFIED", retryable: true };
  if (
    !discovered
    && candidate.emailMxVerified === true
    && candidate.emailVerifiedAt
    && candidate.emailSourceUrl?.trim()
  ) {
    return {
      status: "VALID",
      email,
      domain,
      source: candidate.emailSource || candidate.source || "OPENBARE_BRON",
      sourceUrl: candidate.emailSourceUrl,
      mxVerified: true,
      checkedAt: candidate.emailVerifiedAt,
    };
  }
  try {
    const records = await resolveWithTimeout(domain, options.resolver ?? resolveMx, options.timeoutMs ?? 2_500);
    if (!records.some((record) => record.exchange?.trim())) {
      return { status: "INVALID", email, reason: "EMAIL_MX_MISSING", retryable: false };
    }
  } catch (error) {
    if (permanentDnsFailure(error)) return { status: "INVALID", email, reason: "EMAIL_MX_MISSING", retryable: false };
    return { status: "RETRY", email, reason: "EMAIL_MX_CHECK_FAILED", retryable: true };
  }
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  return {
    status: "VALID",
    email,
    domain,
    source: discovered ? "OFFICIAL_WEBSITE" : candidate.emailSource || candidate.source || "OPENBARE_BRON",
    sourceUrl: discovered?.sourceUrl || candidate.emailSourceUrl || candidate.sourceUrl || candidate.googleMapsUrl,
    mxVerified: true,
    checkedAt,
  };
}
