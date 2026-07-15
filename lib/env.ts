import { z } from "zod";

const schema = z.object({
  AUTH_SECRET: z.string().min(32).optional(),
  CRON_SECRET: z.string().min(32).optional(),
  LEAD_GENERATION_TARGET: z.coerce.number().int().min(1).max(50).default(50),
  LEAD_CANDIDATE_BUFFER: z.coerce.number().int().min(50).max(1000).default(200),
  OVERPASS_API_URL: z.string().url().default("https://overpass-api.de/api/interpreter"),
  OVERPASS_API_URLS: z.string().default("https://lz4.overpass-api.de/api/interpreter,https://overpass-api.de/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter,https://overpass.private.coffee/api/interpreter"),
  OVERPASS_TIMEOUT_MS: z.coerce.number().int().min(4000).max(15000).default(10000),
  OVERPASS_TOTAL_TIMEOUT_MS: z.coerce.number().int().min(8000).max(40000).default(28000),
  OVERPASS_MAX_RESPONSE_BYTES: z.coerce.number().int().min(100000).max(4000000).default(2000000),
  GENERATION_BATCH_CANDIDATES: z.coerce.number().int().min(5).max(10).default(8),
  GENERATION_BATCH_WEBSITE_CHECKS: z.coerce.number().int().min(1).max(6).default(3),
  GENERATION_WATCHDOG_SECONDS: z.coerce.number().int().min(30).max(180).default(60),
  GENERATION_BATCH_DURATION_SECONDS: z.coerce.number().int().min(20).max(50).default(45),
  GENERATION_MAX_SOURCE_CALLS: z.coerce.number().int().min(1).max(2000).default(1000),
  GENERATION_MAX_SOURCE_FAILURES: z.coerce.number().int().min(3).max(50).default(12),
  GENERATION_MAX_RUN_MINUTES: z.coerce.number().int().min(2).max(30).default(15),
  WEBSITE_CHECK_CONCURRENCY: z.coerce.number().int().min(1).max(6).default(3),
  WEBSITE_FETCH_MAX_BYTES: z.coerce.number().int().min(100000).max(2000000).default(1000000),
  OSM_SOURCE_ENABLED: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  WEBSITE_CANDIDATE_DNS_CHECK: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(14),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3001"),
});

export function serverEnv() {
  return schema.parse(process.env);
}
