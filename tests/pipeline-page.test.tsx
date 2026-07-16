// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pipelineStages } from "@/lib/leads/pipeline";

const { stageFindMany, findMany, count, transaction } = vi.hoisted(() => ({
  stageFindMany: vi.fn(async () => [
    ["pipeline-nieuw","nieuw","Nieuw",1],["pipeline-belletje-1","belletje-1","Belletje 1",2],
    ["pipeline-belletje-2","belletje-2","Belletje 2",3],["pipeline-belletje-3","belletje-3","Belletje 3",4],
    ["pipeline-belletje-4","belletje-4","Belletje 4",5],["pipeline-ingepland","ingepland","Ingepland",6],
    ["pipeline-deal","deal","Deal",7],["pipeline-geen-interesse","geen-interesse","Geen interesse",8],
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

  it("toont exact acht kolommen en overal dezelfde acht dropdownopties", async () => {
    const view = render(await PipelinePage());
    expect([...view.container.querySelectorAll(".pipeline-title strong")].map((node) => node.textContent)).toEqual(pipelineStages.map(({ label }) => label));
    const dropdowns = [...view.container.querySelectorAll<HTMLSelectElement>('select[aria-label="Pipelinefase"]')];
    expect(dropdowns).toHaveLength(8);
    for (const dropdown of dropdowns) expect([...dropdown.options].map((option) => option.text)).toEqual(pipelineStages.map(({ label }) => label));
    expect(view.container.querySelectorAll(".pipeline-column")).toHaveLength(8);
    expect([...view.container.querySelectorAll(".pipeline-title .badge")].map((node) => node.textContent)).toEqual(["1","1","1","1","1","1","1","1"]);
    expect([...view.container.querySelectorAll(".pipeline-title strong")].at(-1)?.textContent).toBe("Geen interesse");
    expect(view.container.textContent).not.toMatch(/Te controleren|Geverifieerd|Gebeld|Geen gehoor|Gewonnen/);
  });

  it("houdt alle acht kolommen bereikbaar op desktop, tablet en mobiel", () => {
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
    expect(view.getAllByText("Geen leads in deze fase.")).toHaveLength(8);
  });
});
