const manualKeys=["pipelineStageId","notes","doNotContact","filterReason","isFiltered"] as const;
export function preserveManualLeadFields<T extends Record<string,unknown>>(existing:T,automatic:Record<string,unknown>){const merged:Record<string,unknown>={...existing,...automatic};for(const key of manualKeys)if(key in existing)merged[key]=existing[key];return merged as T&Record<string,unknown>}
