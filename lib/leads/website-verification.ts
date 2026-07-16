import { resolveAny } from "node:dns/promises";
import type { Candidate } from "./eligibility";
import { normalizeEmails, normalizeText } from "./normalization";
import { determineWebsiteStatus, extractWebsiteEntries, isNonOwnedWebsite, normalizeWebsite } from "./website";

export type LocalWebsiteStatus =
  | "NO_WEBSITE_CONFIRMED"
  | "NO_WEBSITE_LIKELY"
  | "SOCIAL_ONLY"
  | "WEBSITE_FOUND"
  | "WEBSITE_OUTDATED"
  | "WEBSITE_BROKEN"
  | "MANUAL_REVIEW_REQUIRED"
  | "UNKNOWN";

export type Evidence = { checkType: string; result: string; confidence: number; evidenceUrl?: string; shortExplanation: string };
export type WebsiteVerificationResult = {
  status: LocalWebsiteStatus;
  confidence: number;
  website: string | null;
  reason: string;
  evidence: Evidence[];
};

const legalForms = /\b(bv|b\.v\.?|vof|v\.o\.f\.?|nv|n\.v\.?|eenmanszaak|cv|maatschap)\b/gi;
const weakNameTokens = new Set(["de", "den", "der", "het", "the", "van", "voor", "en", "and", "bij", "by"]);
const descriptorTokens = new Set([
  "opticien", "opticiens", "kapper", "kapsalon", "salon", "restaurant", "cafe", "winkel", "shop", "store",
  "praktijk", "studio", "centrum", "center", "services", "service", "bedrijf", "bedrijven",
]);
const publicEmailDomains = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.nl", "live.com", "live.nl", "yahoo.com",
  "icloud.com", "proton.me", "protonmail.com", "ziggo.nl", "kpnmail.nl", "planet.nl", "xs4all.nl", "telenet.be", "skynet.be",
]);
// Eligibility already rejects OSM records older than six years. Requiring a
// second, unrelated two-year cutoff caused valid records to stay in retry forever.
const strongAbsenceFreshnessMs = 6 * 365.25 * 24 * 60 * 60 * 1000;

function websiteValues(candidate: Candidate) {
  return extractWebsiteEntries(candidate).map(({ rawValue }) => rawValue);
}

function words(value?: string) {
  return normalizeText(value ?? "").split(" ").filter(Boolean);
}

function identityTerms(candidate: Candidate) {
  const locations = new Set([...words(candidate.city), ...words(candidate.municipality), ...words(candidate.province)]);
  const company = words(candidate.companyName.replace(legalForms, ""));
  const brand = [...words(candidate.brand), ...words(candidate.operator)];
  return [...new Set([...brand, ...company].filter((token) =>
    token.length >= 4 && !weakNameTokens.has(token) && !descriptorTokens.has(token) && !locations.has(token),
  ))];
}

/** Domain candidates are intentionally broad: short brand domains such as pearle.nl must be checked too. */
export function candidateDomains(candidate: Candidate) {
  const countrySuffix = candidate.country.toUpperCase() === "BE" ? "be" : "nl";
  const locations = new Set([...words(candidate.city), ...words(candidate.municipality), ...words(candidate.province)]);
  const companyWords = words(candidate.companyName.replace(legalForms, "")).filter((token) => !locations.has(token));
  const terms = identityTerms(candidate);
  const roots = [
    words(candidate.brand).join(""), words(candidate.operator).join(""), terms[0], terms.slice(0, 2).join(""),
    companyWords.filter((token) => !weakNameTokens.has(token)).join(""), companyWords.join(""),
    companyWords.filter((token) => !weakNameTokens.has(token)).join("-"), companyWords.join("-"),
  ].filter((root): root is string => Boolean(root && root.length >= 4 && root.length <= 63 && /[a-z]/.test(root)));
  const emailDomains = normalizeEmails([candidate.email, ...(candidate.emailAddresses ?? [])])
    .map((email) => email.split("@")[1]).filter((domain) => domain && !publicEmailDomains.has(domain));
  const suffixes = countrySuffix === "nl" ? ["nl", "com", "eu"] : ["be", "com", "eu"];
  return [...new Set([...emailDomains, ...roots.flatMap((root) => suffixes.map((suffix) => `${root}.${suffix}`))])].slice(0, 10);
}

export function hasStrongAutomaticAbsenceEvidence(candidate: Candidate, now = Date.now()) {
  const updatedAt = candidate.sourceUpdatedAt ? Date.parse(candidate.sourceUpdatedAt) : Number.NaN;
  const recent = Number.isFinite(updatedAt) && updatedAt <= now + 86_400_000 && now - updatedAt <= strongAbsenceFreshnessMs;
  const mappedLocation = Number.isFinite(candidate.latitude) && Number.isFinite(candidate.longitude)
    && Boolean(candidate.city?.trim()) && normalizeText(candidate.city) !== "onbekend";
  return candidate.source === "OPENSTREETMAP"
    && candidate.sourceWebsiteFieldsChecked === true
    && recent
    && mappedLocation
    && Boolean(candidate.companyName?.trim());
}

function dnsAbsent(error: unknown) {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === "ENOTFOUND" || code === "ENODATA";
}

type DomainProbe = { result: "found" | "absent" | "unknown"; website?: string };
const probeCache = new Map<string, { expiresAt: number; value: DomainProbe }>();

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), timeoutMs); })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function requestWithRedirects(url: string, method: "HEAD" | "GET", fetchImpl: typeof fetch, maxRedirects = 3) {
  let current = url;
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const response = await fetchImpl(current, {
      method, redirect: "manual", signal: AbortSignal.timeout(2_500),
      headers: { "User-Agent": "LeadfinderSitora/4.0 local-website-verification" },
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location || redirect === maxRedirects) return response;
    current = new URL(location, current).toString();
  }
  throw new Error("redirect_limit");
}

export async function probeDomain(domain: string, options: { fetchImpl?: typeof fetch; dnsLookup?: typeof resolveAny; now?: () => number } = {}): Promise<DomainProbe> {
  const now = options.now?.() ?? Date.now();
  const cached = probeCache.get(domain);
  if (cached && cached.expiresAt > now) return cached.value;
  const remember = (value: DomainProbe, ttlMs: number) => { probeCache.set(domain, { value, expiresAt: now + ttlMs }); return value; };
  try { await withTimeout((options.dnsLookup ?? resolveAny)(domain), 2_500); }
  catch (error) { return { result: dnsAbsent(error) ? "absent" : "unknown" }; }
  const fetchImpl = options.fetchImpl ?? fetch;
  for (const protocol of ["https", "http"] as const) {
    try {
      let response = await requestWithRedirects(`${protocol}://${domain}`, "HEAD", fetchImpl);
      if (response.status === 405) response = await requestWithRedirects(`${protocol}://${domain}`, "GET", fetchImpl);
      if (response.status === 403 || response.status === 429 || response.status >= 500) continue;
      if (response.status < 400) return remember({ result: "found", website: normalizeWebsite(response.url) ?? `${protocol}://${domain}` }, 12 * 60 * 60_000);
    } catch { /* Try the other protocol. */ }
  }
  return remember({ result: "unknown" }, 10 * 60_000);
}

async function mapLimited<T, R>(values: T[], concurrency: number, mapper: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) { const index = cursor; cursor += 1; results[index] = await mapper(values[index]); }
  }));
  return results;
}

export function clearDomainProbeCache() { probeCache.clear(); }

export function isConfirmedNoWebsite(status: LocalWebsiteStatus | string) {
  return status === "NO_WEBSITE_CONFIRMED";
}

export async function verifyWebsiteCandidate(candidate: Candidate): Promise<WebsiteVerificationResult> {
  const sourceDecision = determineWebsiteStatus(candidate, { absenceVerified: false });
  const normalized = websiteValues(candidate).map((value) => normalizeWebsite(value)).filter((value): value is string => Boolean(value));
  const owned = normalized.find((value) => !isNonOwnedWebsite(value));
  if (owned) return {
    status: "WEBSITE_FOUND", confidence: 100, website: owned, reason: "De openbare bron bevat een geldige eigen bedrijfswebsite.",
    evidence: [{ checkType: "SOURCE_WEBSITE", result: "FOUND", confidence: 100, evidenceUrl: owned, shortExplanation: "Eigen domein rechtstreeks in de bron gevonden." }],
  };
  if (sourceDecision.status === "unknown" && sourceDecision.rawValue) return {
    status: "UNKNOWN", confidence: 35, website: null,
    reason: "De bron bevat een websitewaarde die niet veilig kon worden genormaliseerd; deze kandidaat wordt niet als geen-websitelead opgeslagen.",
    evidence: [{ checkType: "SOURCE_WEBSITE", result: "INVALID", confidence: 35, shortExplanation: sourceDecision.reason }],
  };
  const externalEvidence: Evidence[] = normalized.map((url) => ({
    checkType: "EXTERNAL_PROFILE", result: "FOUND", confidence: 60, evidenceUrl: url,
    shortExplanation: "Extern profiel gevonden; dit sluit een eigen website niet uit.",
  }));
  if (process.env.WEBSITE_CANDIDATE_DNS_CHECK === "false") return {
    status: "MANUAL_REVIEW_REQUIRED", confidence: 40, website: null,
    reason: "Automatische domeincontrole is uitgeschakeld; controleer het actuele Google-bedrijfsprofiel handmatig.",
    evidence: [...externalEvidence, { checkType: "SOURCE_WEBSITE", result: "UNVERIFIED", confidence: 40, shortExplanation: "Ontbrekende brondata is geen bewijs dat een website niet bestaat." }],
  };
  const domains = candidateDomains(candidate);
  if (!domains.length) return {
    status: "MANUAL_REVIEW_REQUIRED", confidence: 40, website: null,
    reason: "Er kon geen verantwoord domeinvoorstel worden opgebouwd; controleer Google handmatig.",
    evidence: [...externalEvidence, { checkType: "DOMAIN_CANDIDATES", result: "UNAVAILABLE", confidence: 40, shortExplanation: "Google-bedrijfsprofiel moet handmatig worden gecontroleerd." }],
  };
  const checks = await mapLimited(domains, 3, async (domain) => ({ domain, probe: await probeDomain(domain) }));
  const found = checks.find((check) => check.probe.result === "found");
  if (found) return {
    status: "WEBSITE_FOUND", confidence: 92, website: found.probe.website ?? `https://${found.domain}`,
    reason: "Een plausibel merk- of bedrijfsdomein reageert; dit bedrijf hoort niet in de geen-website-lijst.",
    evidence: checks.map((check) => ({ checkType: "DOMAIN_PROBE", result: check.probe.result.toUpperCase(), confidence: 92, evidenceUrl: check.probe.website ?? `https://${check.domain}`, shortExplanation: `DNS/HTTP-controle van ${check.domain}.` })),
  };
  if (checks.some((check) => check.probe.result === "unknown")) return {
    status: "UNKNOWN", confidence: 45, website: null,
    reason: "Minstens één domeincontrole mislukte of werd geblokkeerd; geen website kan niet betrouwbaar worden vastgesteld.",
    evidence: [...externalEvidence, ...checks.map((check) => ({ checkType: "DOMAIN_PROBE", result: check.probe.result.toUpperCase(), confidence: 45, evidenceUrl: `https://${check.domain}`, shortExplanation: "Een timeout, blokkade of netwerkfout blijft onzeker." }))],
  };
  const explicitAbsence = candidate.websiteAbsenceConfirmed === true;
  const strongAutomaticAbsence = hasStrongAutomaticAbsenceEvidence(candidate);
  if (explicitAbsence || strongAutomaticAbsence) return {
    status: "NO_WEBSITE_CONFIRMED", confidence: explicitAbsence ? 90 : 84, website: null,
    reason: explicitAbsence
      ? "De openbare bron markeert de website expliciet als afwezig en alle begrensde domeincontroles waren negatief."
      : normalized.length
        ? "De bron bevat alleen een sociaal of extern profiel, geen eigen website; alle plausibele bedrijfsdomeinen zijn negatief gecontroleerd."
        : "Een recent openbaar bedrijfsrecord bevat geen website; alle uitgebreide bedrijfs-, merk-, plaats- en e-maildomeincontroles waren negatief.",
    evidence: [...externalEvidence, { checkType: "SOURCE_WEBSITE", result: explicitAbsence ? "ABSENT_CONFIRMED" : "ABSENT_AFTER_STRONG_CHECKS", confidence: explicitAbsence ? 90 : 84,
      shortExplanation: explicitAbsence ? "Expliciete bronwaarde voor geen website." : "Niet alleen een leeg veld: recente bronmetadata, aanvullende activiteitssignalen en uitgebreide domeincontroles ondersteunen de afwezigheid." },
      ...checks.map((check) => ({ checkType: "DOMAIN_PROBE", result: "NOT_FOUND", confidence: explicitAbsence ? 90 : 84, evidenceUrl: `https://${check.domain}`, shortExplanation: "Plausibele domeinkandidaat bestaat niet." }))],
  };
  if (normalized.length) return {
    status: "SOCIAL_ONLY", confidence: 60, website: null,
    reason: "Alleen een extern profiel gevonden; Google moet nog handmatig bevestigen dat er geen eigen website is.",
    evidence: [...externalEvidence, ...checks.map((check) => ({ checkType: "DOMAIN_PROBE", result: "NOT_FOUND", confidence: 60, evidenceUrl: `https://${check.domain}`, shortExplanation: "Deze domeinkandidaat bestaat niet, maar andere domeinen kunnen nog bestaan." }))],
  };
  return {
    status: "MANUAL_REVIEW_REQUIRED", confidence: 55, website: null,
    reason: "Geen plausibel domein gevonden, maar alleen een actuele handmatige Google-controle mag dit als geen website bevestigen.",
    evidence: checks.map((check) => ({ checkType: "DOMAIN_PROBE", result: "NOT_FOUND", confidence: 55, evidenceUrl: `https://${check.domain}`, shortExplanation: "Deze domeinkandidaat bestaat niet; dit bewijst niet dat elk mogelijk domein ontbreekt." })),
  };
}
