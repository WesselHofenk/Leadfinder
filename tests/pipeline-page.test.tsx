
// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pipelineStages } from "@/lib/leads/pipeline";

const { stageFindMany, findMany, count, transaction } = vi.hoisted(() => ({
  stageFindMany: vi.fn(async () => [
    ["pipeline-nieuw","nieuw","Nieuw",1],["pipeline-belletje-1","belletje-1","Belletje 1",2],
    ["pipeline-belletje-2","belletje-2","Belletje 2",3],["pipeline-gemaild","gemaild","Gemaild",4],
    ["pipeline-geen-interesse","geen-interesse","Geen interesse",5],["pipeline-klant","klant","Klant",6],
  ].map(([id,slug,name,position])=>({id,slug,name,position,isActive:true}))),
  findMany: vi.fn(async ({ where }) => [{ id: `lead-${where.pipelineStageId}`, companyName: `Lead ${where.pipelineStageId}`, category: "bedrijf", city: "Utrecht", opportunityScore: 80, websiteConfidence: 90 }]),
  count: vi.fn(async () => 1),
  transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { pipelineStage: { findMany: stageFindMany }, lead: { findMany, count }, $transaction: transaction } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import PipelinePage from "@/app/(app)/pipeline/page";

describe("pipelineweergave", () => {
  afterEach(() => cleanup());

  it("toont zes kolommen maar biedt Gemaild alleen bij reeds gemailde leads aan", async () => {
    const view = render(await PipelinePage());
    expect([...view.container.querySelectorAll(".pipeline-title strong")].map((node) => node.textContent)).toEqual(pipelineStages.map(({ label }) => label));
    const dropdowns = [...view.container.querySelectorAll<HTMLSelectElement>('select[aria-label="Pipelinefase"]')];
    expect(dropdowns).toHaveLength(6);
    for (const dropdown of dropdowns) {
      const labels = [...dropdown.options].map((option) => option.text);
      if (dropdown.value === "gemaild") expect(labels).toEqual(pipelineStages.map(({ label }) => label));
      else expect(labels).toEqual(pipelineStages.filter(({ slug }) => slug !== "gemaild").map(({ label }) => label));
    }
    expect(view.container.querySelectorAll(".pipeline-column")).toHaveLength(6);
    expect([...view.container.querySelectorAll(".pipeline-title .badge")].map((node) => node.textContent)).toEqual(["1","1","1","1","1","1"]);
    expect([...view.container.querySelectorAll(".pipeline-title strong")].at(-1)?.textContent).toBe("Klant");
    expect(view.getByText("6 vaste fases uit PostgreSQL. Iedere wijziging wordt als activiteit opgeslagen.")).toBeTruthy();
    expect(view.getByRole("region", { name: "Pipeline met 6 horizontaal scrollbare fases" })).toBeTruthy();
    expect(view.container.textContent).not.toMatch(/Te controleren|Geverifieerd|Gebeld|Geen gehoor|Gewonnen/);
  });

  it("houdt alle zes kolommen bereikbaar op desktop, tablet en mobiel", () => {
    const css = readFileSync(resolve("app/globals.css"), "utf8");
    expect(css).toMatch(/\.pipeline-grid\s*\{[^}]*grid-auto-flow:column/);
    expect(css).toMatch(/\.pipeline-grid\s*\{[^}]*overflow-x:auto/);
    expect(css).toMatch(/\.pipeline-grid::-webkit-scrollbar\s*\{[^}]*height:12px/);
    expect(css).toMatch(/\.pipeline-page\s*\{[^}]*max-width:none/);
    expect(css).toContain("@media (max-width:760px)");
    expect(css).toContain(".pipeline-grid{grid-auto-columns:calc(100vw - 48px)}");
  });

  it("laat iedere lege fase expliciet zichtbaar", async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
    const view = render(await PipelinePage());
    expect(view.getAllByText("Geen leads in deze fase.")).toHaveLength(6);
  });
});
