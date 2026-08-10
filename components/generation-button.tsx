
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, Radar } from "lucide-react";
import { useRouter } from "next/navigation";

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
  duplicates: number;
  sourceFailures: number;
  pendingCandidates: number;
  currentPhase: string;
  currentSource?: string | null;
  currentRegion?: string | null;
  currentCategory?: string | null;
  batchNumber: number;
};

type Snapshot = { task: LeadfinderTask; run: Run | null };

export function GenerationButton() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const stored = useRef(0);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/generation", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) {
      setMessage("De backendstatus kon tijdelijk niet worden opgehaald.");
      return;
    }
    const next = await response.json() as Snapshot;
    if ((next.run?.stored ?? 0) > stored.current) router.refresh();
    stored.current = next.run?.stored ?? 0;
    setSnapshot(next);
    setMessage("");
  }, [router]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function toggle() {
    setBusy(true);
    const enabled = snapshot?.task.enabled ?? true;
    const response = await fetch("/api/generation", { method: enabled ? "DELETE" : "POST" }).catch(() => null);
    if (!response?.ok) setMessage("De taakstatus kon niet worden bijgewerkt.");
    else {
      const data = await response.json() as Snapshot & { message?: string };
      setSnapshot({ task: data.task, run: data.run });
      setMessage(data.message ?? (enabled ? "De Leadfinder is gepauzeerd." : "De Leadfinder wordt door de backend hervat."));
    }
    setBusy(false);
  }

  const task = snapshot?.task;
  const run = snapshot?.run;
  const enabled = task?.enabled ?? true;
  const progress = Math.max(0, Math.min(100, run?.progress ?? 0));

  return <section className="generation-control generation-task-card" aria-label="Leadfinder-taakstatus">
    <div className="generation-task-head">

      <span className={`status-dot ${enabled ? "status-dot-active" : ""}`} aria-hidden="true"/>
      <div>
        <strong>{task?.name ?? "Leadfinder doorlopend zoeken"}</strong>
        <span>{enabled ? "Actief · backend draait zelfstandig" : "Gepauzeerd"}</span>
      </div>
      <Radar size={18}/>
    </div>
    <button className="button button-secondary generation-task-toggle" onClick={toggle} disabled={busy || !snapshot}>
      {enabled ? <Pause size={14}/> : <Play size={14}/>} {enabled ? "Pauzeren" : "Hervatten"}
    </button>
    {run && <div className="generation-task-details" aria-live="polite">
      <div className="generation-progress-head"><span>{run.currentPhase || "Wachten op backendbatch"}</span><strong>{Math.round(progress)}%</strong></div>
      <div className="progress"><span style={{ width: `${progress}%` }}/></div>
      <p className="generation-source-note">{[run.currentSource, run.currentRegion, run.currentCategory].filter(Boolean).join(" · ") || "Backendwatchdog actief"} · batch {run.batchNumber}</p>
      <p className="generation-source-note">{run.message || "De volgende zoekbatch wordt automatisch door de server gestart."}</p>
      <div className="generation-metrics">
        <Metric label="Kandidaten" value={run.candidatesFound}/><Metric label="Gecontroleerd" value={run.candidatesChecked}/>
        <Metric label="Nieuw" value={run.stored} strong/><Metric label="Duplicaten" value={run.duplicates}/>
        <Metric label="Wachtrij" value={run.pendingCandidates}/><Metric label="Bronfouten" value={run.sourceFailures}/>
      </div>
    </div>}
    {task?.lastError && <p className="alert" role="alert">{task.lastError}</p>}
    {message && <p className="small muted" role="status">{message}</p>}
  </section>;
}

function Metric({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return <div><span>{label}</span><strong className={strong ? "generation-total" : undefined}>{value}</strong></div>;
}
