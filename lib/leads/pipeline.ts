export const pipelineStages = [
  { id: "pipeline-nieuw", slug: "nieuw", label: "Nieuw", position: 1, legacyStatus: "NEW" },
  { id: "pipeline-belletje-1", slug: "belletje-1", label: "Belletje 1", position: 2, legacyStatus: "VOICEMAIL" },
  { id: "pipeline-belletje-2", slug: "belletje-2", label: "Belletje 2", position: 3, legacyStatus: "CALL_BACK" },
  { id: "pipeline-gemaild", slug: "gemaild", label: "Gemaild", position: 4, legacyStatus: "QUOTE_SENT" },
  { id: "pipeline-geen-interesse", slug: "geen-interesse", label: "Geen interesse", position: 5, legacyStatus: "NOT_INTERESTED" },
  { id: "pipeline-klant", slug: "klant", label: "Klant", position: 6, legacyStatus: "CUSTOMER" },
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
export const CONTACTED_PIPELINE_STATUSES = pipelineStatuses.filter(
  (status) => status !== NEW_PIPELINE_STAGE_SLUG,
);

export function isPipelineStatus(value: string): value is PipelineStatus {
  return (pipelineStatuses as readonly string[]).includes(value);
}

const pipelineStatusAliases: Record<string, PipelineStatus> = {
  nieuw: "nieuw", new: "nieuw", needs_review: "nieuw", verified: "nieuw", filtered: "nieuw",
  lost: "nieuw", rejected: "nieuw", has_website: "nieuw", permanently_closed: "nieuw", do_not_contact: "nieuw",
  "belletje-1": "belletje-1", belletje_1: "belletje-1", voicemail: "belletje-1", called: "belletje-1", no_answer: "belletje-1",
  "belletje-3": "belletje-1", belletje_3: "belletje-1", interested: "belletje-1", interessant: "belletje-1",
  geinteresseerd: "belletje-1", benaderd: "belletje-1", gebeld: "belletje-1",
  "belletje-2": "belletje-2", belletje_2: "belletje-2", call_back: "belletje-2", terugbellen: "belletje-2",
  reactie_ontvangen: "belletje-2", ingepland: "belletje-2", appointment: "belletje-2", afspraak: "belletje-2",
  "terugbel-verzoek": "belletje-2", terugbel_verzoek: "belletje-2", callback_request: "belletje-2",
  gemaild: "gemaild", emailed: "gemaild", mail_gestuurd: "gemaild", mail_gestuurd_nog_te_bellen: "gemaild",
  "belletje-4": "gemaild", belletje_4: "gemaild", quote_sent: "gemaild", offerte_gestuurd: "gemaild",
  "geen-interesse": "geen-interesse", geen_interesse: "geen-interesse", not_interested: "geen-interesse",
  niet_interessant: "geen-interesse", niet_relevant: "geen-interesse",
  klant: "klant", customer: "klant", won: "klant", deal: "klant", klant_geworden: "klant",
};

export function normalizePipelineStatus(value: string): PipelineStatus | null {
  const normalized = value.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return pipelineStatusAliases[normalized] ?? pipelineStatusAliases[value.trim().toLowerCase()] ?? null;
}

export function toPipelineOptions(stages: Array<{ id: string; slug: string; name: string; position: number }>): PipelineOption[] {
  return stages.map(({ id, slug, name, position }) => ({ id, slug, name, position }));
}
