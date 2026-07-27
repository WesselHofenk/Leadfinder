import { describe, expect, it } from "vitest";

import { qualifiedBatchState, successfulQualifiedBatch } from "@/lib/leads/qualified-batch";

describe("atomaire gekwalificeerde leadbatch", () => {
  it("publiceert alleen exact de volledige doelbatch", () => {
    expect(qualifiedBatchState(9, 10)).toBe("INCOMPLETE");
    expect(qualifiedBatchState(10, 10)).toBe("READY");
    expect(qualifiedBatchState(11, 10)).toBe("OVERFLOW");
    expect(successfulQualifiedBatch(9, 10)).toBe(false);
    expect(successfulQualifiedBatch(10, 10)).toBe(true);
    expect(successfulQualifiedBatch(11, 10)).toBe(false);
  });

  it("weigert ongeldige aantallen", () => {
    expect(() => qualifiedBatchState(-1, 10)).toThrow("Ongeldige batchgrootte");
    expect(() => qualifiedBatchState(10.5, 10)).toThrow("Ongeldige batchgrootte");
  });
});
