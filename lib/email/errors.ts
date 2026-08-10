export type ColdEmailFailureCategory =
  | "INVALID_RECIPIENT"
  | "AUTHENTICATION"
  | "RATE_LIMIT"
  | "TEMPORARY_PROVIDER"
  | "PROVIDER_FATAL"
  | "SENT_ITEMS"
  | "DATABASE"
  | "LEAD"
  | "UNKNOWN";

export function safeColdEmailError(error: unknown) {
  const message = error instanceof Error ? error.message : "Onbekende e-mailfout";
  return message
    .replace(/(?:postgres(?:ql)?|https?):\/\/[^\s@/]+@/gi, "[redacted-url]")
    .replace(/(password|token|secret|authorization)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 1000);
}

export function classifyColdEmailError(error: unknown): ColdEmailFailureCategory {
  const candidate = error as { code?: string; responseCode?: number; command?: string; message?: string };
  const code = String(candidate?.code ?? "").toUpperCase();
  const message = String(candidate?.message ?? "").toLowerCase();
  const responseCode = Number(candidate?.responseCode ?? 0);

  if (code === "EAUTH" || responseCode === 535 || /authent|credentials|login failed|invalid password/.test(message)) return "AUTHENTICATION";
  if (responseCode === 429 || responseCode === 454 || /rate.?limit|too many requests|throttl/.test(message)) return "RATE_LIMIT";
  if ([421, 450, 451, 452].includes(responseCode) || /temporar|timeout|timed out|connection (?:closed|reset)|econnreset|etimedout/.test(message)) return "TEMPORARY_PROVIDER";
  if (code.startsWith("P") || /prisma|database|transaction|connection pool/.test(message)) return "DATABASE";
  if (/sent items|verzonden items|imap|archief|mailbox/.test(message)) return "SENT_ITEMS";
  if (responseCode >= 500 || /smtp|mailserver|provider/.test(message)) return "PROVIDER_FATAL";
  return "UNKNOWN";
}

export function shouldStopColdEmailRun(category: ColdEmailFailureCategory) {
  return category === "AUTHENTICATION" || category === "PROVIDER_FATAL" || category === "DATABASE";
}
