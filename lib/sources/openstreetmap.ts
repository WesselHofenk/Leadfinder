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
    this.endpoints = env.OVERPASS_API_URLS.split(",").map((value) => value.trim()).filter(Boolean);
    this.timeoutMs = env.OVERPASS_TIMEOUT_MS;
    this.totalTimeoutMs = env.OVERPASS_TOTAL_TIMEOUT_MS;
    this.maxResponseBytes = env.OVERPASS_MAX_RESPONSE_BYTES;
  }

  async searchBusinesses(input: SourceSearch) {
    const result = await searchOverpass({
      endpoints: this.endpoints,
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
