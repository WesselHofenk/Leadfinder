export const pipelineStages = [
  { status: "NEW", label: "Nieuw" },
  { status: "VOICEMAIL", label: "Voicemail" },
  { status: "CALL_BACK", label: "Terugbellen" },
  { status: "INTERESTED", label: "Geïnteresseerd" },
  { status: "APPOINTMENT", label: "Afspraak" },
  { status: "QUOTE_SENT", label: "Offerte gestuurd" },
  { status: "CUSTOMER", label: "Klant" },
  { status: "NOT_INTERESTED", label: "Niet geïnteresseerd" },
] as const;

export type PipelineStatus = typeof pipelineStages[number]["status"];

export const pipelineStatuses = Object.freeze(
  pipelineStages.map(({ status }) => status),
) as readonly [PipelineStatus, ...PipelineStatus[]];

export const pipelineStatusLabels = Object.fromEntries(
  pipelineStages.map(({ status, label }) => [status, label]),
) as Record<PipelineStatus, string>;

export function isPipelineStatus(value: string): value is PipelineStatus {
  return (pipelineStatuses as readonly string[]).includes(value);
}
