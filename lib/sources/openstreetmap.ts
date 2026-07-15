import "server-only";

import { serverEnv } from "@/lib/env";
import { searchOverpass } from "@/lib/openstreetmap/overpass";
import type { BusinessSourceAdapter, SourceSearch } from "./types";

export class OpenStreetMapAdapter implements BusinessSourceAdapter {
  readonly id = "OPENSTREETMAP";
  readonly enabled: boolean;
  private endpoints: string[];
  private timeoutMs: number;

  constructor() {
    const env = serverEnv();
    this.enabled = env.OSM_SOURCE_ENABLED;
    this.endpoints = env.OVERPASS_API_URLS.split(",").map((value) => value.trim()).filter(Boolean);
    this.timeoutMs = env.OVERPASS_TIMEOUT_MS;
  }

  async searchBusinesses(input: SourceSearch) {
    const result = await searchOverpass({
      endpoints: this.endpoints,
      country: input.country,
      latitude: input.latitude,
      longitude: input.longitude,
      radius: input.radius,
      timeoutMs: this.timeoutMs,
    });
    return { candidates: result.candidates, source: this.id, sourceUrl: result.endpoint, warnings: [] };
  }
}

export function enabledSourceAdapters(): BusinessSourceAdapter[] {
  return [new OpenStreetMapAdapter()].filter((adapter) => adapter.enabled);
}
