import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Candidate } from "@/lib/leads/eligibility";
import type { QualifiedDraftPayload } from "@/lib/leads/qualified-draft";

vi.mock("server-only", () => ({}));

const database = vi.hoisted(() => {
  const deletedDraftIds: string[] = [];
  const queueUpdates: unknown[] = [];
  let drafts: Array<{ id: string; payload: unknown; createdAt: Date }> = [];
  let insertedLeadIds: string[] = [];
  let duplicateExternalIds = new Set<string>();
  let failInsert = false;
  const tx = {
    qualifiedLeadDraft: {
      findMany: vi.fn(async () => drafts),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        deletedDraftIds.push(where.id);
        drafts = drafts.filter((draft) => draft.id !== where.id);
      }),
    },
    generationCandidate: {
      updateMany: vi.fn(async (input: unknown) => {
        queueUpdates.push(input);
        return { count: 1 };
      }),
    },
    lead: {
      findFirst: vi.fn(async ({ where }: { where: { OR: Array<{ externalPlaceId?: string }> } }) => {
        const externalPlaceId = where.OR.find((part) => part.externalPlaceId)?.externalPlaceId;
        return externalPlaceId && duplicateExternalIds.has(externalPlaceId) ? { id: "existing-lead" } : null;
      }),
      create: vi.fn(async () => {
        if (failInsert) throw new Error("database unavailable");
        const id = `lead-${insertedLeadIds.length + 1}`;
        insertedLeadIds.push(id);
        return { id };
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        insertedLeadIds.includes(where.id) ? { id: where.id, status: "NEW" } : null),
      count: vi.fn(async () => insertedLeadIds.length),
    },
    suppressedLead: { findFirst: vi.fn(async () => null) },
    leadExclusion: { findFirst: vi.fn(async () => null) },
    sourceRecord: { update: vi.fn(async () => ({})) },
    duplicateFingerprint: { upsert: vi.fn(async () => ({})) },
  };
  const prisma = {
    $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
  };
  return {
    prisma,
    tx,
    deletedDraftIds,
    queueUpdates,
    setDrafts(value: typeof drafts) { drafts = value; },
    getDrafts() { return drafts; },
    getInserted() { return insertedLeadIds; },
    reset() {
      drafts = [];
      insertedLeadIds = [];
      duplicateExternalIds = new Set();
      failInsert = false;
      deletedDraftIds.length = 0;
      queueUpdates.length = 0;
    },
    setDuplicates(ids: string[]) { duplicateExternalIds = new Set(ids); },
    setFailInsert(value: boolean) { failInsert = value; },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: database.prisma }));

import { finalizeQualifiedDrafts } from "@/lib/jobs/generation";

function candidate(index: number, overrides: Partial<Candidate> = {}): Candidate {
  return {
    externalPlaceId: `source-${index}`,
    source: "GOOGLE_PLACES",
    companyName: `Bedrijf ${index}`,
    email: `info${index}@voorbeeld.nl`,
    phoneNumber: `0201234${String(index).padStart(3, "0")}`,
    businessStatus: "OPERATIONAL",
    country: "NL",
    category: "winkel",
    city: "Amsterdam",
    postalCode: "1011 AA",
    streetAddress: `Damrak ${index + 1}`,
    latitude: 52.37,
    longitude: 4.89,
    googleMapsUrl: `https://maps.example/${index}`,
    sourceUrl: `https://maps.example/${index}`,
    branchCount: 1,
    ...overrides,
  };
}

function payload(index: number, overrides: Partial<Candidate> = {}): QualifiedDraftPayload {
  const item = candidate(index, overrides);
  return {
    candidate: item,
    verification: {
      status: "NO_WEBSITE_CONFIRMED",
      confidence: 95,
      website: null,
      reason: "Geen eigen website bevestigd.",
      evidence: [],
    },
    contacts: {
      ok: true,
      email: item.email!,
      emailStatus: "DELIVERABLE",
      emailSource: item.sourceUrl!,
      emailValidatedAt: "2026-07-27T20:00:00.000Z",
      phone: `+31201234${String(index).padStart(3, "0")}`,
      phoneStatus: "VALID",
      phoneSource: item.sourceUrl!,
      phoneValidatedAt: "2026-07-27T20:00:00.000Z",
    },
  };
}

function drafts(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `draft-${index}`,
    payload: payload(index),
    createdAt: new Date(2026, 6, 27, 20, 0, index),
  }));
}

describe("veilige gedeeltelijke eindpublicatie", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.reset();
  });

  it.each([1, 3, 7, 10])("slaat %i volledig geldige concepten afzonderlijk op", async (count) => {
    database.setDrafts(drafts(count));
    await expect(finalizeQualifiedDrafts("run-1")).resolves.toEqual({
      inserted: count,
      totalStored: count,
      invalid: 0,
      duplicates: 0,
    });
    expect(database.getInserted()).toHaveLength(count);
    expect(database.deletedDraftIds).toHaveLength(count);
  });

  it("handelt nul geldige concepten eerlijk af", async () => {
    database.setDrafts([]);
    await expect(finalizeQualifiedDrafts("run-1")).resolves.toEqual({
      inserted: 0,
      totalStored: 0,
      invalid: 0,
      duplicates: 0,
    });
  });

  it("slaat geldige leads op terwijl een ander concept ongeldig is", async () => {
    const items = drafts(3);
    items[1].payload = payload(1, { branchCount: 2 });
    database.setDrafts(items);
    await expect(finalizeQualifiedDrafts("run-1")).resolves.toMatchObject({ inserted: 2, invalid: 1 });
    expect(database.deletedDraftIds).toEqual(["draft-0", "draft-2"]);
    expect(database.getDrafts().map(({ id }) => id)).toEqual(["draft-1"]);
  });

  it("blokkeert duplicaten zonder andere geldige leads tegen te houden", async () => {
    database.setDrafts(drafts(3));
    database.setDuplicates(["source-1"]);
    await expect(finalizeQualifiedDrafts("run-1")).resolves.toMatchObject({ inserted: 2, duplicates: 1 });
    expect(database.getDrafts().map(({ id }) => id)).toEqual(["draft-1"]);
  });

  it("houdt een niet-OSM kandidaat met onzeker vestigingsaantal in de retryqueue", async () => {
    database.setDrafts([{ ...drafts(1)[0], payload: payload(0, { branchCount: undefined, source: "GOOGLE_PLACES" }) }]);
    await expect(finalizeQualifiedDrafts("run-1")).resolves.toMatchObject({ inserted: 0, invalid: 1 });
    expect(database.deletedDraftIds).toHaveLength(0);
    expect(database.queueUpdates).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ status: "PENDING", lastError: "vestigingsaantal_onzeker" }) }),
    ]);
  });

  it("accepteert een lokale OSM-vermelding zonder niet-bestaand vestigingsaantalveld", async () => {
    database.setDrafts([{ ...drafts(1)[0], payload: payload(0, {
      branchCount: undefined,
      source: "OPENSTREETMAP",
      sourceUpdatedAt: "2026-07-27T20:00:00.000Z",
    }) }]);
    await expect(finalizeQualifiedDrafts("run-1")).resolves.toMatchObject({ inserted: 1, invalid: 0 });
    expect(database.deletedDraftIds).toEqual(["draft-0"]);
  });

  it("behoudt het concept wanneer de database-insert faalt", async () => {
    database.setDrafts(drafts(1));
    database.setFailInsert(true);
    await expect(finalizeQualifiedDrafts("run-1")).rejects.toThrow("database unavailable");
    expect(database.deletedDraftIds).toHaveLength(0);
    expect(database.getDrafts()).toHaveLength(1);
  });

  it("gebruikt één serialiseerbare transactie en geen exact-aantalbarrière", async () => {
    database.setDrafts(drafts(1));
    await finalizeQualifiedDrafts("run-1");
    expect(database.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: "Serializable" }),
    );
  });
});
