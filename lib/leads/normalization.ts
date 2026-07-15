export function normalizeText(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b([a-z])\s+([a-z])\b/g, "$1$2").trim();
}

function normalizeSinglePhone(value: string, country: string): string | null {
  let digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (!digits.startsWith("+")) {
    digits = digits.replace(/^0+/, "");
    digits = `${country.toUpperCase() === "BE" ? "+32" : "+31"}${digits}`;
  }
  const compact = `+${digits.replace(/\D/g, "")}`;
  if (country.toUpperCase() === "NL" && !/^\+31\d{9}$/.test(compact)) return null;
  if (country.toUpperCase() === "BE" && !/^\+32\d{8,9}$/.test(compact)) return null;
  return compact;
}

export function normalizePhones(values: Array<string | null | undefined>, country: string): string[] {
  const candidates = values.flatMap((value) => typeof value === "string"
    ? value.split(/\s*(?:;|\||\s\/\s)\s*/).map((part) => part.trim()).filter(Boolean)
    : []);
  return [...new Set(candidates.map((value) => normalizeSinglePhone(value, country)).filter((value): value is string => Boolean(value)))];
}

export function normalizePhone(value: string, country: string): string | null {
  return normalizePhones([value], country)[0] ?? null;
}

export function normalizeDomain(value?: string | null): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "") || null;
  } catch { return null; }
}

export function normalizeEmail(value?: string | null): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function normalizeEmails(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.flatMap((value) => typeof value === "string" ? value.split(/[;,\s]+/) : [])
    .map((value) => normalizeEmail(value)).filter((value): value is string => Boolean(value)))];
}

export function normalizePostalCode(value: string | undefined, country: string): string | null {
  const upper = value?.toUpperCase() ?? "";
  const match = country.toUpperCase() === "NL" ? upper.match(/\b(\d{4})\s?([A-Z]{2})\b/) : upper.match(/\b(\d{4})\b/);
  if (country.toUpperCase() === "NL") return match ? `${match[1]} ${match[2]}` : null;
  if (country.toUpperCase() === "BE") return match?.[1] ?? null;
  return null;
}
