import { z } from "zod";

const schema = z.object({
  AUTH_SECRET: z.string().min(32).optional(),
  CRON_SECRET: z.string().min(32).optional(),
  LEAD_CANDIDATE_BUFFER: z.coerce.number().int().min(50).max(1000).default(200),
  OVERPASS_API_URL: z.string().url().default("https://overpass-api.de/api/interpreter"),
  OVERPASS_API_URLS: z.string().default("https://maps.mail.ru/osm/tools/overpass/api/interpreter,https://overpass.private.coffee/api/interpreter,https://overpass-api.de/api/interpreter"),
  OVERPASS_TIMEOUT_MS: z.coerce.number().int().min(4000).max(15000).default(12000),
  OVERPASS_TOTAL_TIMEOUT_MS: z.coerce.number().int().min(8000).max(40000).default(38000),
  OVERPASS_MAX_RESPONSE_BYTES: z.coerce.number().int().min(100000).max(4000000).default(2000000),
  GENERATION_BATCH_CANDIDATES: z.coerce.number().int().min(5).max(10).default(8),
  GENERATION_BATCH_WEBSITE_CHECKS: z.coerce.number().int().min(1).max(6).default(3),
  GENERATION_WATCHDOG_SECONDS: z.coerce.number().int().min(30).max(180).default(60),
  GENERATION_BATCH_DURATION_SECONDS: z.coerce.number().int().min(20).max(50).default(45),
  GENERATION_MAX_SOURCE_CALLS: z.coerce.number().int().min(1).max(2000).default(1000),
  GENERATION_MAX_SOURCE_FAILURES: z.coerce.number().int().min(3).max(50).default(12),
  WEBSITE_CHECK_CONCURRENCY: z.coerce.number().int().min(1).max(6).default(3),
  WEBSITE_FETCH_MAX_BYTES: z.coerce.number().int().min(100000).max(2000000).default(1000000),
  OSM_SOURCE_ENABLED: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  WEBSITE_CANDIDATE_DNS_CHECK: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(14),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3001"),
  OUTREACH_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  OUTREACH_TIME_ZONE: z.string().default("Europe/Amsterdam"),
  OUTREACH_DAILY_LIMIT: z.coerce.number().int().min(1).max(100).default(5),
  OUTREACH_SENDER_NAME: z.string().min(1).default("Wessel Hofenk"),
  SMTP_HOST: z.string().min(1).default("mail.zxcs.nl"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
  SMTP_SECURE: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  SMTP_USER: z.string().email().optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_FROM_EMAIL: z.string().email().default("info@sitora.nl"),
  SMTP_REPLY_TO: z.string().email().default("info@sitora.nl"),
  IMAP_HOST: z.string().min(1).default("mail.zxcs.nl"),
  IMAP_PORT: z.coerce.number().int().min(1).max(65535).default(993),
  IMAP_SECURE: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  IMAP_SENT_MAILBOX: z.string().min(1).optional(),
});

export function serverEnv() {
  return schema.parse(process.env);
}
