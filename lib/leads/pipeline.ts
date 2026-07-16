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
  { id: "pipeline-terugbel-verzoek", slug: "terugbel-verzoek", label: "Terugbel verzoek", position: 10, legacyStatus: "CALL_BACK" },
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

const pipelineStatusAliases: Record<string, PipelineStatus> = {
  nieuw: "nieuw", new: "nieuw", needs_review: "nieuw", verified: "nieuw", filtered: "nieuw",
  lost: "nieuw", rejected: "nieuw", has_website: "nieuw", permanently_closed: "nieuw", do_not_contact: "nieuw",
  "belletje-1": "belletje-1", belletje_1: "belletje-1", voicemail: "belletje-1", called: "belletje-1", no_answer: "belletje-1",
  "belletje-2": "belletje-2", belletje_2: "belletje-2", call_back: "belletje-2", terugbellen: "belletje-2",
  "belletje-3": "belletje-3", belletje_3: "belletje-3", interested: "belletje-3", geinteresseerd: "belletje-3",
  "belletje-4": "belletje-4", belletje_4: "belletje-4", quote_sent: "belletje-4", offerte_gestuurd: "belletje-4",
  gemaild: "gemaild", emailed: "gemaild",
  ingepland: "ingepland", appointment: "ingepland", afspraak: "ingepland",
  deal: "deal", customer: "deal", won: "deal", klant: "deal",
  "geen-interesse": "geen-interesse", geen_interesse: "geen-interesse", not_interested: "geen-interesse",
  "terugbel-verzoek": "terugbel-verzoek", terugbel_verzoek: "terugbel-verzoek", callback_request: "terugbel-verzoek",
};

export function normalizePipelineStatus(value: string): PipelineStatus | null {
  const normalized = value.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return pipelineStatusAliases[normalized] ?? pipelineStatusAliases[value.trim().toLowerCase()] ?? null;
}

export function toPipelineOptions(stages: Array<{ id: string; slug: string; name: string; position: number }>): PipelineOption[] {
  return stages.map(({ id, slug, name, position }) => ({ id, slug, name, position }));
}
