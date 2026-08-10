/** Hard safety boundary for every new and resumed lead-generation run. */
export const MAX_CANDIDATES_PER_RUN = 200;

/** Keep expensive candidate validation small enough for free public sources. */
export const MAX_CANDIDATES_PER_BATCH = 10;

/** Stop starting new discovery calls shortly before the total run deadline. */
export const RUN_DRAIN_WINDOW_MS = 90_000;
