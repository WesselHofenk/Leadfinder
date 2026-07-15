const emptyWebsiteValues = new Set(["", "-", "null", "undefined", "geen website", "n.v.t.", "nvt", "onbekend"]);
const trackingParameters = new Set(["gclid", "fbclid", "msclkid", "dclid", "yclid", "mc_cid", "mc_eid"]);
const externalProfileHosts = [
  "google.com", "google.nl", "goo.gl", "maps.app.goo.gl", "facebook.com", "fb.com", "instagram.com", "linkedin.com",
  "treatwell.nl", "treatwell.be", "treatwell.com", "fresha.com", "booksy.com", "booksy.nl", "booksy.be",
  "thuisbezorgd.nl", "takeaway.com", "tripadvisor.com", "yelp.com", "openingstijden.nl", "telefoonboek.nl",
  "bedrijvenpagina.nl", "allebiz.nl", "cylex.nl", "trustpilot.com", "salonized.com", "setmore.com", "calendly.com",
];

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
  website?: string | null;
  websiteUrl?: string | null;
  website_url?: string | null;
  domain?: string | null;
  normalizedDomain?: string | null;
  url?: string | null;
  businessWebsite?: string | null;
  googleMapsWebsite?: string | null;
  externalWebsite?: string | null;
  websiteFields?: Array<string | null | undefined>;
};
export type WebsiteStatusDecision = {
  status: WebsiteStatusValue;
  rawValue: string | null;
  normalizedUrl: string | null;
  source: string | null;
  reason: string;
};

function rawWebsiteEntries(lead: WebsiteStatusInput) {
  const fields: Array<[string, string | null | undefined]> = [
    ["website", lead.website], ["websiteUrl", lead.websiteUrl], ["website_url", lead.website_url], ["domain", lead.domain],
    ["normalizedDomain", lead.normalizedDomain], ["url", lead.url], ["businessWebsite", lead.businessWebsite],
    ["googleMapsWebsite", lead.googleMapsWebsite], ["externalWebsite", lead.externalWebsite],
  ];
  lead.websiteFields?.forEach((value, index) => fields.push([`websiteFields[${index}]`, value]));
  return fields.filter((entry): entry is [string, string] => typeof entry[1] === "string" && !emptyWebsiteValues.has(entry[1].trim().toLowerCase()));
}

export function normalizeWebsite(value?: string | null) {
  let clean = value?.trim() ?? "";
  if (emptyWebsiteValues.has(clean.toLowerCase())) return null;
  if (clean.startsWith("//")) clean = `https:${clean}`;
  else if (!/^[a-z][a-z\d+.-]*:\/\//i.test(clean)) clean = `https://${clean}`;
  try {
    const url = new URL(clean);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".") || url.username || url.password) return null;
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith("utm_") || trackingParameters.has(key.toLowerCase())) url.searchParams.delete(key);
    if (url.pathname === "/" && !url.search) url.pathname = "";
    return url.toString().replace(/\/$/, "");
  } catch { return null; }
}

export function isNonOwnedWebsite(value?: string | null) {
  const clean = normalizeWebsite(value);
  if (!clean) return false;
  const host = new URL(clean).hostname.toLowerCase().replace(/^www\./, "");
  return externalProfileHosts.some((external) => host === external || host.endsWith(`.${external}`));
}

export function determineWebsiteStatus(lead: WebsiteStatusInput, verification?: WebsiteVerification): WebsiteStatusDecision {
  const entries = rawWebsiteEntries(lead);
  const normalized = entries.map(([source, rawValue]) => ({ source, rawValue, normalizedUrl: normalizeWebsite(rawValue) }));
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

  if (verification?.reachable === false) {
    const reason = verification.httpStatus === 403 || verification.failureKind === "forbidden" || verification.failureKind === "blocked"
      ? "Websitecontrole geblokkeerd of HTTP 403; handmatige controle nodig"
      : verification.failureKind === "timeout" ? "Websitecontrole gaf een timeout; handmatige controle nodig"
      : "Website tijdelijk niet betrouwbaar bereikbaar; handmatige controle nodig";
    return { status: "unknown", ...own, reason };
  }
  if (verification?.auditClassification && verification.auditClassification !== "USABLE") {
    return { status: "outdated_website", ...own, reason: verification.auditClassification === "OUTDATED" ? "Eigen website gevonden en sterk verouderd geclassificeerd" : "Eigen website gevonden met concrete verbeterpunten" };
  }
  return { status: "has_website", ...own, reason: "Geldige eigen bedrijfswebsite gevonden" };
}

export function hasOwnWebsite(...values: Array<string | null | undefined>) {
  return determineWebsiteStatus({ websiteFields: values }).status === "has_website";
}

export function logWebsiteStatusDecision(companyName: string, decision: WebsiteStatusDecision) {
  console.info("[website-status]", JSON.stringify({
    companyName, rawWebsiteValue: decision.rawValue, normalizedUrl: decision.normalizedUrl,
    source: decision.source, websiteStatus: decision.status, reason: decision.reason,
  }));
}
