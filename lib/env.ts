import { z } from "zod";

const schema = z.object({
  NEON_POSTGRES_PRISMA_URL: z.string().min(1),
  NEON_POSTGRES_URL_NON_POOLING: z.string().min(1),
  GOOGLE_PLACES_API_KEY: z.string().min(1).optional(),
  PAID_PROVIDERS_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  AUTH_SECRET: z.string().min(32),
  CRON_SECRET: z.string().min(32),
  GOOGLE_PLACES_DAILY_LIMIT: z.coerce.number().int().positive().default(250),
  GOOGLE_PLACES_MONTHLY_LIMIT: z.coerce.number().int().positive().default(1000),
  GOOGLE_PLACES_ESTIMATED_COST_CENTS: z.coerce.number().int().min(0).default(3),
  GOOGLE_PLACES_MAX_PAGES_PER_JOB: z.coerce.number().int().min(1).max(3).default(2),
  LEAD_GENERATION_TARGET: z.coerce.number().int().min(1).max(100).default(50),
  LEAD_CANDIDATE_BUFFER: z.coerce.number().int().min(50).max(1000).default(200),
  OVERPASS_API_URL: z.string().url().default("https://overpass-api.de/api/interpreter"),
  OVERPASS_API_URLS: z.string().default("https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter,https://overpass.nchc.org.tw/api/interpreter"),
  OVERPASS_TIMEOUT_MS: z.coerce.number().int().min(5000).max(60000).default(30000),
  GENERATION_MAX_DURATION_SECONDS: z.coerce.number().int().min(30).max(290).default(240),
  GENERATION_MAX_SOURCE_CALLS: z.coerce.number().int().min(1).max(200).default(40),
  WEBSITE_CHECK_CONCURRENCY: z.coerce.number().int().min(1).max(6).default(3),
  WEBSITE_FETCH_MAX_BYTES: z.coerce.number().int().min(100000).max(2000000).default(1000000),
  PAGESPEED_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  PAGESPEED_MONTHLY_LIMIT: z.coerce.number().int().positive().default(100),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(14),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3001"),
});

export function serverEnv() {
  return schema.parse(process.env);
}
