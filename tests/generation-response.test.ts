import { describe, expect, it } from "vitest";
import { generationResponse } from "@/lib/jobs/generation-response";

describe("gestructureerde generatie-API", () => {
  it("geeft alle publieke tellers met stabiele veldnamen terug", () => {
    const run = {
      id: "run-1", status: "PARTIALLY_COMPLETED", targetCount: 50, stored: 7, candidatesChecked: 80,
      websitesFound: 30, permanentlyClosed: 4, temporarilyClosed: 2, duplicates: 9, rejected: 35,
      sourceFailures: 3, consecutiveSourceFailures: 1, progress: 100, stopReason: "7 geldige leads opgeslagen.",
    };
    expect(generationResponse(run)).toEqual(expect.objectContaining({
      success: true, jobId: "run-1", status: "PARTIALLY_COMPLETED", requestedCount: 50, savedCount: 7,
      candidatesChecked: 80, rejectedWithWebsite: 30, rejectedClosed: 6, rejectedDuplicate: 9,
      rejectedInvalid: 5, failedQueries: 3, consecutiveFailedQueries: 1, progress: 100, message: "7 geldige leads opgeslagen.", run,
    }));
  });

  it("geeft een duidelijke lege status zonder ongedefinieerde tellers", () => {
    expect(generationResponse(null)).toEqual(expect.objectContaining({
      success: true, jobId: null, status: null, savedCount: 0, candidatesChecked: 0, failedQueries: 0, progress: 0,
    }));
  });
});
