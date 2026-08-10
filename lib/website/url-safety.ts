import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export function privateAddress(address: string) {
  const normalized = address.toLowerCase().split("%")[0];
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return privateAddress(mappedIpv4);
  if (normalized.includes(":")) {
    return normalized === "::"
      || normalized === "::1"
      || /^f[cd][0-9a-f]{2}:/.test(normalized)
      || /^fe[89ab][0-9a-f]:/.test(normalized)
      || /^ff[0-9a-f]{2}:/.test(normalized);
  }
  const octets = normalized.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const [a, b] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

export async function assertPublicUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Ongeldige website-URL");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "metadata.google.internal"
    || hostname === "169.254.169.254"
    || (isIP(hostname) && privateAddress(hostname))
  ) throw new Error("Lokale adressen zijn niet toegestaan");
  const records = await lookup(url.hostname, { all: true });
  if (!records.length || records.some((record) => privateAddress(record.address) || !isIP(record.address))) throw new Error("Privéadressen zijn niet toegestaan");
  return url;
}
