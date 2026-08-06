import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveMx } = vi.hoisted(() => ({ resolveMx: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("node:dns/promises", () => ({ resolveMx }));

import {
  assertRecipientDomainCanReceiveMail,
  UndeliverableRecipientDomainError,
} from "@/lib/email/recipient-validation";

describe("controle van ontvangende e-maildomeinen", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepteert een domein met een echte MX-server", async () => {
    resolveMx.mockResolvedValue([{ exchange: "mx.example.nl", priority: 10 }]);
    await expect(assertRecipientDomainCanReceiveMail("info@example.nl")).resolves.toBeUndefined();
  });

  it("blokkeert een niet-bestaand domein voor verzending", async () => {
    resolveMx.mockRejectedValue(Object.assign(new Error("not found"), { code: "ENOTFOUND" }));
    await expect(assertRecipientDomainCanReceiveMail("info@bestaat-niet.invalid"))
      .rejects.toBeInstanceOf(UndeliverableRecipientDomainError);
  });

  it("blokkeert een domein dat expliciet geen e-mail accepteert", async () => {
    resolveMx.mockResolvedValue([{ exchange: ".", priority: 0 }]);
    await expect(assertRecipientDomainCanReceiveMail("info@example.nl"))
      .rejects.toBeInstanceOf(UndeliverableRecipientDomainError);
  });
});
