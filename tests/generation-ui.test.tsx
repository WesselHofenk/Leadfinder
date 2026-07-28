// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { GenerationButton } from "@/components/generation-button";

const runId = "cmrlz4csu0000l6046xanxs8s";
const baseRun = {
  id: runId, status: "RUNNING", targetCount: 10, progress: 15, message: "OpenStreetMap wordt geprobeerd.",
  candidatesFound: 0, candidatesChecked: 0, stored: 0, validDrafts: 0, withoutWebsite: 0, manualReview: 0, retryQueueCount: 0, duplicates: 0, existingLeads: 0,
  rejected: 0, websitesChecked: 0, permanentlyClosed: 0, temporarilyClosed: 0, sourceFailures: 0, exhausted: false,
  websitesFound: 0, pendingCandidates: 0, retriedCandidates: 0, batchNumber: 1,
  apiErrors: [], warnings: [], currentPhase: "Openbare bedrijfsvermeldingen ophalen", currentSource: "OPENSTREETMAP",
  currentRegion: "Amsterdam, NL", currentTile: "t0", updatedAt: new Date().toISOString(),
};

function json(value: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }));
}

describe("frontend polling en eindstatus", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("toont voortgang en een eerlijke gedeeltelijk-afgeronde eindstatus", async () => {
    let getCalls = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") return json({ run: { ...baseRun, status: "PENDING", progress: 2 } }, 202);
      if (method === "PATCH") return json({ run: baseRun });
      getCalls += 1;
      if (getCalls === 1) return json({ run: null });
      if (getCalls <= 3) return json({ run: baseRun });
      return json({ run: { ...baseRun, status: "PARTIALLY_COMPLETED", progress: 100, stored: 7, retryQueueCount: 12, stopReason: "De zoekrun van 10 minuten is afgerond. 7 volledig gekwalificeerde leads zijn opgeslagen in de pipeline. 12 onzekere kandidaten blijven bewaard voor een volgende run." } });
    }));
    render(<GenerationButton/>);
    const start = await screen.findByRole("button", { name: "Nieuwe leads genereren" });
    fireEvent.click(start);
    const progress = await screen.findByRole("region", { name: "Voortgang leadgeneratie" });
    await waitFor(() => expect(progress.textContent).toContain("15%"));
    expect(progress.textContent).toContain("Gesloten verwijderd");
    expect(progress.textContent).toContain("Mislukte zoekbatches");
    expect(progress.textContent).toContain("Logische zoeksegmenten");
    expect(progress.textContent).toContain("Endpointpogingen");
    expect(progress.textContent).toContain("Geldige lege responses");
    expect(progress.textContent).toContain("Technische bronfouten");
    expect(progress.textContent).toContain("Verstreken tijd");
    expect(progress.textContent).toContain("resterende tijd");
    const result = await screen.findByRole("status", {}, { timeout: 3_500 });
    expect(result.textContent).toContain("7 volledig gekwalificeerde leads zijn opgeslagen");
    expect(result.textContent).toContain("12 onzekere kandidaten");
    expect(result.className).toBe("success-message");
    await waitFor(() => expect((screen.getByRole("button", { name: "Opnieuw genereren" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("annuleert het frontendbatchrequest en herstelt de knop direct", async () => {
    let getCalls = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") return json({ run: { ...baseRun, status: "PENDING", progress: 2 } }, 202);
      if (method === "PATCH") return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
      if (method === "DELETE") return json({ run: { ...baseRun, status: "CANCELLED", progress: 100, stopReason: "De zoekrun is door de gebruiker geannuleerd." } });
      getCalls += 1;
      return json({ run: getCalls === 1 ? null : baseRun });
    }));
    render(<GenerationButton/>);
    fireEvent.click(await screen.findByRole("button", { name: "Nieuwe leads genereren" }));
    fireEvent.click(await screen.findByRole("button", { name: "Zoekrun annuleren" }));
    expect(await screen.findByText("De zoekrun is door de gebruiker geannuleerd.")).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("button", { name: "Opnieuw genereren" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("telt onzekere kandidaten niet op bij nieuw bewaard", async () => {
    let getCalls = 0;
    const honestRun = { ...baseRun, stored: 2, validDrafts: 3, manualReview: 5, retryQueueCount: 5 };
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") return json({ run: { ...baseRun, status: "PENDING", progress: 2 } }, 202);
      if (method === "PATCH") return json({ run: honestRun });
      getCalls += 1;
      return json({ run: getCalls === 1 ? null : honestRun });
    }));
    render(<GenerationButton/>);
    fireEvent.click(await screen.findByRole("button", { name: "Nieuwe leads genereren" }));
    expect(await screen.findByText("Kandidaten in retryqueue")).toBeTruthy();
    expect(await screen.findByText("Geldige concepten")).toBeTruthy();
    expect(await screen.findByText("Definitief opgeslagen leads")).toBeTruthy();
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    expect(screen.queryByText("7/10")).toBeNull();
  });

  it("toont een begrijpelijke stopreden in plaats van de technische Overpass-fout", async () => {
    const failed = {
      ...baseRun, status: "FAILED", progress: 100,
      stopReason: "Geen nieuwe geldige leads gevonden. Probeer de zoekrun later opnieuw.",
      apiErrors: ["OPENSTREETMAP / Breda, NL / dakdekker: totale timeout van 28 seconden"],
    };
    vi.stubGlobal("fetch", vi.fn(() => json({ run: failed })));
    render(<GenerationButton/>);
    expect(await screen.findByText(failed.stopReason)).toBeTruthy();
    expect(screen.queryByText(failed.apiErrors[0])).toBeNull();
  });

  it("legt een volledige run zonder geschikte lead uit op basis van 200 controles", async () => {
    const completed = {
      ...baseRun, status: "COMPLETE", progress: 100, maxCandidates: 200, candidatesChecked: 200,
      retryQueueCount: 4,
      stopReason: "De zoekrun van 10 minuten is afgerond. 0 volledig gekwalificeerde leads zijn opgeslagen in de pipeline. 4 onzekere kandidaten blijven bewaard voor een volgende run.",
    };
    vi.stubGlobal("fetch", vi.fn(() => json({ run: completed })));
    render(<GenerationButton/>);
    const message = await screen.findByRole("status");
    expect(message.className).toBe("success-message");
    expect(message.textContent).toContain("0 volledig gekwalificeerde leads");
    expect(message.textContent).toContain("4 onzekere kandidaten");
    expect(message.textContent).not.toContain("doel van 10");
  });

  it("toont de werkelijke maximale verwerkingstijd als waarschuwing en niet als rode fout", async () => {
    const timedOut = {
      ...baseRun,
      status: "TIMED_OUT",
      progress: 100,
      stored: 3,
      manualReview: 4,
      pendingCandidates: 2,
      stopReason: "De zachte afsluitgrens is bereikt. Resultaten: ruw gevonden 46; gecontroleerd 27; opgeslagen 3/50.",
    };
    vi.stubGlobal("fetch", vi.fn(() => json({ run: timedOut })));
    render(<GenerationButton/>);
    const message = await screen.findByRole("status");
    expect(message.className).toBe("warning-message");
    expect(message.textContent).toContain("De maximale verwerkingstijd is bereikt");
    expect(message.textContent).toContain("3 gekwalificeerde concepten blijven veilig bewaard");
    expect(message.textContent).not.toContain("Resultaten:");
  });
});
