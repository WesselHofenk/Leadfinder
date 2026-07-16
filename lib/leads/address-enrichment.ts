import type { Candidate } from "./eligibility";
import { prisma } from "@/lib/prisma";

function cacheKey(candidate: Candidate) { return `${candidate.latitude.toFixed(5)},${candidate.longitude.toFixed(5)}`; }
export function needsReverseGeocoding(candidate: Candidate) {
  return /\([-+]?\d+\.\d+,\s*[-+]?\d+\.\d+\)/.test(candidate.streetAddress) || !candidate.streetAddress.trim();
}

export async function enrichCandidateAddress(candidate: Candidate, fetchImpl: typeof fetch = fetch): Promise<Candidate> {
  if (!needsReverseGeocoding(candidate)) return { ...candidate, formattedAddress: candidate.formattedAddress || candidate.streetAddress };
  const key = cacheKey(candidate);
  const cached = await prisma.geocodingCache.findFirst({ where: { cacheKey: key, expiresAt: { gt: new Date() } } });
  if (cached) return { ...candidate, streetAddress: cached.formattedAddress, formattedAddress: cached.formattedAddress, houseNumber: cached.houseNumber ?? undefined, postalCode: cached.postalCode ?? undefined, city: cached.city, municipality: cached.municipality ?? undefined, province: cached.province ?? undefined, country: cached.country };
  const health = await prisma.sourceProviderHealth.findUnique({ where: { provider: "NOMINATIM" }, select: { lastCheckedAt: true } });
  if (health?.lastCheckedAt && Date.now() - health.lastCheckedAt.getTime() < 1_100) return candidate;
  const started = Date.now();
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.search = new URLSearchParams({ format: "jsonv2", addressdetails: "1", zoom: "18", lat: String(candidate.latitude), lon: String(candidate.longitude), "accept-language": "nl" }).toString();
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(8_000), headers: { "User-Agent": "LeadfinderSitora/5.0 (address-enrichment; leadfindersitora.nl)" } });
    if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
    const data = await response.json() as { display_name?: string; address?: Record<string, string> };
    const address = data.address ?? {};
    const street = address.road || address.pedestrian || address.residential || address.neighbourhood;
    const city = address.city || address.town || address.village || address.municipality || candidate.city;
    const formattedAddress = data.display_name?.trim();
    if (!formattedAddress || !street || !city) return candidate;
    const values = { latitude: candidate.latitude, longitude: candidate.longitude, formattedAddress, street, houseNumber: address.house_number, postalCode: address.postcode, city, municipality: address.municipality, province: address.state || address.province, country: (address.country_code || candidate.country).toUpperCase(), expiresAt: new Date(Date.now() + 180 * 86_400_000) };
    await prisma.$transaction([
      prisma.geocodingCache.upsert({ where: { cacheKey: key }, create: { cacheKey: key, ...values }, update: values }),
      prisma.sourceProviderHealth.upsert({ where: { provider: "NOMINATIM" }, create: { provider: "NOMINATIM", totalSuccesses: 1, lastCheckedAt: new Date(), lastSuccessAt: new Date(), lastDurationMs: Date.now() - started }, update: { totalSuccesses: { increment: 1 }, consecutiveFailures: 0, unhealthyUntil: null, lastCheckedAt: new Date(), lastSuccessAt: new Date(), lastDurationMs: Date.now() - started } }),
    ]);
    return { ...candidate, streetAddress: formattedAddress, formattedAddress, houseNumber: address.house_number, postalCode: address.postcode, city, municipality: address.municipality, province: address.state || address.province, country: values.country };
  } catch (error) {
    await prisma.sourceProviderHealth.upsert({ where: { provider: "NOMINATIM" }, create: { provider: "NOMINATIM", consecutiveFailures: 1, totalFailures: 1, lastCheckedAt: new Date(), lastErrorCode: "REVERSE_GEOCODING_FAILED", lastErrorMessage: error instanceof Error ? error.message : "Onbekende fout" }, update: { consecutiveFailures: { increment: 1 }, totalFailures: { increment: 1 }, lastCheckedAt: new Date(), lastErrorCode: "REVERSE_GEOCODING_FAILED", lastErrorMessage: error instanceof Error ? error.message : "Onbekende fout" } });
    return candidate;
  }
}
