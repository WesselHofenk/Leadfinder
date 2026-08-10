import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

import { lookup } from "node:dns/promises";
import { safeFetch } from "@/lib/website/analyze";
import { assertPublicUrl } from "@/lib/website/url-safety";

describe("SSRF-veilige websitecontrole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
  });

  it("blokkeert lokale en metadata-adressen vóór een request", async () => {
    await expect(assertPublicUrl("http://127.0.0.1/admin")).rejects.toThrow("Lokale adressen");
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow("Lokale adressen");
  });

  it("blokkeert een openbaar domein dat naar een privéadres resolveert", async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: "10.0.0.4", family: 4 }] as never);
    await expect(assertPublicUrl("https://voorbeeld.nl")).rejects.toThrow("Priv");
  });

  it("controleert iedere redirect opnieuw en bezoekt nooit de interne bestemming", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    }));
    await expect(safeFetch("https://voorbeeld.nl", {}, 1_000, fetchImpl)).rejects.toThrow("Lokale adressen");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
