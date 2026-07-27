export type QualifiedBatchState = "INCOMPLETE" | "READY" | "OVERFLOW";

export function qualifiedBatchState(count: number, target = 10): QualifiedBatchState {
  if (!Number.isInteger(count) || !Number.isInteger(target) || count < 0 || target < 1) {
    throw new Error("Ongeldige batchgrootte");
  }
  if (count < target) return "INCOMPLETE";
  if (count === target) return "READY";
  return "OVERFLOW";
}

export function successfulQualifiedBatch(count: number, target = 10) {
  return qualifiedBatchState(count, target) === "READY";
}
