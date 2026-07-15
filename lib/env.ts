import { z } from "zod";

const schema = z.object({
  AUTH_SECRET: z.string().min(32).optional(),
  CRON_SECRET: z.string().min(32).optional(),
  LEAD_GENERATION_TARGET: z.coerce.number().int().min(1).max(50).default(50),
  LEAD_CANDIDATE_BUFFER: z.coerce.number().int().min(50).max(1000).default(200),
  OVERPASS_API_URL: z.string().url().default("https://overpass-api.de/api/interpreter"),
  OVERPASS_API_URLS: z.string().default("https://lz4.overpass-api.de/api/interpreter,https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter"),
  OVERPASS_TIMEOUT_MS: z.coerce.number().int().min(5000).max(20000).default(12000),
  OVERPASS_TOTAL_TIMEOUT_MS: z.coerce.number().int().min(8000).max(45000).default(28000),
  GENERATION_BATCH_CANDIDATES: z.coerce.number().int().min(5).max(100).default(30),
  GENERATION_BATCH_WEBSITE_CHECKS: z.coerce.number().int().min(1).max(6).default(3),
  GENERATION_WATCHDOG_SECONDS: z.coerce.number().int().min(30).max(180).default(60),
  GENERATION_MAX_DURATION_SECONDS: z.coerce.number().int().min(30).max(290).default(240),
  GENERATION_MAX_SOURCE_CALLS: z.coerce.number().int().min(1).max(200).default(40),
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
