export type PublicationDraft<T> = {
  id: string;
  value: T;
  identityKeys: string[];
};

type PublicationOptions<T> = {
  drafts: PublicationDraft<T>[];
  isValid: (draft: PublicationDraft<T>) => boolean | Promise<boolean>;
  duplicateExists: (identityKeys: string[]) => boolean | Promise<boolean>;
  insert: (draft: PublicationDraft<T>) => boolean | Promise<boolean>;
  removeStored: (draftIds: string[]) => void | Promise<void>;
};

/**
 * Publishes every independently valid, non-duplicate draft. The caller runs
 * this helper inside one serializable transaction, so an exception rolls back
 * both inserts and draft removals.
 */
export async function publishQualifiedDrafts<T>(options: PublicationOptions<T>) {
  const storedDraftIds: string[] = [];
  const seenIdentities = new Set<string>();
  let invalid = 0;
  let duplicates = 0;

  for (const draft of options.drafts) {
    if (!await options.isValid(draft)) {
      invalid += 1;
      continue;
    }
    const duplicateInBatch = draft.identityKeys.some((key) => seenIdentities.has(key));
    if (duplicateInBatch || await options.duplicateExists(draft.identityKeys)) {
      duplicates += 1;
      continue;
    }
    draft.identityKeys.forEach((key) => seenIdentities.add(key));
    if (await options.insert(draft)) storedDraftIds.push(draft.id);
    else invalid += 1;
  }

  if (storedDraftIds.length) await options.removeStored(storedDraftIds);
  return { inserted: storedDraftIds.length, storedDraftIds, invalid, duplicates };
}

