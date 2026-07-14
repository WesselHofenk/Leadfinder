import { describe, expect, it } from "vitest";
import { candidateDedupeKeys, RunDeduplicator } from "@/lib/leads/deduplication";
import { hasOwnWebsite, isNonOwnedWebsite, normalizeWebsite } from "@/lib/leads/website";
import type { Candidate } from "@/lib/leads/eligibility";
import { shouldContinueGeneration } from "@/lib/leads/search-loop";

const base: Candidate = { externalPlaceId: "place-1", companyName: "De Schilder", phoneNumber: "06 12345678", businessStatus: "OPERATIONAL", country: "NL", category: "schilder", city: "Utrecht", postalCode: "3511 AA", streetAddress: "Oudegracht 1", latitude: 52.09, longitude: 5.12, googleMapsUrl: "https://maps.google.com" };

describe("websitecontrole", () => {
  it.each([undefined, null, "", "-", "geen website", "n.v.t."])("normaliseert %s als ontbrekend", (value) => expect(normalizeWebsite(value)).toBeNull());
  it("controleert alle aanvullende websitevelden", () => expect(hasOwnWebsite(undefined, null, "https://bedrijf.nl")).toBe(true));
  it.each(["https://google.com/maps/x", "https://instagram.com/bedrijf", "https://linkedin.com/company/bedrijf", "https://thuisbezorgd.nl/menu/x"])("herkent %s als niet-eigen kanaal", (value) => expect(isNonOwnedWebsite(value)).toBe(true));
});

describe("deduplicatie binnen een run", () => {
  it("dedupliceert op place ID", () => { const index = new RunDeduplicator(); expect(index.hasOrAdd(candidateDedupeKeys(base))).toBe(false); expect(index.hasOrAdd(candidateDedupeKeys({ ...base, phoneNumber: "06 87654321" }))).toBe(true); });
  it("dedupliceert op telefoonnummer", () => { const index = new RunDeduplicator(); index.hasOrAdd(candidateDedupeKeys(base)); expect(index.hasOrAdd(candidateDedupeKeys({ ...base, externalPlaceId: "place-2", companyName: "Andere naam" }))).toBe(true); });
  it("dedupliceert op naam en postcode", () => { const index = new RunDeduplicator(); index.hasOrAdd(candidateDedupeKeys(base)); expect(index.hasOrAdd(candidateDedupeKeys({ ...base, externalPlaceId: "place-2", phoneNumber: "06 87654321", streetAddress: "Andere straat 2" }))).toBe(true); });
});

describe("zoeklus", () => {
  it("blijft zoeken zolang het doel van 50 geldige leads niet is gehaald", () => expect(shouldContinueGeneration({ stored: 49, target: 50, candidatesFound: 300, buffer: 200, tasksRemain: true })).toBe(true));
  it("bouwt eerst de kandidaatbuffer op", () => expect(shouldContinueGeneration({ stored: 50, target: 50, candidatesFound: 149, buffer: 200, tasksRemain: true })).toBe(true));
  it("stopt pas bij doel plus buffer of aantoonbare uitputting", () => { expect(shouldContinueGeneration({ stored: 50, target: 50, candidatesFound: 200, buffer: 200, tasksRemain: true })).toBe(false); expect(shouldContinueGeneration({ stored: 12, target: 50, candidatesFound: 80, buffer: 200, tasksRemain: false })).toBe(false); });
});
