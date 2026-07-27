import { describe, expect, it } from "vitest";

import {
  nextUnattemptedCursor,
  reserveNextCursor,
  searchSpaceProgress,
  searchStrategySegment,
} from "@/lib/jobs/run-search-state";

const area = { country: "NL", city: "Amsterdam", category: "kapper" };
const otherArea = { country: "NL", city: "Haarlem", category: "schilder" };
const label = (cursor: number) => `strategy-${cursor}`;

function inMemoryCursor(initial = 0) {
  let cursor = initial;
  return {
    load: async () => {
      await Promise.resolve();
      return cursor;
    },
    swap: async (expected: number, next: number) => {
      await Promise.resolve();
      if (cursor !== expected) return false;
      cursor = next;
      return true;
    },
    value: () => cursor,
  };
}

describe("geïsoleerde zoekstatus per generatierun", () => {
  it("reserveert voor twee opeenvolgende runs een nieuwe strategie met een nieuw run-eigen startpunt", async () => {
    const durableCursor = inMemoryCursor();
    const first = await reserveNextCursor({
      area, cursorCount: 6, attemptedSegments: new Set(), cursorLabel: label,
      loadCursor: durableCursor.load, compareAndSwap: durableCursor.swap,
    });
    const second = await reserveNextCursor({
      area, cursorCount: 6, attemptedSegments: new Set(), cursorLabel: label,
      loadCursor: durableCursor.load, compareAndSwap: durableCursor.swap,
    });
    expect(first).toBe(0);
    expect(second).toBe(1);
    expect(searchStrategySegment(area, first!, label)).not.toBe(searchStrategySegment(area, second!, label));
  });

  it("slaat binnen één run reeds uitgevoerde strategieën over", () => {
    const attempted = new Set([
      searchStrategySegment(area, 0, label),
      searchStrategySegment(area, 1, label),
    ]);
    expect(nextUnattemptedCursor({
      area, currentCursor: 0, cursorCount: 6, attemptedSegments: attempted, cursorLabel: label,
    })).toBe(2);
  });

  it("gaat na een lege pagina door met de volgende pagina/strategie", async () => {
    const durableCursor = inMemoryCursor();
    const first = await reserveNextCursor({
      area, cursorCount: 6, attemptedSegments: new Set(), cursorLabel: label,
      loadCursor: durableCursor.load, compareAndSwap: durableCursor.swap,
    });
    // Een leeg resultaat verandert de reservering niet terug.
    const attempted = new Set([searchStrategySegment(area, first!, label)]);
    const next = await reserveNextCursor({
      area, cursorCount: 6, attemptedSegments: attempted, cursorLabel: label,
      loadCursor: durableCursor.load, compareAndSwap: durableCursor.swap,
    });
    expect(next).toBe(1);
  });

  it("laat een tijdelijke bronfout de overige strategieën niet blokkeren", async () => {
    const durableCursor = inMemoryCursor(3);
    const failed = await reserveNextCursor({
      area, cursorCount: 6, attemptedSegments: new Set(), cursorLabel: label,
      loadCursor: durableCursor.load, compareAndSwap: durableCursor.swap,
    });
    const afterFailure = await reserveNextCursor({
      area, cursorCount: 6,
      attemptedSegments: new Set([searchStrategySegment(area, failed!, label)]),
      cursorLabel: label, loadCursor: durableCursor.load, compareAndSwap: durableCursor.swap,
    });
    expect([failed, afterFailure]).toEqual([3, 4]);
  });

  it("initialiseert bezochte segmenten opnieuw per run zonder de duurzame cursor terug te zetten", () => {
    const priorRun = new Set([searchStrategySegment(area, 0, label)]);
    const nextRun = new Set<string>();
    expect(priorRun.size).toBe(1);
    expect(nextRun.size).toBe(0);
    expect(nextUnattemptedCursor({
      area, currentCursor: 1, cursorCount: 6, attemptedSegments: nextRun, cursorLabel: label,
    })).toBe(1);
  });

  it("meldt pas echte uitputting wanneer iedere strategie in de actuele run is uitgevoerd", () => {
    const partial = new Set([searchStrategySegment(area, 0, label)]);
    expect(searchSpaceProgress([area, otherArea], partial, 2)).toEqual({ total: 4, attempted: 1, remaining: 3 });
    const complete = new Set([
      searchStrategySegment(area, 0, label),
      searchStrategySegment(area, 1, label),
      searchStrategySegment(otherArea, 0, label),
      searchStrategySegment(otherArea, 1, label),
    ]);
    expect(searchSpaceProgress([area, otherArea], complete, 2)).toEqual({ total: 4, attempted: 4, remaining: 0 });
    expect(nextUnattemptedCursor({
      area, currentCursor: 0, cursorCount: 2, attemptedSegments: complete, cursorLabel: label,
    })).toBeNull();
  });

  it("reserveert bij gelijktijdige runs met compare-and-swap twee verschillende cursors", async () => {
    const durableCursor = inMemoryCursor();
    const reserve = () => reserveNextCursor({
      area, cursorCount: 6, attemptedSegments: new Set<string>(), cursorLabel: label,
      loadCursor: durableCursor.load, compareAndSwap: durableCursor.swap,
    });
    const cursors = await Promise.all([reserve(), reserve()]);
    expect(new Set(cursors).size).toBe(2);
    expect(cursors.sort()).toEqual([0, 1]);
    expect(durableCursor.value()).toBe(2);
  });
});
