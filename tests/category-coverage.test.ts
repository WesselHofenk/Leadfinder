import { describe, expect, it, vi } from "vitest";

import { ensureCategoryCoverage } from "@/lib/jobs/category-coverage";

describe("zoekdekking voor toegevoegde branches", () => {
  it("maakt ieder bestaand plaatscentrum eenmaal beschikbaar en behoudt de hoogste beheerprioriteit", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { country: "NL", region: "Noord-Holland", municipality: null, city: "Amsterdam", latitude: 52.37, longitude: 4.89, radius: 12_000, priority: 100 },
      { country: "NL", region: "Noord-Holland", municipality: null, city: "Amsterdam", latitude: 52.37, longitude: 4.89, radius: 12_000, priority: 1 },
      { country: "NL", region: "Zuid-Holland", municipality: null, city: "Rotterdam", latitude: 51.92, longitude: 4.48, radius: 12_000, priority: 100 },
    ]);
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const tx = { coverageArea: { findMany, createMany } };
    const now = new Date("2026-07-24T12:00:00Z");

    await expect(ensureCategoryCoverage(tx as never, "slagerij", now)).resolves.toBe(2);
    expect(createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ city: "Amsterdam", category: "slagerij", priority: 1, status: "PENDING", nextScanAt: now }),
        expect.objectContaining({ city: "Rotterdam", category: "slagerij", priority: 100, status: "PENDING", nextScanAt: now }),
      ]),
      skipDuplicates: true,
    });
  });
});
