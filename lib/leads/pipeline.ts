export const pipelineStages = [
  { id: "pipeline-nieuw", slug: "nieuw", label: "Nieuw", position: 1, legacyStatus: "NEW" },
  { id: "pipeline-belletje-1", slug: "belletje-1", label: "Belletje 1", position: 2, legacyStatus: "VOICEMAIL" },
  { id: "pipeline-belletje-2", slug: "belletje-2", label: "Belletje 2", position: 3, legacyStatus: "CALL_BACK" },
  { id: "pipeline-belletje-3", slug: "belletje-3", label: "Belletje 3", position: 4, legacyStatus: "INTERESTED" },
  { id: "pipeline-belletje-4", slug: "belletje-4", label: "Belletje 4", position: 5, legacyStatus: "QUOTE_SENT" },
  { id: "pipeline-gemaild", slug: "gemaild", label: "Gemaild", position: 6, legacyStatus: "QUOTE_SENT" },
  { id: "pipeline-ingepland", slug: "ingepland", label: "Ingepland", position: 7, legacyStatus: "APPOINTMENT" },
  { id: "pipeline-deal", slug: "deal", label: "Deal", position: 8, legacyStatus: "CUSTOMER" },
  { id: "pipeline-geen-interesse", slug: "geen-interesse", label: "Geen interesse", position: 9, legacyStatus: "NOT_INTERESTED" },
] as const;

export type PipelineStatus = typeof pipelineStages[number]["slug"];
export type PipelineOption = { id: string; slug: string; name: string; position: number };

export const pipelineStatuses = Object.freeze(
  pipelineStages.map(({ slug }) => slug),
) as readonly [PipelineStatus, ...PipelineStatus[]];

export const pipelineStatusLabels = Object.fromEntries(
  pipelineStages.map(({ slug, label }) => [slug, label]),
) as Record<PipelineStatus, string>;

export const NEW_PIPELINE_STAGE_ID = pipelineStages[0].id;
export const NEW_PIPELINE_STAGE_SLUG = pipelineStages[0].slug;

export function isPipelineStatus(value: string): value is PipelineStatus {
  return (pipelineStatuses as readonly string[]).includes(value);
}

export function toPipelineOptions(stages: Array<{ id: string; slug: string; name: string; position: number }>): PipelineOption[] {
  return stages.map(({ id, slug, name, position }) => ({ id, slug, name, position }));
}
