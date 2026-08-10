import { resolveMx } from "node:dns/promises";
import type { Candidate } from "./eligibility";
import { normalizeEmails, normalizePhones } from "./normalization";

export type ValidatedContacts =
  | {
      ok: true;
      email: string;
      emailStatus: "DELIVERABLE";
      emailSource: string;
      emailValidatedAt: Date;
      phone: string;
      phoneStatus: "VALID";
      phoneSource: string;
      phoneValidatedAt: Date;
    }
  | {
      ok: false;
      reason:
        | "missing_email"
        | "invalid_email"
        | "non_business_email"
        | "email_domain_unreachable"
        | "email_validation_unavailable"
        | "missing_phone"
        | "unverified_phone_source";
    };

const mxCache = new Map<string, { valid: boolean; expiresAt: number }>();
const personalEmailDomains = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.nl", "outlook.com",
  "live.com", "live.nl", "yahoo.com", "icloud.com", "proton.me", "protonmail.com",
]);

export async function validatePublicContacts(
  candidate: Candidate,
  options: { mxLookup?: typeof resolveMx; now?: () => Date } = {},
): Promise<ValidatedContacts> {
  const email = normalizeEmails([candidate.email, ...(candidate.emailAddresses ?? [])])[0];
  if (!email) return { ok: false, reason: candidate.email || candidate.emailAddresses?.some(Boolean) ? "invalid_email" : "missing_email" };
  const domain = email.split("@")[1];
  if (!domain || !domain.includes(".")) return { ok: false, reason: "invalid_email" };
  if (personalEmailDomains.has(domain)) return { ok: false, reason: "non_business_email" };

  const now = options.now?.() ?? new Date();
  const cached = mxCache.get(domain);
  let acceptsMail = cached?.expiresAt && cached.expiresAt > now.getTime() ? cached.valid : false;
  if (!cached || cached.expiresAt <= now.getTime()) {
    try {
      const records = await (options.mxLookup ?? resolveMx)(domain);
      acceptsMail = records.some((record) => Boolean(record.exchange));
    } catch {
      // A resolver timeout or temporary DNS failure is not evidence that the
      // address is unusable. Leave it out of the negative cache and retry later.
      return { ok: false, reason: "email_validation_unavailable" };
    }
    mxCache.set(domain, { valid: acceptsMail, expiresAt: now.getTime() + 12 * 60 * 60_000 });
  }
  if (!acceptsMail) return { ok: false, reason: "email_domain_unreachable" };

  const phone = normalizePhones([candidate.internationalPhoneNumber, candidate.phoneNumber, ...(candidate.phoneNumbers ?? [])], candidate.country)[0];
  if (!phone) return { ok: false, reason: "missing_phone" };
  const publicSource = candidate.sourceUrl || candidate.googleMapsUrl;
  if (!publicSource || !/^https?:\/\//i.test(publicSource)) return { ok: false, reason: "unverified_phone_source" };

  return {
    ok: true,
    email,
    emailStatus: "DELIVERABLE",
    emailSource: publicSource,
    emailValidatedAt: now,
    phone,
    phoneStatus: "VALID",
    phoneSource: publicSource,
    phoneValidatedAt: now,
  };
}

export function clearContactValidationCache() {
  mxCache.clear();
}
