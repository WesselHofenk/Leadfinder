// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { GenerationButton } from "@/components/generation-button";

const task = { id: "leadfinder-continuous", name: "Leadfinder doorlopend zoeken", enabled: true, status: "RUNNING" };
const run = {
  id: "cmrlz4csu0000l6046xanxs8s", status: "RUNNING", progress: 15, message: "OpenStreetMap wordt geprobeerd.",
  candidatesFound: 4, candidatesChecked: 2, stored: 1, validDrafts: 1, duplicates: 1, rejected: 0, manualReview: 0,
  permanentlyClosed: 0, sourceFailures: 0, pendingCandidates: 2,
  currentPhase: "Openbare bedrijfsvermeldingen ophalen", currentSource: "OPENSTREETMAP", currentRegion: "Amsterdam, NL", batchNumber: 1,
};
const candidateOutcomes = { qualified: 1, rejected: 0, duplicates: 1, retrying: 0, failed: 0, processing: 0, total: 2 };
const leadBuffer = { eligible: 12, target: 150, needsRefill: true, lastSuccessfulLeadAt: "2026-08-19T12:00:00.000Z" };
const activeSnapshot = { task, run, operationalStatus: "SEARCHING", workerHealthy: true, candidateOutcomes, leadBuffer, rejectionReasons: [] };

function json(value: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }));
}

describe("Leadfinder-backendstatus", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("toont de permanente taak exact één keer", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json(activeSnapshot)));
    render(<GenerationButton/>);
    expect(await screen.findByText("Leadfinder doorlopend zoeken")).toBeTruthy();
    expect(screen.getAllByText("Leadfinder doorlopend zoeken")).toHaveLength(1);
    expect(screen.getByText("Nieuwe kandidaten zoeken")).toBeTruthy();
    expect(screen.getByText("2 van 2 gecontroleerde kandidaten hebben een traceerbare uitkomst.")).toBeTruthy();
    expect(screen.getByText("12/150")).toBeTruthy();
  });

  it("pauzeert alleen de singleton en start geen browserbatch", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => init?.method === "DELETE"
      ? json({ ...activeSnapshot, task: { ...task, enabled: false, status: "PAUSED" }, operationalStatus: "PAUSED", workerHealthy: false, message: "Gepauzeerd" })
      : json(activeSnapshot));
    vi.stubGlobal("fetch", fetchMock);
    render(<GenerationButton/>);
    const pauseButton = await screen.findByRole("button", { name: "Pauzeren" });
    await waitFor(() => expect((pauseButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(pauseButton);
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("werkt bij hervatten dezelfde backendtaak bij", async () => {
    const paused = { ...task, enabled: false, status: "PAUSED" };
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
      ? json({ ...activeSnapshot, message: "De Leadfinder is gestart." })
      : json({ ...activeSnapshot, task: paused, operationalStatus: "PAUSED", workerHealthy: false }));
    vi.stubGlobal("fetch", fetchMock);
    render(<GenerationButton/>);
    const resumeButton = await screen.findByRole("button", { name: "Starten / hervatten" });
    await waitFor(() => expect((resumeButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(resumeButton);
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
  });
});
