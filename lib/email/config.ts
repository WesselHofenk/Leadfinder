import "server-only";
import { z } from "zod";

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

const schema = z.object({
  COLD_EMAIL_FROM_ADDRESS: z.string().email().default("info@sitora.nl"),
  COLD_EMAIL_FROM_NAME: z.string().trim().min(1).max(100).default("Sitora"),
  COLD_EMAIL_WARMUP_START: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default("2026-08-04"),
  COLD_EMAIL_TIME_ZONE: z.string().trim().min(1).default("Europe/Amsterdam"),
  MAIL_SMTP_HOST: z.string().trim().min(1).default("mail.sitora.nl"),
  MAIL_SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  MAIL_SMTP_SECURE: booleanString.default("false"),
  MAIL_IMAP_HOST: z.string().trim().min(1).default("mail.sitora.nl"),
  MAIL_IMAP_PORT: z.coerce.number().int().min(1).max(65535).default(993),
  MAIL_IMAP_SECURE: booleanString.default("true"),
  MAIL_USERNAME: z.string().trim().email().default("info@sitora.nl"),
  MAIL_PASSWORD: z.string().min(1),
  MAIL_SENT_FOLDER: z.string().trim().optional(),
}).superRefine((value, context) => {
  if (value.COLD_EMAIL_FROM_ADDRESS.toLowerCase() !== "info@sitora.nl") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["COLD_EMAIL_FROM_ADDRESS"], message: "De afzender moet info@sitora.nl zijn." });
  }
  if (value.MAIL_USERNAME.toLowerCase() !== "info@sitora.nl") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["MAIL_USERNAME"], message: "Het mailboxaccount moet info@sitora.nl zijn." });
  }
});

export type ColdEmailConfig = ReturnType<typeof coldEmailConfig>;

export function coldEmailConfig() {
  const result = schema.safeParse({
    ...process.env,
    COLD_EMAIL_FROM_ADDRESS: process.env.COLD_EMAIL_FROM_ADDRESS ?? process.env.SMTP_FROM_EMAIL,
    COLD_EMAIL_FROM_NAME: process.env.COLD_EMAIL_FROM_NAME ?? process.env.OUTREACH_SENDER_NAME,
    COLD_EMAIL_TIME_ZONE: process.env.COLD_EMAIL_TIME_ZONE ?? process.env.OUTREACH_TIME_ZONE,
    MAIL_SMTP_HOST: process.env.MAIL_SMTP_HOST ?? process.env.SMTP_HOST,
    MAIL_SMTP_PORT: process.env.MAIL_SMTP_PORT ?? process.env.SMTP_PORT,
    MAIL_SMTP_SECURE: process.env.MAIL_SMTP_SECURE ?? process.env.SMTP_SECURE,
    MAIL_USERNAME: process.env.MAIL_USERNAME ?? process.env.SMTP_USER,
    MAIL_PASSWORD: process.env.MAIL_PASSWORD ?? process.env.SMTP_PASSWORD,
  });
  if (!result.success) {
    throw new Error("De mailbox info@sitora.nl is nog niet volledig geconfigureerd.");
  }
  return result.data;
}
