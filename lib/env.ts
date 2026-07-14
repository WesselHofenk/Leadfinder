import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  GOOGLE_PLACES_API_KEY: z.string().min(1).optional(),
  AUTH_SECRET: z.string().min(32),
  CRON_SECRET: z.string().min(32),
  GOOGLE_PLACES_DAILY_LIMIT: z.coerce.number().int().positive().default(250),
  GOOGLE_PLACES_MAX_PAGES_PER_JOB: z.coerce.number().int().min(1).max(3).default(2),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(14),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3001"),
});

export function serverEnv() {
  return schema.parse(process.env);
}
