import "server-only";

import { serverEnv } from "@/lib/env";
import { searchOverpass } from "@/lib/openstreetmap/overpass";
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
    // Separate the two same-operator hosts with independent public fallbacks.
    this.endpoints = [...new Set([
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
      "https://overpass.private.coffee/api/interpreter",
      "https://lz4.overpass-api.de/api/interpreter",
      ...env.OVERPASS_API_URLS.split(",").map((value) => value.trim()).filter(Boolean),
    ])];
    this.timeoutMs = env.OVERPASS_TIMEOUT_MS;
    // A stale production override must never restore the former 28-second request.
    this.totalTimeoutMs = Math.min(18_000, env.OVERPASS_TOTAL_TIMEOUT_MS);
    this.maxResponseBytes = env.OVERPASS_MAX_RESPONSE_BYTES;
  }

  async searchBusinesses(input: SourceSearch) {
    const start = Math.abs(input.tileCursor ?? 0) % this.endpoints.length;
    const rotated = [...this.endpoints.slice(start), ...this.endpoints.slice(0, start)];
    // Try two independent hosts per short serverless batch. The next tile rotates
    // to another pair, so one request never exhausts every public host.
    const endpoints = rotated.slice(0, Math.min(2, rotated.length));
    const result = await searchOverpass({
      endpoints,
      country: input.country,
      latitude: input.latitude,
      longitude: input.longitude,
      radius: input.radius,
      category: input.category,
      tileCursor: input.tileCursor,
      timeoutMs: this.timeoutMs,
      totalTimeoutMs: this.totalTimeoutMs,
      maxResponseBytes: this.maxResponseBytes,
      signal: input.signal,
      onEvent: input.onEvent,
    });
    return { candidates: result.candidates, source: this.id, sourceUrl: result.endpoint, warnings: [], tile: result.tile.id, queryType: result.queryType };
  }
}

export function enabledSourceAdapters(): BusinessSourceAdapter[] {
  return [new OpenStreetMapAdapter()].filter((adapter) => adapter.enabled);
}
