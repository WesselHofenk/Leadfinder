import { describe, expect, it } from "vitest";
import { candidateReservationLimit, candidateRetryStatus, generationCompletionStatus, generationProgress, generationRetryImportLimit, isBatchDeadlineNear, isGenerationRunExpired, isStaleGenerationRun, isTerminalGenerationStatus, phaseProgress, sourceAttemptDelta, sourceFailureWarningDue } from "@/lib/jobs/generation-state";

describe("persistente generatiejobstatus", () => {
  it("toont al tijdens voorbereiding zichtbare voortgang", () => {
    expect(phaseProgress("queued")).toBe(5);
    expect(phaseProgress("source")).toBe(30);
    expect(phaseProgress("candidates")).toBe(50);
    expect(phaseProgress("done")).toBe(100);
  });

  it("markeert alleen een werkelijk oude heartbeat als vastgelopen", () => {
    const now = new Date("2026-07-15T12:00:00Z");
    expect(isStaleGenerationRun(new Date("2026-07-15T11:58:59Z"), now, 60)).toBe(true);
    expect(isStaleGenerationRun(new Date("2026-07-15T11:59:30Z"), now, 60)).toBe(false);
  });

  it.each(["COMPLETE", "PARTIALLY_COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"])("behandelt %s als eindstatus", (status) => {
    expect(isTerminalGenerationStatus(status)).toBe(true);
  });

  it("laat een running job hervatbaar", () => expect(isTerminalGenerationStatus("RUNNING")).toBe(false));

  it("pauzeert een batch vóór de serverless deadline zonder de job te beëindigen", () => {
    expect(isBatchDeadlineNear(45_000, 40_000, 6_000)).toBe(true);
    expect(isBatchDeadlineNear(45_000, 30_000, 6_000)).toBe(false);
  });

  it("onderscheidt doel bereikt, gedeeltelijk resultaat en doorgaan", () => {
    expect(generationCompletionStatus({ usable: 50, target: 50, processedSegments: 3, maxSegments: 40, pendingCandidates: 4 })).toBe("COMPLETE");
    expect(generationCompletionStatus({ usable: 56, target: 50, processedSegments: 3, maxSegments: 40, pendingCandidates: 4 })).toBe("COMPLETE");
    expect(generationCompletionStatus({ usable: 18, target: 50, processedSegments: 40, maxSegments: 40, pendingCandidates: 0 })).toBe("PARTIALLY_COMPLETED");
    expect(generationCompletionStatus({ usable: 18, target: 50, processedSegments: 40, maxSegments: 40, pendingCandidates: 2 })).toBeNull();
    expect(generationCompletionStatus({ usable: 0, target: 50, processedSegments: 40, maxSegments: 40, pendingCandidates: 0 })).toBe("FAILED");
  });

  it("telt alleen een werkelijk ontvangen bronresponse als doorzocht segment", () => {
    expect(sourceAttemptDelta(true)).toEqual({ processedSegments: 1, sourceFailures: 0 });
    expect(sourceAttemptDelta(false)).toEqual({ processedSegments: 0, sourceFailures: 1 });
  });

  it("begrensd ook een run waarin alle bronsegmenten falen", () => {
    expect(generationCompletionStatus({ usable: 0, target: 50, processedSegments: 2, sourceFailures: 10, maxSegments: 12, pendingCandidates: 0 })).toBe("FAILED");
    expect(generationCompletionStatus({ usable: 4, target: 50, processedSegments: 2, sourceFailures: 10, maxSegments: 12, pendingCandidates: 0 })).toBe("PARTIALLY_COMPLETED");
  });

  it("beweegt zichtbaar voorbij 5% na een echte maar mislukte bronpoging", () => {
    expect(generationProgress({ stored: 0, sourceFailures: 1, target: 50, processedSegments: 0, maxSegments: 1000 })).toBeGreaterThan(phaseProgress("source"));
    expect(generationProgress({ stored: 0, sourceFailures: 2, target: 50, processedSegments: 0, maxSegments: 1000 }))
      .toBeGreaterThan(generationProgress({ stored: 0, sourceFailures: 1, target: 50, processedSegments: 0, maxSegments: 1000 }));
    expect(generationProgress({ stored: 10, sourceFailures: 1, target: 50, processedSegments: 0, maxSegments: 1000 })).toBeGreaterThan(phaseProgress("source"));
  });

  it("telt echte kandidaatcontroles mee zonder ooit 100% te tonen vóór een eindstatus", () => {
    const progress = generationProgress({ stored: 5, candidatesChecked: 30, sourceFailures: 2, target: 50, processedSegments: 6, maxSegments: 1000 });
    expect(progress).toBeGreaterThan(25);
    expect(progress).toBeLessThanOrEqual(94);
  });

  it("stopt een run op de echte totale looptijd", () => {
    const now = new Date("2026-07-15T12:15:00Z");
    expect(isGenerationRunExpired(new Date("2026-07-15T12:00:00Z"), 15, now)).toBe(true);
    expect(isGenerationRunExpired(new Date("2026-07-15T12:00:01Z"), 15, now)).toBe(false);
  });

  it("geeft bij langdurige bronuitval alleen periodiek een waarschuwing en geen stopbesluit", () => {
    expect(sourceFailureWarningDue(11, 12)).toBe(false);
    expect(sourceFailureWarningDue(12, 12)).toBe(true);
    expect(sourceFailureWarningDue(24, 12)).toBe(true);
  });

  it("zet een tijdelijke database- of netwerkfout terug in de queue en begrenst retries", () => {
    expect(candidateRetryStatus(1)).toBe("PENDING");
    expect(candidateRetryStatus(2)).toBe("PENDING");
    expect(candidateRetryStatus(3)).toBe("FAILED");
  });

  it("laat de retryqueue nooit een hele nieuwe run opslokken", () => {
    expect(generationRetryImportLimit(8, 0)).toBe(2);
    expect(generationRetryImportLimit(8, 1)).toBe(1);
    expect(generationRetryImportLimit(8, 2)).toBe(0);
  });

  it("reserveert nooit meer dan 1.000 unieke kandidaten", () => {
    expect(candidateReservationLimit(1000, 990, 50)).toBe(10);
    expect(candidateReservationLimit(1000, 1000, 50)).toBe(0);
    expect(candidateReservationLimit(1000, 400, 25)).toBe(25);
  });
});
