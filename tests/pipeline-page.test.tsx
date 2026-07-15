// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pipelineStages } from "@/lib/leads/pipeline";

const { findMany, count, transaction } = vi.hoisted(() => ({
  findMany: vi.fn(async ({ where }) => [{ id: `lead-${where.status}`, companyName: `Lead ${where.status}`, category: "bedrijf", city: "Utrecht", opportunityScore: 80, websiteConfidence: 90, status: where.status }]),
  count: vi.fn(async () => 1),
  transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { lead: { findMany, count }, $transaction: transaction } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import PipelinePage from "@/app/(app)/pipeline/page";

describe("pipelineweergave", () => {
  afterEach(() => cleanup());

  it("toont exact zeven kolommen en overal dezelfde zeven dropdownopties", async () => {
    const view = render(await PipelinePage());
    expect([...view.container.querySelectorAll(".pipeline-title strong")].map((node) => node.textContent)).toEqual(pipelineStages.map(({ label }) => label));
    const dropdowns = [...view.container.querySelectorAll<HTMLSelectElement>('select[aria-label="Pipelinefase"]')];
    expect(dropdowns).toHaveLength(7);
    for (const dropdown of dropdowns) expect([...dropdown.options].map((option) => option.text)).toEqual(pipelineStages.map(({ label }) => label));
    expect(view.container.querySelectorAll(".pipeline-column")).toHaveLength(7);
    expect([...view.container.querySelectorAll(".pipeline-title .badge")].map((node) => node.textContent)).toEqual(["1","1","1","1","1","1","1"]);
    expect(view.container.textContent).not.toMatch(/Te controleren|Geverifieerd|Gebeld|Geen gehoor|Gewonnen/);
  });

  it("houdt de zeven kolommen horizontaal scrollbaar op kleine schermen", () => {
    const css = readFileSync(resolve("app/globals.css"), "utf8");
    expect(css).toMatch(/\.pipeline-grid\s*\{[^}]*grid-auto-flow:column/);
    expect(css).toMatch(/\.pipeline-grid\s*\{[^}]*overflow-x:auto/);
  });
});
