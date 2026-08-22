import { describe, expect, it } from "vitest";
import {
  ACTIVE_GENERATION_POLL_MS,
  HIDDEN_GENERATION_POLL_MS,
  IDLE_GENERATION_POLL_MS,
  MAX_GENERATION_POLL_MS,
  generationPollingDelay,
  generationPollingExpired,
} from "@/lib/jobs/generation-polling";

describe("databasevriendelijke generatiepolling", () => {
  it("pollt actieve tabs hoogstens iedere minuut en in rust iedere vijf minuten", () => {
    expect(generationPollingDelay(false, 0)).toBe(ACTIVE_GENERATION_POLL_MS);
    expect(generationPollingDelay(false, 0, false)).toBe(IDLE_GENERATION_POLL_MS);
  });

  it("vertraagt verborgen tabs en netwerkfouten", () => {
    expect(generationPollingDelay(true, 0)).toBe(HIDDEN_GENERATION_POLL_MS);
    expect(generationPollingDelay(false, 3)).toBe(IDLE_GENERATION_POLL_MS);
    expect(generationPollingDelay(true, 3)).toBe(HIDDEN_GENERATION_POLL_MS);
  });

  it("stopt een vastgelopen run na de maximale looptijd plus marge", () => {
    const now = Date.parse("2026-08-09T12:15:00.000Z");
    expect(generationPollingExpired("2026-08-09T12:00:00.000Z", now - 1_000, now)).toBe(true);
    expect(generationPollingExpired(undefined, now - MAX_GENERATION_POLL_MS + 1, now)).toBe(false);
  });
});
