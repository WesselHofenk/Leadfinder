
import { describe, expect, it, vi } from "vitest";

import { publishQualifiedDrafts, type PublicationDraft } from "@/lib/jobs/qualified-draft-publication";

type Draft = { valid: boolean };

function drafts(count: number): PublicationDraft<Draft>[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `draft-${index}`,
    value: { valid: true },
    identityKeys: [`phone-${index}`],
  }));
}

async function publish(input: PublicationDraft<Draft>[], duplicateKeys = new Set<string>()) {
  const inserted: string[] = [];
  const removed: string[] = [];
  const result = await publishQualifiedDrafts({
    drafts: input,
    isValid: (draft) => draft.value.valid,
    duplicateExists: (keys) => keys.some((key) => duplicateKeys.has(key)),
    insert: (draft) => { inserted.push(draft.id); return true; },
    removeStored: (ids) => { removed.push(...ids); },
  });
  return { result, inserted, removed };
}

describe("gedeeltelijke, atomaire publicatie van gekwalificeerde concepten", () => {
  it.each([1, 3, 7, 10])("slaat alle %i geldige concepten op zonder exact-tienbarrière", async (count) => {
    const { result, inserted, removed } = await publish(drafts(count));
    expect(result.inserted).toBe(count);
    expect(inserted).toHaveLength(count);
    expect(removed).toEqual(inserted);
  });

  it("handelt nul geldige concepten eerlijk af", async () => {
    const input = drafts(2).map((draft) => ({ ...draft, value: { valid: false } }));
    const { result, inserted, removed } = await publish(input);
    expect(result).toMatchObject({ inserted: 0, invalid: 2 });
    expect(inserted).toEqual([]);
    expect(removed).toEqual([]);
  });

  it("laat één ongeldig concept de andere geldige concepten niet blokkeren", async () => {
    const input = drafts(4);
    input[1].value.valid = false;
    const { result, inserted, removed } = await publish(input);
    expect(result).toMatchObject({ inserted: 3, invalid: 1 });
    expect(inserted).toEqual(["draft-0", "draft-2", "draft-3"]);
    expect(removed).toEqual(inserted);
  });

  it("blokkeert bestaande en onderlinge duplicaten", async () => {
    const input = drafts(3);
    input[2].identityKeys = [input[0].identityKeys[0]];
    const { result, inserted } = await publish(input, new Set([input[1].identityKeys[0]]));
    expect(result).toMatchObject({ inserted: 1, duplicates: 2 });
    expect(inserted).toEqual(["draft-0"]);
  });

  it("verwijdert alleen aantoonbaar opgeslagen concepten en behoudt retrykandidaten", async () => {
    const input = drafts(3);
    const removed = vi.fn();
    const result = await publishQualifiedDrafts({
      drafts: input,
      isValid: (draft) => draft.id !== "draft-1",
      duplicateExists: () => false,
      insert: (draft) => draft.id !== "draft-2",
      removeStored: removed,
    });
    expect(result).toMatchObject({ inserted: 1, invalid: 2 });
    expect(removed).toHaveBeenCalledWith(["draft-0"]);
  });

  it("laat bij een databasefout alle concepten staan voor een nieuwe poging", async () => {
    const removed = vi.fn();
    await expect(publishQualifiedDrafts({
      drafts: drafts(3),
      isValid: () => true,
      duplicateExists: () => false,

      insert: () => { throw new Error("database unavailable"); },
      removeStored: removed,
    })).rejects.toThrow("database unavailable");
    expect(removed).not.toHaveBeenCalled();
  });
});
