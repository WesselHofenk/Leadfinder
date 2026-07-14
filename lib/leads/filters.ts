import { z } from "zod";

export const leadStatuses = ["NEW","CALLED","NO_ANSWER","QUOTE_SENT","INVOICED","DO_NOT_CONTACT","FILTERED"] as const;
export const leadFilterSchema = z.object({
  q: z.string().trim().max(100).default(""), country: z.enum(["NL","BE"]).optional(), region: z.string().max(80).optional(),
  municipality: z.string().max(80).optional(), city: z.string().max(80).optional(), postalCode: z.string().max(12).optional(), category: z.string().max(80).optional(),
  status: z.enum(leadStatuses).optional(), leadType: z.enum(["NO_WEBSITE","OUTDATED_WEBSITE","IMPROVABLE_WEBSITE"]).optional(),
  websiteStatus: z.enum(["NO_OWN_WEBSITE","OUTDATED","IMPROVABLE","OWN_WEBSITE","UNKNOWN"]).optional(),
  filtered: z.enum(["yes"]).optional(), minScore: z.coerce.number().int().min(0).max(100).optional(), maxScore: z.coerce.number().int().min(0).max(100).optional(),
  minConfidence: z.coerce.number().int().min(0).max(100).optional(), called: z.enum(["yes","no"]).optional(), issue: z.string().max(60).optional(),
  foundAfter: z.coerce.date().optional(), foundBefore: z.coerce.date().optional(),
  newOnly: z.enum(["yes"]).optional(), verifiedBefore: z.coerce.date().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(10).max(100).default(25),
});
export type LeadFilters = z.infer<typeof leadFilterSchema>;

export function parseLeadFilters(input: Record<string, string | string[] | undefined>) {
  const flat = Object.fromEntries(Object.entries(input).map(([k,v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([,v]) => v !== undefined && v !== ""));
  return leadFilterSchema.parse(flat);
}
