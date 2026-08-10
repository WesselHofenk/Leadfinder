// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pipelineStages } from "@/lib/leads/pipeline";

const { findMany, count, transaction } = vi.hoisted(() => ({
  findMany: vi.fn(async ({ where }) => [{
    id: `lead-${where.status}`, companyName: `Lead ${where.status}`, category: "bedrijf", city: "Utrecht", country: "NL",
    streetAddress: "Oudegracht 1", postalCode: "3511AA", email: "info@lead.nl", normalizedPhoneNumber: "+31301234567",
    googleMapsUrl: "https://maps.google.com/?q=lead", websiteUrl: null, websiteStatus: "NO_WEBSITE_CONFIRMED",
    websiteStatusReason: "Twee openbare bronnen tonen geen zelfstandige website.", chatbotStatus: "NOT_PRESENT",
    chatbotStatusReason: "Geen website en dus geen chatwidget.", leadType: "NO_WEBSITE", opportunityScore: 80,
    websiteConfidence: 90, lastVerifiedAt: new Date("2026-07-23T10:00:00Z"), status: where.status,
  }]),
  count: vi.fn(async () => 1),
  transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { lead: { findMany, count }, $transaction: transaction } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import PipelinePage from "@/app/(app)/pipeline/page";

describe("pipelineweergave", () => {
  afterEach(() => cleanup());

  it("toont exact negen kolommen en overal dezelfde negen dropdownopties", async () => {
    const view = render(await PipelinePage());
    expect([...view.container.querySelectorAll(".pipeline-title strong")].map((node) => node.textContent)).toEqual(pipelineStages.map(({ label }) => label));
    const dropdowns = [...view.container.querySelectorAll<HTMLSelectElement>('select[aria-label="Pipelinefase"]')];
    expect(dropdowns).toHaveLength(9);
    for (const dropdown of dropdowns) expect([...dropdown.options].map((option) => option.text)).toEqual(pipelineStages.map(({ label }) => label));
    expect(view.container.querySelectorAll(".pipeline-column")).toHaveLength(9);
    expect([...view.container.querySelectorAll(".pipeline-title .badge")].map((node) => node.textContent)).toEqual(["1","1","1","1","1","1","1","1","1"]);
    expect([...view.container.querySelectorAll(".pipeline-title strong")].at(-1)?.textContent).toBe("Niet geïnteresseerd");
    expect(view.container.textContent).not.toMatch(/Te controleren|Geverifieerd|Gebeld|Geen gehoor|Gewonnen/);
  });

  it("houdt alle negen kolommen bereikbaar op desktop, tablet en mobiel", () => {
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
    expect(view.getAllByText("Geen leads in deze fase.")).toHaveLength(9);
  });

  it("opent het compacte profiel zonder routewijziging en toont correcte contactlinks", async () => {
    findMany.mockImplementation(async ({ where }) => [{
      id: `lead-${where.status}`, companyName: `Lead ${where.status}`, category: "bedrijf", city: "Utrecht", country: "NL",
      streetAddress: "Oudegracht 1", postalCode: "3511AA", email: "info@lead.nl", normalizedPhoneNumber: "+31301234567",
      googleMapsUrl: "https://maps.google.com/?q=lead", websiteUrl: null, websiteStatus: "NO_WEBSITE_CONFIRMED",
      websiteStatusReason: "Twee bronnen gecontroleerd.", chatbotStatus: "NOT_PRESENT", chatbotStatusReason: "Geen widget.",
      leadType: "NO_WEBSITE", opportunityScore: 80, websiteConfidence: 90, lastVerifiedAt: new Date("2026-07-23T10:00:00Z"), status: where.status,
    }]);
    count.mockResolvedValue(1);
    window.history.replaceState({}, "", "/pipeline?fase=nieuw");
    const view = render(await PipelinePage());
    fireEvent.click(view.getByRole("button", { name: "Open compact profiel van Lead NEW" }));
    expect(window.location.pathname).toBe("/pipeline");
    expect(window.location.search).toBe("?fase=nieuw");
    expect(view.getByRole("dialog").textContent).toContain("Geen website");
    expect(view.getByRole("link", { name: /info@lead.nl/ }).getAttribute("href")).toBe("mailto:info@lead.nl");
    expect(view.getByRole("link", { name: /\+31301234567/ }).getAttribute("href")).toBe("tel:+31301234567");
    expect(view.getByRole("link", { name: /Kaart openen/ }).getAttribute("target")).toBe("_blank");
    fireEvent.click(view.getByRole("button", { name: "Leadprofiel sluiten" }));
    expect(view.queryByRole("dialog")).toBeNull();
    expect(window.location.pathname).toBe("/pipeline");
  });
});
