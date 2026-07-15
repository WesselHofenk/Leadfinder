const emptyWebsiteValues = new Set([
  "", "-", "null", "undefined", "geen website", "n.v.t.", "nvt", "onbekend", "none", "no", "nee",
]);
const trackingParameters = new Set(["gclid", "fbclid", "msclkid", "dclid", "yclid", "mc_cid", "mc_eid"]);
const redirectParameters = ["url", "target", "redirect", "redirect_url", "redirecturi", "destination", "dest", "u", "q", "continue", "next", "website"];

/** Central blocklist for profiles, directories, marketplaces, booking, delivery and review platforms. */
export const NON_COMPANY_WEBSITE_DOMAINS = Object.freeze([
  "google.com", "google.nl", "google.be", "goo.gl", "maps.app.goo.gl", "openstreetmap.org",
  "facebook.com", "fb.com", "instagram.com", "linkedin.com", "tiktok.com", "youtube.com", "t.co", "bit.ly", "linktr.ee", "wa.me",
  "treatwell.nl", "treatwell.be", "treatwell.com", "fresha.com", "booksy.com", "booksy.nl", "booksy.be",
  "salonized.com", "setmore.com", "calendly.com", "booking.com", "opentable.com",
  "thuisbezorgd.nl", "takeaway.com", "ubereats.com", "deliveroo.nl", "deliveroo.be",
  "tripadvisor.com", "yelp.com", "foursquare.com", "trustpilot.com",
  "openingstijden.nl", "telefoonboek.nl", "telefoongids.nl", "gouden-gids.nl", "goudengids.nl",
  "bedrijvenpagina.nl", "allebiz.nl", "cylex.nl", "indebuurt.nl", "allebedrijvenin.nl",
]) as readonly string[];

const NON_COMPANY_WEBSITE_DOMAIN_FRAGMENTS = ["bedrijvengids", "bedrijven-gids", "marketplaceprofiel"];
const websiteFieldKeys = new Set([
  "website", "websiteurl", "domain", "url", "homepage", "companywebsite", "officialwebsite", "businesswebsite",
  "googlemapswebsite", "externalwebsite", "contactwebsite", "websitefields", "webpage", "web", "href",
]);
const linkCollectionKeys = new Set(["links", "externallinks", "sociallinks"]);

export type WebsiteStatusValue = "no_website" | "has_website" | "outdated_website" | "unknown";
export type WebsiteVerification = {
  reachable?: boolean;
  /** True only when the upstream source was actually checked for an absent website field. */
  absenceVerified?: boolean;
  httpStatus?: number | null;
  failureKind?: "timeout" | "forbidden" | "blocked" | "network" | "invalid_ssl" | "unknown" | null;
  auditClassification?: "USABLE" | "IMPROVABLE" | "OUTDATED" | null;
};
export type WebsiteStatusInput = {
  companyName?: string | null;
  source?: string | null;
  website?: unknown;
  websiteUrl?: unknown;
  website_url?: unknown;
  domain?: unknown;
  normalizedDomain?: unknown;
  url?: unknown;
  homepage?: unknown;
  homePage?: unknown;
  companyWebsite?: unknown;
  company_website?: unknown;
  officialWebsite?: unknown;
  official_website?: unknown;
  businessWebsite?: unknown;
  googleMapsWebsite?: unknown;
  externalWebsite?: unknown;
  links?: unknown;
  externalLinks?: unknown;
  socialLinks?: unknown;
  contact?: unknown;
  contactInfo?: unknown;
  details?: unknown;
  attributes?: unknown;
  rawData?: unknown;
  sourceData?: unknown;
  websiteFields?: unknown;
};
export type WebsiteStatusDecision = {
  status: WebsiteStatusValue;
  rawValue: string | null;
  normalizedUrl: string | null;
  source: string | null;
  reason: string;
};
export type WebsiteEntry = { source: string; rawValue: string; normalizedUrl: string | null };

function normalizeFieldKey(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function decodeHtmlEntities(value: string) {
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function looksWebsiteLike(value: string) {
  const clean = decodeHtmlEntities(value).trim();
  return /^(?:https?:)?\/\//i.test(clean) || /^www\./i.test(clean) || /(?:^|\s)[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+(?::\d+)?(?:[/?#]|$)/i.test(clean);
}

function meaningfulWebsiteValue(value: string) {
  return !emptyWebsiteValues.has(decodeHtmlEntities(value).trim().toLowerCase());
}

function unwrapEncodedValue(value: string) {
  if (!/%(?:2f|3a|3f|26|3d)/i.test(value)) return value;
  try { return decodeURIComponent(value); } catch { return value; }
}

function hostMatches(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

export function normalizeWebsiteUrl(value?: unknown, depth = 0): string | null {
  if (typeof value !== "string" || depth > 4) return null;
  let clean = unwrapEncodedValue(decodeHtmlEntities(value)).trim();
  if (!meaningfulWebsiteValue(clean)) return null;
  const embedded = clean.match(/(?:https?:\/\/|\/\/|www\.)[^\s<>"']+|(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,63}(?:[/:?#][^\s<>"']*)?/i)?.[0];
  if (embedded && embedded !== clean && !/^(?:https?:\/\/|\/\/|www\.)/i.test(clean)) clean = embedded;
  clean = clean.replace(/^[\s'"(<]+/, "").replace(/[\s'">),.;]+$/, "");
  if (clean.startsWith("//")) clean = `https:${clean}`;
  else if (!/^[a-z][a-z\d+.-]*:\/\//i.test(clean)) clean = `https://${clean}`;
  try {
    const url = new URL(clean);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".") || url.username || url.password) return null;
    const originalHost = url.hostname.toLowerCase().replace(/^www\./, "");
    const isExternalWrapper = NON_COMPANY_WEBSITE_DOMAINS.some((domain) => hostMatches(originalHost, domain)) ||
      NON_COMPANY_WEBSITE_DOMAIN_FRAGMENTS.some((fragment) => originalHost.includes(fragment));
    if (isExternalWrapper) {
      for (const key of redirectParameters) {
        const target = url.searchParams.get(key);
        const unwrapped = target ? normalizeWebsiteUrl(target, depth + 1) : null;
        if (unwrapped) return unwrapped;
      }
    }
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || trackingParameters.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    if (url.pathname === "/" && !url.search) url.pathname = "";
    return url.toString().replace(/\/$/, "");
  } catch { return null; }
}

export const normalizeWebsite = normalizeWebsiteUrl;

export function extractWebsiteEntries(company: unknown): WebsiteEntry[] {
  const entries: Array<{ source: string; rawValue: string }> = [];
  const visited = new WeakSet<object>();
  let nodes = 0;

  function visit(value: unknown, path: string, mode: "scan" | "links" | "explicit", depth: number) {
    if (depth > 12 || nodes > 3_000 || value == null) return;
    nodes += 1;
    if (typeof value === "string") {
      if (meaningfulWebsiteValue(value) && (mode === "explicit" || (mode === "links" && looksWebsiteLike(value)))) entries.push({ source: path, rawValue: value });
      return;
    }
    if (typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`, mode, depth + 1));
      return;
    }
    for (const [field, child] of Object.entries(value as Record<string, unknown>)) {
      const key = normalizeFieldKey(field);
      const childPath = path ? `${path}.${field}` : field;
      const childMode = websiteFieldKeys.has(key) ? "explicit" : linkCollectionKeys.has(key) || mode === "links" ? "links" : "scan";
      visit(child, childPath, childMode, depth + 1);
    }
  }

  visit(company, "", "scan", 0);
  const seen = new Set<string>();
  return entries.flatMap(({ source, rawValue }) => {
    const identity = `${source}\u0000${rawValue}`;
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [{ source, rawValue, normalizedUrl: normalizeWebsiteUrl(rawValue) }];
  });
}

export function isNonOwnedWebsite(value?: unknown) {
  const clean = normalizeWebsiteUrl(value);
  if (!clean) return false;
  const host = new URL(clean).hostname.toLowerCase().replace(/^www\./, "");
  return NON_COMPANY_WEBSITE_DOMAINS.some((external) => hostMatches(host, external)) ||
    NON_COMPANY_WEBSITE_DOMAIN_FRAGMENTS.some((fragment) => host.includes(fragment));
}

export function extractCompanyWebsite(company: unknown) {
  return extractWebsiteEntries(company).find((entry) => entry.normalizedUrl && !isNonOwnedWebsite(entry.normalizedUrl))?.normalizedUrl ?? null;
}

export function determineWebsiteStatus(lead: WebsiteStatusInput | object, verification?: WebsiteVerification): WebsiteStatusDecision {
  const normalized = extractWebsiteEntries(lead);
  const own = normalized.find((entry) => entry.normalizedUrl && !isNonOwnedWebsite(entry.normalizedUrl));
  if (!own) {
    const invalid = normalized.find((entry) => !entry.normalizedUrl);
    if (invalid) return { status: "unknown", rawValue: invalid.rawValue, normalizedUrl: null, source: invalid.source, reason: "Websitewaarde is aanwezig maar niet geldig te normaliseren; handmatige controle nodig" };
    const profile = normalized.find((entry) => entry.normalizedUrl);
    if (profile) return { status: "no_website", rawValue: profile.rawValue, normalizedUrl: null, source: profile.source, reason: "Alleen een extern profiel of boekingsplatform gevonden" };
    if (verification?.absenceVerified === false) {
      return { status: "unknown", rawValue: null, normalizedUrl: null, source: null, reason: "De bron bevat geen websitewaarde, maar afwezigheid is niet opnieuw bevestigd; handmatige controle nodig" };
    }
    return { status: "no_website", rawValue: null, normalizedUrl: null, source: null, reason: "Geen websitewaarde gevonden in de beschikbare bronvelden" };
  }

  const sourceDecision = { rawValue: own.rawValue, normalizedUrl: own.normalizedUrl, source: own.source };
  if (verification?.auditClassification && verification.auditClassification !== "USABLE") {
    return { status: "outdated_website", ...sourceDecision, reason: verification.auditClassification === "OUTDATED" ? "Eigen website gevonden en sterk verouderd geclassificeerd" : "Eigen website gevonden met concrete verbeterpunten" };
  }
  const reason = verification?.reachable === false
    ? "Geldig eigen domein staat expliciet in de bron; een netwerkfout maakt die website niet afwezig"
    : "Geldige eigen bedrijfswebsite gevonden";
  return { status: "has_website", ...sourceDecision, reason };
}

export function hasOwnWebsite(...values: unknown[]) {
  return determineWebsiteStatus({ websiteFields: values }).status === "has_website";
}

export function logWebsiteStatusDecision(companyName: string, decision: WebsiteStatusDecision) {
  console.info("[website-status]", JSON.stringify({
    companyName, rawWebsiteValue: decision.rawValue, normalizedUrl: decision.normalizedUrl,
    source: decision.source, websiteStatus: decision.status, reason: decision.reason,
  }));
}
