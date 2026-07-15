import { z } from "zod";

export const leadStatuses = ["NEW","NEEDS_REVIEW","VERIFIED","CALLED","NO_ANSWER","CALL_BACK","INTERESTED","APPOINTMENT","QUOTE_SENT","WON","INVOICED","LOST","REJECTED","HAS_WEBSITE","PERMANENTLY_CLOSED","DO_NOT_CONTACT","FILTERED"] as const;
export const websiteStatuses = ["NO_WEBSITE_CONFIRMED","NO_WEBSITE_LIKELY","SOCIAL_ONLY","WEBSITE_FOUND","WEBSITE_OUTDATED","WEBSITE_BROKEN","MANUAL_REVIEW_REQUIRED","UNKNOWN"] as const;
export const sortOptions = ["confidence_desc","opportunity_desc","newest","oldest","checked_desc","city","category","status","contacts_desc"] as const;

export const leadFilterSchema = z.object({
  q: z.string().trim().max(100).default(""), country: z.enum(["NL","BE"]).optional(), region: z.string().trim().max(80).optional(),
  municipality: z.string().trim().max(80).optional(), city: z.string().trim().max(80).optional(), postalCode: z.string().trim().max(12).optional(), category: z.string().trim().max(80).optional(),
  status: z.enum(leadStatuses).optional(), leadType: z.enum(["NO_WEBSITE","OUTDATED_WEBSITE","IMPROVABLE_WEBSITE"]).optional(),
  websiteStatus: z.enum(websiteStatuses).optional(), source: z.enum(["OPENSTREETMAP","OPEN_DATA","PUBLIC_WEBSITE","MANUAL","GOOGLE_PLACES"]).optional(),
  businessStatus: z.enum(["OPERATIONAL","CLOSED_TEMPORARILY","CLOSED_PERMANENTLY","UNKNOWN","FUTURE_OPENING"]).optional(),
  filtered: z.enum(["yes"]).optional(), hasPhone: z.enum(["yes","no"]).optional(), hasEmail: z.enum(["yes","no"]).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(), maxScore: z.coerce.number().int().min(0).max(100).optional(),
  minConfidence: z.coerce.number().int().min(0).max(100).optional(), called: z.enum(["yes","no"]).optional(), issue: z.string().trim().max(60).optional(),
  foundAfter: z.coerce.date().optional(), foundBefore: z.coerce.date().optional(), newOnly: z.enum(["yes"]).optional(), verifiedBefore: z.coerce.date().optional(),
  sort: z.enum(sortOptions).default("newest"), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(10).max(100).default(25),
});
export type LeadFilters = z.infer<typeof leadFilterSchema>;

export function parseLeadFilters(input: Record<string, string | string[] | undefined>) {
  const flat = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]).filter(([, value]) => value !== undefined && value !== ""));
  return leadFilterSchema.parse(flat);
}
