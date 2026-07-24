import "server-only";

import { serverEnv } from "@/lib/env";
import { buildOverpassIdentityQuery, searchOverpassHedged } from "@/lib/openstreetmap/overpass";
import type { Candidate } from "@/lib/leads/eligibility";
import { healthySourceEndpoints, recordSourceProviderEvent } from "./provider-health";
import type { BusinessSourceAdapter, SourceSearch } from "./types";

export class OpenStreetMapAdapter implements BusinessSourceAdapter {
  readonly id = "OPENSTREETMAP";
  readonly enabled: boolean;
  private endpoints: string[];
  private timeoutMs: number;
  private totalTimeoutMs: number;
  private maxResponseBytes: number;

  constructor() {
    const env = serverEnv();
    this.enabled = env.OSM_SOURCE_ENABLED;
    // Keep only operationally independent public providers. lz4 is the same
    // provider family as overpass-api.de and kumi is the former hostname of
    // private.coffee, so counting those aliases as fallbacks caused correlated
    // failures in production.
    const configured = [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.private.coffee/api/interpreter",
      "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
      ...env.OVERPASS_API_URLS.split(",").map((value) => value.trim()).filter(Boolean),
    ];
    const providerFamily = (endpoint: string) => {
      const host = new URL(endpoint).host.toLowerCase();
      if (host === "lz4.overpass-api.de" || host === "z.overpass-api.de" || host === "overpass-api.de") return "overpass-api.de";
      if (host === "overpass.kumi.systems" || host === "overpass.private.coffee") return "private.coffee";
      return host;
    };
    const seenFamilies = new Set<string>();
    this.endpoints = configured.filter((endpoint) => {
      const family = providerFamily(endpoint);
      if (seenFamilies.has(family)) return false;
      seenFamilies.add(family);
      return true;
    });
    this.timeoutMs = env.OVERPASS_TIMEOUT_MS;
    // A stale production override must never restore the former 28-second request.
    this.totalTimeoutMs = Math.min(18_000, env.OVERPASS_TOTAL_TIMEOUT_MS);
    this.maxResponseBytes = env.OVERPASS_MAX_RESPONSE_BYTES;
  }

  async searchBusinesses(input: SourceSearch) {
    const start = Math.abs(input.tileCursor ?? 0) % this.endpoints.length;
    const rotated = [...this.endpoints.slice(start), ...this.endpoints.slice(0, start)];
    // Hedge up to three independent providers. The second/third request only
    // starts when the earlier provider is slow, and the first valid JSON result
    // wins, so one hung host can no longer consume the whole source batch.
    const healthy = await healthySourceEndpoints(rotated);
    const endpoints = healthy.slice(0, Math.min(3, healthy.length));
    const result = await searchOverpassHedged({
      endpoints,
      country: input.country,
      city: input.city,
      latitude: input.latitude,
      longitude: input.longitude,
      radius: input.radius,
      category: input.category,
      tileCursor: input.tileCursor,
      timeoutMs: Math.min(8_000, this.timeoutMs),
      totalTimeoutMs: Math.min(12_000, this.totalTimeoutMs),
      maxResponseBytes: this.maxResponseBytes,
      signal: input.signal,
      retriesPerEndpoint: 2,
      hedgeDelayMs: 1_250,
      onEvent: async (event) => {
        await recordSourceProviderEvent(event).catch(() => undefined);
        await input.onEvent?.(event);
      },
    });
    return { candidates: result.candidates, source: this.id, sourceUrl: result.endpoint, warnings: [], tile: result.tile.id, queryType: result.queryType };
  }

  async findIdentityMatches(candidate: Candidate, onEvent?: SourceSearch["onEvent"]) {
    const start = Math.abs(candidate.externalPlaceId.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0)) % this.endpoints.length;
    const rotated = [...this.endpoints.slice(start), ...this.endpoints.slice(0, start)];
    const endpoints = (await healthySourceEndpoints(rotated)).slice(0, 3);
    const result = await searchOverpassHedged({
      endpoints,
      country: candidate.country,
      city: candidate.city,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      radius: 250_000,
      // Exact identity lookups are global and can take longer than a small
      // discovery tile on free Overpass hosts. Six seconds caused valid,
      // contact-complete candidates to be marked uncertain just before the
      // website/storage gate. Keep the request bounded, but allow the healthy
      // hedged provider enough time to return the indexed identity matches.
      timeoutMs: Math.min(8_000, this.timeoutMs),
      totalTimeoutMs: Math.min(12_000, this.totalTimeoutMs),
      maxResponseBytes: this.maxResponseBytes,
      retriesPerEndpoint: 1,
      hedgeDelayMs: 500,
      queryOverride: buildOverpassIdentityQuery(candidate),
      queryTypeOverride: "identity-location-count",
      tileLabelOverride: candidate.externalPlaceId,
      onEvent: async (event) => {
        await recordSourceProviderEvent(event).catch(() => undefined);
        await onEvent?.(event);
      },
    });
    return result.candidates;
  }
}

export function enabledSourceAdapters(): BusinessSourceAdapter[] {
  return [new OpenStreetMapAdapter()].filter((adapter) => adapter.enabled);
}
