import { describe, expect, it } from "vitest";
import { isStaleGenerationRun, isTerminalGenerationStatus, phaseProgress } from "@/lib/jobs/generation-state";

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

  it.each(["COMPLETE", "FAILED", "CANCELLED", "TIMED_OUT"])("behandelt %s als eindstatus", (status) => {
    expect(isTerminalGenerationStatus(status)).toBe(true);
  });

  it("laat een running job hervatbaar", () => expect(isTerminalGenerationStatus("RUNNING")).toBe(false));
});
