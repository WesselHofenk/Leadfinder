import "server-only";
import { resolveMx } from "node:dns/promises";

export class UndeliverableRecipientDomainError extends Error {
  constructor(public readonly domain: string) {
    super(`Het e-maildomein ${domain} heeft geen geldige mailserver.`);
    this.name = "UndeliverableRecipientDomainError";
  }
}

export async function assertRecipientDomainCanReceiveMail(recipient: string) {
  const domain = recipient.trim().toLowerCase().split("@").at(-1);
  if (!domain || !domain.includes(".")) throw new UndeliverableRecipientDomainError(domain || "onbekend");
  try {
    const records = await resolveMx(domain);
    const deliverable = records.some((record) => Boolean(record.exchange) && record.exchange !== ".");
    if (!deliverable) throw new UndeliverableRecipientDomainError(domain);
  } catch (error) {
    if (error instanceof UndeliverableRecipientDomainError) throw error;
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (["ENODATA", "ENOTFOUND", "ENONAME", "ENXDOMAIN"].includes(code)) {
      throw new UndeliverableRecipientDomainError(domain);
    }
    throw error;
  }
}
