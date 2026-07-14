export function normalizeText(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b([a-z])\s+([a-z])\b/g, "$1$2").trim();
}

export function normalizePhone(value: string, country: string): string | null {
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
