export type SearchAreaCandidate = {
  id: string;
  country: string;
  region: string;
  municipality: string | null;
  city: string;
  category: string;
  latitude: unknown;
  longitude: unknown;
  radius: number;
  priority: number;
  lastScannedAt: Date | null;
  nextScanAt: Date;
};

export type SearchCategorySetting = { name: string; priority: number };

export type SearchCombinationMetric = {
  country: string;
  city: string;
  category: string;
  useCount: number;
  candidatesFound: number;
  validLeads: number;
  errorCount: number;
  lastUsedAt: Date | null;
  nextEligibleAt: Date;
};

export type AdaptiveSearchMode = "exploit" | "explore";

const key = (value: Pick<SearchAreaCandidate, "country" | "city" | "category">) =>
  `${value.country}:${value.city}:${value.category}`;

export function adaptiveSearchMode(sequence: number): AdaptiveSearchMode {
  // Retry candidates consume their own bounded ~10% quota in generation-state.
  // The remaining fresh-source work is split 70/20 between proven yield and
  // exploration; the final slot rotates the least-used combination.
  return Math.abs(sequence) % 10 < 7 ? "exploit" : "explore";
}

function ageHours(value: Date | null, now: Date) {
  return value ? Math.max(0, now.getTime() - value.getTime()) / 3_600_000 : 10_000;
}

export function selectAdaptiveSearchArea(input: {
  areas: SearchAreaCandidate[];
  categories: SearchCategorySetting[];
  combinations: SearchCombinationMetric[];
  sequence: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const categories = new Map(input.categories.map((category) => [category.name, category.priority]));
  const metrics = new Map(input.combinations.map((combination) => [key(combination), combination]));
  const eligible = input.areas.filter((area) => {
    const categoryPriority = categories.get(area.category);
    const combination = metrics.get(key(area));
    return categoryPriority !== undefined
      && area.nextScanAt <= now
      && (!combination || combination.nextEligibleAt <= now);
  });
  if (!eligible.length) return null;

  const mode = adaptiveSearchMode(input.sequence);
  const score = (area: SearchAreaCandidate) => {
    const metric = metrics.get(key(area));
    const categoryPriority = categories.get(area.category) ?? 100;
    const recency = ageHours(metric?.lastUsedAt ?? area.lastScannedAt, now);
    const useCount = metric?.useCount ?? 0;
    const validLeads = metric?.validLeads ?? 0;
    const yieldRate = validLeads / Math.max(1, useCount);
    const zeroYieldPenalty = useCount >= 3 && validLeads === 0 ? Math.min(240, useCount * 20) : 0;
    const reliabilityPenalty = (metric?.errorCount ?? 0) * 6;
    if (mode === "exploit") {
      return yieldRate * 1_000 + Math.min(168, recency) - categoryPriority - zeroYieldPenalty - reliabilityPenalty;
    }
    return (useCount === 0 ? 10_000 : 0) + Math.min(720, recency) * 5 - useCount * 40 - categoryPriority - reliabilityPenalty;
  };

  return eligible.slice().sort((left, right) =>
    score(right) - score(left)
    || left.priority - right.priority
    || left.city.localeCompare(right.city)
    || left.category.localeCompare(right.category),
  )[0];
}

export function lowYieldCooldownMs(useCount: number, validLeads: number) {
  if (validLeads > 0 || useCount < 3) return 10 * 60_000;
  return Math.min(6 * 60 * 60_000, 15 * 60_000 * (2 ** Math.min(4, useCount - 3)));
}
