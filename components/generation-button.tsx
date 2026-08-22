
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, Radar } from "lucide-react";
import { useRouter } from "next/navigation";
import { generationPollingDelay } from "@/lib/jobs/generation-polling";

type LeadfinderTask = {
  name: string;
  enabled: boolean;
  status: string;
  lastHeartbeatAt?: string | null;
  lastError?: string | null;
};

type Run = {
  id: string;
  status: string;
  progress: number;
  message?: string | null;
  candidatesFound: number;
  candidatesChecked: number;
  stored: number;
  validDrafts: number;
  duplicates: number;
  rejected: number;
  manualReview: number;
  permanentlyClosed: number;
  sourceFailures: number;
  pendingCandidates: number;
  currentPhase: string;
  currentSource?: string | null;
  currentRegion?: string | null;
  currentCategory?: string | null;
  batchNumber: number;
};

type OperationalStatus = "STARTING" | "SEARCHING" | "PROCESSING" | "WAITING" | "BUFFER_READY" | "RECOVERING" | "PAUSED" | "ERROR";
type CandidateOutcomes = { qualified: number; rejected: number; duplicates: number; retrying: number; failed: number; processing: number; total: number };
type Snapshot = {
  task: LeadfinderTask;
  run: Run | null;
  operationalStatus: OperationalStatus;
  workerHealthy: boolean;
  candidateOutcomes: CandidateOutcomes;
  rejectionReasons: Array<{ code: string; count: number }>;
  leadBuffer: { eligible: number; target: number; needsRefill: boolean; lastSuccessfulLeadAt: string | null };
};

const statusLabel: Record<OperationalStatus, string> = {
  STARTING: "Starten",
  SEARCHING: "Nieuwe kandidaten zoeken",
  PROCESSING: "Kandidaten verwerken",
  WAITING: "Volgende batch ingepland",
  BUFFER_READY: "Nieuw-buffer gevuld",
  RECOVERING: "Worker herstellen",
  PAUSED: "Gepauzeerd",
  ERROR: "Actie vereist",
};

const rejectionLabel: Record<string, string> = {
  BUSINESS_NOT_CONFIRMED_ACTIVE: "activiteit niet bevestigd",
  SKIPPED_HAS_WEBSITE: "website voldoende bruikbaar",
  LANGUAGE_NOT_DUTCH: "niet aantoonbaar Nederlandstalig",
  EMAIL_MX_MISSING: "e-maildomein zonder MX",
  BUSINESS_EMAIL_REQUIRED: "openbaar zakelijk e-mailadres ontbreekt",
  SINGLE_LOCATION_NOT_CONFIRMED: "één vestiging niet bevestigd",
};

export function GenerationButton() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const stored = useRef(0);
  const pollActive = useRef(false);
  const pollingFailures = useRef(0);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/generation", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) {
      pollingFailures.current += 1;
      setMessage("De backendstatus kon tijdelijk niet worden opgehaald.");
      return;
    }
    const next = await response.json() as Snapshot;
    if ((next.run?.stored ?? 0) > stored.current) router.refresh();
    stored.current = next.run?.stored ?? 0;
    pollActive.current = next.task.enabled;
    pollingFailures.current = 0;
    setSnapshot(next);
    setMessage("");
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      await refresh();
      if (cancelled) return;
      timer = window.setTimeout(
        () => void poll(),
        generationPollingDelay(document.hidden, pollingFailures.current, pollActive.current),
      );
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [refresh]);

  async function toggle() {
    setBusy(true);
    const enabled = snapshot?.task.enabled ?? true;
    const response = await fetch("/api/generation", { method: enabled ? "DELETE" : "POST" }).catch(() => null);
    if (!response?.ok) setMessage("De taakstatus kon niet worden bijgewerkt.");
    else {
      const data = await response.json() as Snapshot & { message?: string };
      setSnapshot(data);
      pollActive.current = data.task.enabled;
      setMessage(data.message ?? (enabled ? "De Leadfinder is gepauzeerd." : "De Leadfinder is gestart."));
    }
    setBusy(false);
  }

  const task = snapshot?.task;
  const run = snapshot?.run;
  const enabled = task?.enabled ?? false;
  const operationalStatus = snapshot?.operationalStatus ?? (enabled ? "STARTING" : "PAUSED");
  const outcomes = snapshot?.candidateOutcomes;
  const progress = Math.max(0, Math.min(100, run?.progress ?? 0));

  return <section className="generation-control generation-task-card" aria-label="Leadfinder-taakstatus">
    <div className="generation-task-head">

      <span className={`status-dot ${enabled ? "status-dot-active" : ""}`} aria-hidden="true"/>
      <div>
        <strong>{task?.name ?? "Leadfinder doorlopend zoeken"}</strong>
        <span>{statusLabel[operationalStatus]}</span>
      </div>
      <Radar size={18}/>
    </div>
    <button className="button button-secondary generation-task-toggle" onClick={toggle} disabled={busy || !snapshot}>
      {enabled ? <Pause size={14}/> : <Play size={14}/>} {enabled ? "Pauzeren" : "Starten / hervatten"}
    </button>
    {run && <div className="generation-task-details" aria-live="polite">
      <div className="generation-progress-head"><span>{run.currentPhase || "Wachten op backendbatch"}</span><strong>{Math.round(progress)}%</strong></div>
      <div className="progress"><span style={{ width: `${progress}%` }}/></div>
      <p className="generation-source-note">{[run.currentSource, run.currentRegion, run.currentCategory].filter(Boolean).join(" · ") || statusLabel[operationalStatus]} · batch {run.batchNumber}</p>
      <p className="generation-source-note">{run.message || "De volgende zoekbatch is duurzaam ingepland."}</p>
      <div className="generation-metrics">
        <Metric label="Kandidaten" value={run.candidatesFound}/><Metric label="Gecontroleerd" value={run.candidatesChecked}/>
        <Metric label="Nieuw" value={run.stored} strong/><Metric label="Gekwalificeerd" value={outcomes?.qualified ?? run.validDrafts}/>
        <Metric label="Afgewezen" value={outcomes?.rejected ?? 0}/><Metric label="Duplicaten" value={outcomes?.duplicates ?? 0}/>
        <Metric label="Hercontrole" value={outcomes?.retrying ?? 0}/><Metric label="Mislukt" value={outcomes?.failed ?? 0}/>
        <Metric label="In verwerking" value={outcomes?.processing ?? 0}/>
        <Metric label="Wachtrij" value={run.pendingCandidates}/><Metric label="Bronfouten" value={run.sourceFailures}/>
        <Metric label="Nieuw-buffer" value={`${snapshot?.leadBuffer?.eligible ?? 0}/${snapshot?.leadBuffer?.target ?? 150}`}/>
      </div>
      {run.candidatesChecked > 0 && <p className="generation-source-note">{outcomes?.total ?? 0} van {run.candidatesChecked} gecontroleerde kandidaten hebben een traceerbare uitkomst.</p>}
      {snapshot?.rejectionReasons?.length ? <p className="generation-source-note">Meest voorkomende afwijzingen: {snapshot.rejectionReasons.map(({ code, count }) => `${rejectionLabel[code] ?? code.toLowerCase().replaceAll("_", " ")} (${count})`).join(" · ")}</p> : null}
      <p className="generation-source-note">Laatste nieuwe verzendbare lead: {snapshot?.leadBuffer?.lastSuccessfulLeadAt ? new Date(snapshot.leadBuffer.lastSuccessfulLeadAt).toLocaleString("nl-NL") : "Nog niet beschikbaar"}</p>
    </div>}
    {task?.lastError && <p className="alert" role="alert">{task.lastError}</p>}
    {message && <p className="small muted" role="status">{message}</p>}
  </section>;
}

function Metric({ label, value, strong = false }: { label: string; value: number | string; strong?: boolean }) {
  return <div><span>{label}</span><strong className={strong ? "generation-total" : undefined}>{value}</strong></div>;
}
