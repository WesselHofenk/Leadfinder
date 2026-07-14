export const isRetryableStatus = (status: number) => [429, 500, 502, 503, 504].includes(status);
export const backoffDelayMs = (attempt: number, jitter = 0) => Math.min(8_000, 500 * 2 ** attempt + jitter);
