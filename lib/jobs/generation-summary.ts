export type GenerationOutcomeCounts = {
  candidatesChecked?: number;
  rejected?: number;
  stored?: number;
  manualReview?: number;
  pendingCandidates?: number;
  websitesFound?: number;
  invalidPhone?: number;
  emailsMissing?: number;
  emailsInvalid?: number;
  duplicates?: number;
  permanentlyClosed?: number;
  temporarilyClosed?: number;
  languageRejected?: number;
  multipleLocationsRejected?: number;
  chainRejected?: number;
  franchiseRejected?: number;
  locationCountUncertain?: number;
};

type ReasonCount = { count: number; label: string };

export function preservedCandidateCount(run: GenerationOutcomeCounts) {
  // A pending generation row and a durable retry row can describe the same
  // candidate. Taking the maximum prevents the completion message from
  // reporting that candidate twice.
  return Math.max(run.pendingCandidates ?? 0, run.manualReview ?? 0);
}

export function rejectionReasonCounts(run: GenerationOutcomeCounts): ReasonCount[] {
  const reasons: ReasonCount[] = [
    { count: run.websitesFound ?? 0, label: "hadden een eigen website" },
    { count: run.invalidPhone ?? 0, label: "hadden geen geldig telefoonnummer" },
    { count: run.emailsMissing ?? 0, label: "hadden geen openbaar zakelijk e-mailadres" },
    { count: run.emailsInvalid ?? 0, label: "hadden een ongeldig e-mailadres" },
    { count: run.duplicates ?? 0, label: "waren duplicaten" },
    { count: (run.permanentlyClosed ?? 0) + (run.temporarilyClosed ?? 0), label: "waren gesloten of niet betrouwbaar actief" },
    { count: run.languageRejected ?? 0, label: "waren niet Nederlandstalig" },
    { count: run.multipleLocationsRejected ?? 0, label: "hadden meerdere vestigingen" },
    { count: (run.chainRejected ?? 0) + (run.franchiseRejected ?? 0), label: "waren een keten of franchise" },
    { count: run.locationCountUncertain ?? 0, label: "hadden een onzeker vestigingsaantal" },
  ];
  return reasons.filter(({ count }) => count > 0).sort((a, b) => b.count - a.count);
}

export function rejectionBreakdown(run: GenerationOutcomeCounts, limit = 4) {
  const reasons = rejectionReasonCounts(run).slice(0, Math.max(1, limit));
  if (!reasons.length) {
    return (run.rejected ?? 0) > 0
      ? `${run.rejected} voldeden niet aan de overige vaste criteria`
      : "";
  }
  return reasons.map(({ count, label }) => `${count} ${label}`).join(", ");
}

export function completedRunMessage(run: GenerationOutcomeCounts) {
  const checked = run.candidatesChecked ?? 0;
  const stored = run.stored ?? 0;
  const rejected = run.rejected ?? 0;
  const preserved = preservedCandidateCount(run);
  if (stored > 0) {
    return `${stored} nieuwe gekwalificeerde leads zijn opgeslagen in Nieuw. ${checked} kandidaten zijn gecontroleerd, ${rejected} zijn afgewezen${preserved ? ` en ${preserved} kandidaten worden tijdens een volgende run verder gecontroleerd` : ""}.`;
  }
  const breakdown = rejectionBreakdown(run);
  return `${checked} kandidaten zijn gecontroleerd. Geen kandidaten voldeden aan alle vaste criteria.${breakdown ? ` Meest voorkomende redenen: ${breakdown}.` : ""}${preserved ? ` ${preserved} kandidaten worden tijdens een volgende run verder gecontroleerd.` : ""}`;
}
