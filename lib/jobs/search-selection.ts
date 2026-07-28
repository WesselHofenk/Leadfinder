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
  candidatesChecked?: number;
  validLeads: number;
  errorCount: number;
  averageDurationMs?: number;
  lastUsedAt: Date | null;
  lastSuccessAt?: Date | null;
  nextEligibleAt: Date;
};

export type AdaptiveSearchMode = "exploit" | "explore";

const key = (value: Pick<SearchAreaCandidate, "country" | "city" | "category">) =>
  `${value.country}:${value.city}:${value.category}`;

export function preferUnusedCities<T extends SearchAreaCandidate>(areas: T[], usedCityKeys: ReadonlySet<string>): T[] {
  const unused = areas.filter((area) => !usedCityKeys.has(`${area.country}:${area.city}`));
  return unused.length ? unused : areas;
}

export function adaptiveSearchMode(sequence: number): AdaptiveSearchMode {
  // Retry candidates consume their own bounded ~10% quota in generation-state.
  // The remaining fresh-source work is split 70/20 between proven yield and
  // exploration; the final slot rotates the least-used combination.
  return Math.abs(sequence) % 10 < 7 ? "exploit" : "explore";
}

function ageHours(value: Date | null, now: Date) {
  return value ? Math.max(0, now.getTime() - value.getTime()) / 3_600_000 : 10_000;
}

const highOpportunityCities = new Set([
  "amsterdam", "rotterdam", "den haag", "utrecht", "eindhoven", "groningen",
  "tilburg", "almere", "breda", "nijmegen", "arnhem", "enschede", "haarlem",
  "den bosch", "antwerpen", "brugge", "leuven", "mechelen", "hasselt", "kortrijk",
]);

function cityOpportunityBoost(city: string) {
  return highOpportunityCities.has(city.toLowerCase().trim()) ? 600 : 0;
}

export function selectAdaptiveSearchArea(input: {
  areas: SearchAreaCandidate[];
  categories: SearchCategorySetting[];
  combinations: SearchCombinationMetric[];
  sequence: number;
  now?: Date;
  ignoreCooldowns?: boolean;
}) {
  const now = input.now ?? new Date();
  const categories = new Map(input.categories.map((category) => [category.name, category.priority]));
  const metrics = new Map(input.combinations.map((combination) => [key(combination), combination]));
  const eligible = input.areas.filter((area) => {
    const categoryPriority = categories.get(area.category);
    const combination = metrics.get(key(area));
    return categoryPriority !== undefined
      && (input.ignoreCooldowns
        || (area.nextScanAt <= now && (!combination || combination.nextEligibleAt <= now)));
  });
  if (!eligible.length) return null;

  const mode = adaptiveSearchMode(input.sequence);
  const score = (area: SearchAreaCandidate) => {
    const metric = metrics.get(key(area));
    const categoryPriority = categories.get(area.category) ?? 100;
    const categoryPriorityPenalty = Math.max(0, categoryPriority) * 5;
    const recency = ageHours(metric?.lastUsedAt ?? area.lastScannedAt, now);
    const useCount = metric?.useCount ?? 0;
    const validLeads = metric?.validLeads ?? 0;
    const checkedCandidates = metric?.candidatesChecked ?? metric?.candidatesFound ?? useCount;
    const qualifiedLeadsPerRun = validLeads / Math.max(1, useCount);
    const qualificationRate = validLeads / Math.max(1, checkedCandidates);
    const candidateYield = (metric?.candidatesFound ?? 0) / Math.max(1, useCount);
    const reliability = useCount / Math.max(1, useCount + (metric?.errorCount ?? 0));
    const latencyPenalty = Math.min(300, (metric?.averageDurationMs ?? 15_000) / 100);
    const recentSuccessBoost = metric?.lastSuccessAt && ageHours(metric.lastSuccessAt, now) <= 24 ? 350 : 0;
    const zeroQualifiedPenalty = validLeads === 0 && checkedCandidates >= 20
      ? 1_500 + Math.min(1_000, checkedCandidates * 5)
      : 0;
    const reliabilityPenalty = (metric?.errorCount ?? 0) * 6;
    // Values 1-5 are deliberate operator overrides rather than ordinary
    // ranking hints. They must also beat the exploration bonus for an unused
    // combination; otherwise setting both Amsterdam and `kapper` to priority
    // 1 can still select an unrelated unused category.
    const explicitPriorityBoost = (categoryPriority <= 5 ? 16_000 : 0) + (area.priority <= 5 ? 16_000 : 0);
    // Coverage priority is an explicit admin control. Previously it was only
    // consulted as a final sort tie-breaker, so changing 100 to 1 could still
    // have no practical effect. Give it enough weight to steer the search
    // while historical yield and circuit-health signals remain relevant.
    const coveragePriorityPenalty = Math.max(0, area.priority) * 5;
    const productiveScore = qualifiedLeadsPerRun * 6_000 + qualificationRate * 2_000
      + Math.min(750, candidateYield * 8)
      + reliability * 500 + recentSuccessBoost + cityOpportunityBoost(area.city) - latencyPenalty;
    if (mode === "exploit") {
      return explicitPriorityBoost + productiveScore + Math.min(168, recency)
        - categoryPriorityPenalty - coveragePriorityPenalty - zeroQualifiedPenalty - reliabilityPenalty;
    }
    return explicitPriorityBoost + productiveScore + (useCount === 0 ? 1_000 : 0)
      + Math.min(720, recency) - useCount * 20
      - categoryPriorityPenalty - coveragePriorityPenalty - reliabilityPenalty;
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
