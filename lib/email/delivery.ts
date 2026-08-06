import "server-only";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { ColdEmailConfig } from "./config";

export type OutgoingColdEmail = {
  recipient: string;
  subject: string;
  bodyText: string;
  sentAt: Date;
  messageId?: string | null;
};

export async function compileColdEmail(config: ColdEmailConfig, email: OutgoingColdEmail) {
  const compiler = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const result = await compiler.sendMail({
    from: { name: config.COLD_EMAIL_FROM_NAME, address: config.COLD_EMAIL_FROM_ADDRESS },
    to: email.recipient,
    subject: email.subject,
    text: email.bodyText,
    date: email.sentAt,
    messageId: email.messageId || undefined,
  });
  if (!Buffer.isBuffer(result.message)) throw new Error("De e-mail kon niet als archiefkopie worden opgebouwd.");
  return { raw: result.message, messageId: result.messageId };
}

export async function sendCompiledColdEmail(config: ColdEmailConfig, recipient: string, raw: Buffer) {
  const transport = nodemailer.createTransport({
    host: config.MAIL_SMTP_HOST,
    port: config.MAIL_SMTP_PORT,
    secure: config.MAIL_SMTP_SECURE,
    requireTLS: !config.MAIL_SMTP_SECURE,
    auth: { user: config.MAIL_USERNAME, pass: config.MAIL_PASSWORD },
  });
  const result = await transport.sendMail({
    envelope: { from: config.MAIL_BOUNCE_ADDRESS ?? config.COLD_EMAIL_FROM_ADDRESS, to: [recipient] },
    raw,
  });
  const accepted = result.accepted.map(String).map((value) => value.toLowerCase());
  if (!accepted.includes(recipient.toLowerCase())) throw new Error("De mailserver heeft de ontvanger niet geaccepteerd.");
  return result;
}

export async function appendToSentItems(config: ColdEmailConfig, raw: Buffer, sentAt: Date) {
  const client = new ImapFlow({
    host: config.MAIL_IMAP_HOST,
    port: config.MAIL_IMAP_PORT,
    secure: config.MAIL_IMAP_SECURE,
    auth: { user: config.MAIL_USERNAME, pass: config.MAIL_PASSWORD },
    logger: false,
  });
  await client.connect();
  try {
    const mailboxes = await client.list();
    const sentFolder = config.MAIL_SENT_FOLDER
      || mailboxes.find((mailbox) => mailbox.specialUse === "\\Sent")?.path
      || mailboxes.find((mailbox) => /^(sent|sent items|verzonden|verzonden items)$/i.test(mailbox.path))?.path;
    if (!sentFolder) throw new Error("De map Verzonden items is niet gevonden op de mailserver.");
    const result = await client.append(sentFolder, raw, ["\\Seen"], sentAt);
    if (!result) throw new Error("De archiefkopie is niet door de mailserver bevestigd.");
    return { folder: sentFolder, uid: result.uid };
  } finally {
    await client.logout().catch(() => undefined);
  }
}
