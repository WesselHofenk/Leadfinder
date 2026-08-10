import { describe, expect, it } from "vitest";
import { candidateRetryStatus, generationCompletionStatus, isBatchDeadlineNear, isGenerationRunExpired, isReviewRetryReason, isStaleGenerationRun, isTerminalGenerationStatus, phaseProgress, shouldFetchFreshSource, shouldStopForSourceFailures, sourceAttemptDelta, terminalStatusForStoredLeads, unwrapGenerationCandidatePayload } from "@/lib/jobs/generation-state";

describe("persistente generatiejobstatus", () => {
  it("toont al tijdens voorbereiding zichtbare voortgang", () => {
    expect(phaseProgress("queued")).toBe(2);
    expect(phaseProgress("source")).toBe(15);
    expect(phaseProgress("candidates")).toBe(45);
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
    expect(generationCompletionStatus({ usable: 0, target: 50, processedSegments: 40, maxSegments: 40, pendingCandidates: 0 })).toBe("COMPLETE");
  });

  it("telt alleen een werkelijk ontvangen bronresponse als doorzocht segment", () => {
    expect(sourceAttemptDelta(true)).toEqual({ processedSegments: 1, sourceFailures: 0 });
    expect(sourceAttemptDelta(false)).toEqual({ processedSegments: 0, sourceFailures: 1 });
  });

  it("laat oude retrykandidaten nooit verse zoekgebieden blokkeren", () => {
    expect(shouldFetchFreshSource({ queuedCount: 0, queuedOnlyRetries: false, batchNumber: 1 })).toBe(true);
    expect(shouldFetchFreshSource({ queuedCount: 8, queuedOnlyRetries: true, batchNumber: 3 })).toBe(true);
    expect(shouldFetchFreshSource({ queuedCount: 8, queuedOnlyRetries: true, batchNumber: 4 })).toBe(false);
    expect(shouldFetchFreshSource({ queuedCount: 8, queuedOnlyRetries: false, batchNumber: 3 })).toBe(false);
  });

  it("heeft geen totale looptijdlimiet", () => {
    const now = new Date("2026-07-15T12:10:00Z");
    const startedAt = new Date("2026-07-15T12:00:00Z");
    expect(isGenerationRunExpired(startedAt, 10, now)).toBe(false);
    expect(isGenerationRunExpired(new Date("2026-07-15T12:00:00.001Z"), 10, now)).toBe(false);
  });

  it.each([1, 3, 7, 10])("geeft bij %i opgeslagen leads een gedeeltelijk-voltooide eindstatus", (stored) => {
    expect(terminalStatusForStoredLeads(stored)).toBe("PARTIALLY_COMPLETED");
  });

  it("eindigt zonder geldige resultaten correct als COMPLETE", () => {
    expect(terminalStatusForStoredLeads(0)).toBe("COMPLETE");
  });

  it("meldt langdurige bronuitval apart en nooit als uitgeputte zoekruimte", () => {
    expect(shouldStopForSourceFailures({ sourceFailures: 12, processedSegments: 0, maxFailures: 12 })).toBe(true);
    expect(shouldStopForSourceFailures({ sourceFailures: 12, processedSegments: 30, maxFailures: 12 })).toBe(false);
  });

  it("zet een tijdelijke database- of netwerkfout terug in de queue en begrenst retries", () => {
    expect(candidateRetryStatus(1)).toBe("PENDING");
    expect(candidateRetryStatus(2)).toBe("PENDING");
    expect(candidateRetryStatus(3)).toBe("FAILED");
  });

  it("scheidt onzekere controles van definitieve afwijzingen", () => {
    expect(isReviewRetryReason("SKIPPED_WEBSITE_UNKNOWN")).toBe(true);
    expect(isReviewRetryReason("website_check_failed")).toBe(true);
    expect(isReviewRetryReason("email_validation_unavailable")).toBe(true);
    expect(isReviewRetryReason("email_domain_unreachable")).toBe(false);
    expect(isReviewRetryReason("SKIPPED_HAS_WEBSITE")).toBe(false);
  });

  it("leest zowel nieuwe als oudere geneste kandidaatpayloads", () => {
    const candidate = { externalPlaceId: "osm-1", companyName: "Voorbeeld" };
    expect(unwrapGenerationCandidatePayload(candidate, "osm-1")).toBe(candidate);
    expect(unwrapGenerationCandidatePayload({ candidate, verification: {} }, "osm-1")).toBe(candidate);
    expect(() => unwrapGenerationCandidatePayload({ candidate }, "osm-2")).toThrow("Ongeldige kandidaatpayload");
  });
});
