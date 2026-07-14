const emptyWebsiteValues = new Set(["", "-", "null", "undefined", "geen website", "n.v.t.", "nvt", "onbekend"]);
const nonOwnedHosts = [
  "google.com", "goo.gl", "facebook.com", "fb.com", "instagram.com", "linkedin.com",
  "thuisbezorgd.nl", "takeaway.com", "tripadvisor.", "yelp.", "openingstijden.nl",
  "telefoonboek.nl", "bedrijvenpagina.nl", "allebiz.", "cylex.", "trustpilot.com",
];

export function normalizeWebsite(value?: string | null) {
  const clean = value?.trim() ?? "";
  if (emptyWebsiteValues.has(clean.toLowerCase())) return null;
  return clean;
}

export function isNonOwnedWebsite(value?: string | null) {
  const clean = normalizeWebsite(value);
  if (!clean) return false;
  try {
    const url = new URL(/^https?:\/\//i.test(clean) ? clean : `https://${clean}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return nonOwnedHosts.some((item) => item.endsWith(".") ? host.includes(item) : host === item || host.endsWith(`.${item}`));
  } catch {
    return true;
  }
}

export function hasOwnWebsite(...values: Array<string | null | undefined>) {
  return values.some((value) => Boolean(normalizeWebsite(value)) && !isNonOwnedWebsite(value));
}
