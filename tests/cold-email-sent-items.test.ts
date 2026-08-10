import { beforeEach, describe, expect, it, vi } from "vitest";

const { client, ImapFlow } = vi.hoisted(() => {
  const client = {
    connect: vi.fn(async () => undefined),
    list: vi.fn(async () => [{ path: "Sent", specialUse: "\\Sent" }]),
    mailboxOpen: vi.fn(async () => ({})),
    search: vi.fn(async () => [] as number[]),
    append: vi.fn(async () => ({ uid: 42 })),
    logout: vi.fn(async () => undefined),
  };
  return { client, ImapFlow: vi.fn(() => client) };
});

vi.mock("server-only", () => ({}));
vi.mock("imapflow", () => ({ ImapFlow }));

import { appendToSentItems } from "@/lib/email/delivery";

const config = {
  COLD_EMAIL_FROM_ADDRESS: "info@sitora.nl",
  COLD_EMAIL_FROM_NAME: "Sitora",
  COLD_EMAIL_WARMUP_START: "2026-08-10",
  COLD_EMAIL_TIME_ZONE: "Europe/Amsterdam",
  MAIL_SMTP_HOST: "mail.sitora.nl",
  MAIL_SMTP_PORT: 587,
  MAIL_SMTP_SECURE: false,
  MAIL_IMAP_HOST: "mail.sitora.nl",
  MAIL_IMAP_PORT: 993,
  MAIL_IMAP_SECURE: true,
  MAIL_USERNAME: "info@sitora.nl",
  MAIL_PASSWORD: "secret",
  MAIL_BOUNCE_ADDRESS: undefined,
  MAIL_SENT_FOLDER: undefined,
};

describe("Verzonden items-idempotentie", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.search.mockResolvedValue([]);
    client.append.mockResolvedValue({ uid: 42 });
  });

  it("voegt na SMTP precies één kopie toe aan de echte Sent-map", async () => {
    await expect(appendToSentItems(config, Buffer.from("raw"), new Date(), "<mail-1@sitora.nl>"))
      .resolves.toEqual({ folder: "Sent", uid: "42", alreadyPresent: false });
    expect(client.mailboxOpen).toHaveBeenCalledWith("Sent");
    expect(client.search).toHaveBeenCalledWith({ header: { "message-id": "<mail-1@sitora.nl>" } }, { uid: true });
    expect(client.append).toHaveBeenCalledTimes(1);
  });

  it("maakt bij een retry geen tweede Sent Items-kopie met dezelfde Message-ID", async () => {
    client.search.mockResolvedValue([91]);
    await expect(appendToSentItems(config, Buffer.from("raw"), new Date(), "<mail-1@sitora.nl>"))
      .resolves.toEqual({ folder: "Sent", uid: "91", alreadyPresent: true });
    expect(client.append).not.toHaveBeenCalled();
  });
});
