import { NextRequest, NextResponse } from "next/server";

import { currentUser } from "@/lib/auth/session";
import { searchOverpass } from "@/lib/openstreetmap/overpass";
import { hasValidOrigin, rateLimit, requestIp } from "@/lib/security/request";
import { configuredOverpassEndpoints } from "@/lib/sources/openstreetmap";
import { recordSourceProviderEvent } from "@/lib/sources/provider-health";

export const runtime = "nodejs";
export const maxDuration = 30;

const probeQuery = "[out:json][timeout:5];node(52.3600,4.8900,52.3610,4.8910)[name];out ids 1;";

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Niet toegestaan" }, { status: 403 });
  if (!hasValidOrigin(request)) return NextResponse.json({ error: "Ongeldige aanvraag" }, { status: 403 });
  if (!rateLimit(`source-health-probe:${requestIp(request)}`, 3, 10 * 60_000)) {
    return NextResponse.json({ error: "De bronhosts zijn recent al gecontroleerd." }, { status: 429 });
  }

  const endpoints = configuredOverpassEndpoints();
  const probes = await Promise.all(endpoints.map(async (endpoint) => {
    const startedAt = Date.now();
    try {
      const result = await searchOverpass({
        endpoints: [endpoint],
        country: "NL",
        city: "Amsterdam",
        latitude: 52.3605,
        longitude: 4.8905,
        radius: 250,
        timeoutMs: 6_000,
        totalTimeoutMs: 7_000,
        retriesPerEndpoint: 1,
        queryOverride: probeQuery,
        queryTypeOverride: "production-health-probe",
        tileLabelOverride: "amsterdam-small",
        onEvent: async (event) => { await recordSourceProviderEvent(event); },
      });
      return {
        endpoint,
        ok: true,
        durationMs: Date.now() - startedAt,
        validJson: true,
        resultCount: result.candidates.length,
      };
    } catch (error) {
      return {
        endpoint,
        ok: false,
        durationMs: Date.now() - startedAt,
        validJson: false,
        error: error instanceof Error ? error.message.slice(0, 300) : "Onbekende bronfout",
      };
    }
  }));
  return NextResponse.json({ checkedAt: new Date().toISOString(), runtime: "vercel-nodejs", probes });
}
