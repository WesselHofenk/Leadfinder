import { resolveMx } from "node:dns/promises";

import type { Candidate } from "./eligibility";
import { normalizeEmails } from "./normalization";

type MxResolver = (domain: string) => Promise<Array<{ exchange: string; priority: number }>>;

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
  options: { resolver?: MxResolver; timeoutMs?: number; now?: () => Date } = {},
): Promise<BusinessEmailValidation> {
  const rawValues = [candidate.email, ...(candidate.emailAddresses ?? [])].filter((value): value is string => Boolean(value?.trim()));
  const emails = candidateBusinessEmails(candidate);
  if (!emails.length) {
    return rawValues.length
      ? { status: "INVALID", reason: "INVALID_EMAIL", retryable: false }
      : { status: "MISSING", reason: "BUSINESS_EMAIL_REQUIRED", retryable: true };
  }
  const email = emails[0];
  const domain = email.split("@")[1];
  if (!domain || invalidDomain(domain)) return { status: "INVALID", email, reason: "DISPOSABLE_EMAIL", retryable: false };
  if (!hasPublicEmailEvidence(candidate, email)) return { status: "RETRY", email, reason: "EMAIL_SOURCE_UNVERIFIED", retryable: true };
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
    source: candidate.emailSource || candidate.source || "OPENBARE_BRON",
    sourceUrl: candidate.emailSourceUrl || candidate.sourceUrl || candidate.googleMapsUrl,
    mxVerified: true,
    checkedAt,
  };
}

