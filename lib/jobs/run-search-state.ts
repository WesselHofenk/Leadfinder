export type SearchStrategyArea = {
  country: string;
  city: string;
  category: string;
};

export function searchStrategySegment(
  area: SearchStrategyArea,
  cursor: number,
  cursorLabel: (cursor: number) => string,
) {
  return `${area.country}:${area.city}:${area.category}:${cursorLabel(cursor)}`;
}

export function nextUnattemptedCursor(input: {
  area: SearchStrategyArea;
  currentCursor: number;
  cursorCount: number;
  attemptedSegments: ReadonlySet<string>;
  cursorLabel: (cursor: number) => string;
}) {
  const cursorCount = Math.max(1, input.cursorCount);
  const start = ((input.currentCursor % cursorCount) + cursorCount) % cursorCount;
  for (let offset = 0; offset < cursorCount; offset += 1) {
    const cursor = (start + offset) % cursorCount;
    if (!input.attemptedSegments.has(searchStrategySegment(input.area, cursor, input.cursorLabel))) return cursor;
  }
  return null;
}

export function searchSpaceProgress(
  areas: SearchStrategyArea[],
  attemptedSegments: ReadonlySet<string>,
  cursorCount: number,
) {
  const prefixes = new Set(areas.map((area) => `${area.country}:${area.city}:${area.category}:`));
  const attempted = [...attemptedSegments].filter((segment) => {
    const separator = segment.lastIndexOf(":");
    return separator >= 0 && prefixes.has(segment.slice(0, separator + 1));
  }).length;
  const total = areas.length * Math.max(1, cursorCount);
  return { total, attempted: Math.min(total, attempted), remaining: Math.max(0, total - attempted) };
}

export async function reserveNextCursor(input: {
  area: SearchStrategyArea;
  cursorCount: number;
  attemptedSegments: ReadonlySet<string>;
  cursorLabel: (cursor: number) => string;
  loadCursor: () => Promise<number>;
  compareAndSwap: (currentCursor: number, nextCursor: number) => Promise<boolean>;
  maxConflicts?: number;
}) {
  const maxConflicts = Math.max(1, input.maxConflicts ?? 12);
  for (let conflict = 0; conflict < maxConflicts; conflict += 1) {
    const currentCursor = await input.loadCursor();
    const cursor = nextUnattemptedCursor({ ...input, currentCursor });
    if (cursor === null) return null;
    const nextCursor = (cursor + 1) % Math.max(1, input.cursorCount);
    if (await input.compareAndSwap(currentCursor, nextCursor)) return cursor;
  }
  throw new Error("De zoekcursor kon door gelijktijdige runs niet veilig worden gereserveerd.");
}
