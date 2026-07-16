"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, LoaderCircle, Plus, RotateCcw, Square } from "lucide-react";
import { isTerminalGenerationStatus } from "@/lib/jobs/generation-state";

type Run = {
  id: string;
  status: string;
  targetCount: number;
  progress: number;
  message?: string;
  candidatesFound: number;
  candidatesChecked: number;
  stored: number;
  withoutWebsite: number;
  manualReview: number;
  duplicates: number;
  existingLeads: number;
  rejected: number;
  websitesChecked: number;
  websitesFound: number;
  permanentlyClosed: number;
  temporarilyClosed: number;
  sourceFailures: number;
  blockedBrussels: number;
  blockedGhent: number;
  invalidPhone: number;
  languageRejected: number;
  pendingCandidates: number;
  retriedCandidates: number;
  batchNumber: number;
  exhausted: boolean;
  apiErrors: string[];
  warnings: string[];
  currentPhase: string;
  currentSource?: string;
  currentRegion?: string;
  currentCategory?: string;
  currentTile?: string;
  stopReason?: string;
  startedAt?: string;
  updatedAt: string;
};

function resultMessage(run: Run) {
  if (run.status === "COMPLETE") return `${run.stored} bevestigde leads opgeslagen; ${run.manualReview} onzekere kandidaten blijven veilig in de PostgreSQL-retryqueue. ${run.stopReason || "De zoekrun is afgerond."}`;
  if (run.status === "PARTIALLY_COMPLETED") return run.stopReason || `De generatie is gedeeltelijk afgerond; ${run.stored} bevestigde resultaten zijn veilig opgeslagen.`;
  if (run.status === "CANCELLED") return run.stopReason || "Zoekrun geannuleerd.";
  if (run.status === "TIMED_OUT") return run.stopReason || "De zoekrun is na de maximale verwerkingstijd gestopt. Probeer opnieuw.";
  return run.stopReason || "Leadgeneratie is gestopt. Bekijk beheerlogs voor technische details.";
}

export function GenerationButton() {
  const router = useRouter();
  const alive = useRef(true);
  const polling = useRef(false);
  const advancing = useRef(false);
  const stopped = useRef(false);
  const actionVersion = useRef(0);
  const batchController = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const finish = useCallback((latest: Run) => {
    stopped.current = true;
    setRun(latest);
    setPending(false);
    setMessage(resultMessage(latest));
    router.refresh();
  }, [router]);

  const advance = useCallback((runId: string) => {
    if (advancing.current || !alive.current || stopped.current) return;
    advancing.current = true;
    const controller = new AbortController();
    batchController.current = controller;
    void fetch("/api/generation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId }),
      signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!alive.current || stopped.current || controller.signal.aborted) return;
      if (!response.ok) {
        setMessage(data.error || "De zoekbatch kon niet worden verwerkt; er wordt opnieuw geprobeerd.");
        return;
      }
      const latest = data.run as Run;
      if (isTerminalGenerationStatus(latest.status)) finish(latest);
      else setRun((current) => stopped.current ? current : latest);
    }).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (alive.current) setMessage("De serververbinding werd onderbroken; de opgeslagen jobstatus blijft behouden.");
    }).finally(() => {
      if (batchController.current === controller) batchController.current = null;
      advancing.current = false;
    });
  }, [finish]);

  const pollUntilFinished = useCallback(async (runId: string) => {
    if (polling.current) return;
    polling.current = true;
    let networkFailures = 0;
    try {
      while (alive.current && !stopped.current) {
        const response = await fetch("/api/generation", { cache: "no-store" }).catch(() => null);
        if (!response?.ok) {
          networkFailures += 1;
          if (networkFailures >= 5) setMessage("De voortgang kon tijdelijk niet worden opgehaald. De job blijft veilig in de database staan.");
        } else {
          networkFailures = 0;
          const data = await response.json();
          const latest = data.run as Run | null;
          if (!latest || !alive.current || stopped.current) return;
          if (isTerminalGenerationStatus(latest.status)) { finish(latest); return; }
          setRun((current) => stopped.current ? current : latest);
          advance(latest.id || runId);
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    } finally { polling.current = false; }
  }, [advance, finish]);

  useEffect(() => {
    alive.current = true;
    const initialVersion = actionVersion.current;
    void (async () => {
      const response = await fetch("/api/generation", { cache: "no-store" });
      if (!response.ok || !alive.current || actionVersion.current !== initialVersion) return;
      const data = await response.json();
      if (!alive.current || actionVersion.current !== initialVersion) return;
      const latest = data.run as Run | null;
      if (latest && isTerminalGenerationStatus(latest.status)) {
        finish(latest);
        return;
      }
      if (latest) {
        setRun((current) => stopped.current ? current : latest);
        setPending((current) => stopped.current ? current : true);
        advance(latest.id);
        void pollUntilFinished(latest.id);
      }
    })();
    return () => {
      alive.current = false;
      batchController.current?.abort();
    };
  }, [advance, finish, pollUntilFinished]);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [pending]);

  async function generate() {
    actionVersion.current += 1;
    stopped.current = false;
    setPending(true);
    setMessage("");
    setRun(null);
    try {
      const response = await fetch("/api/generation", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (data.run) setRun(data.run);
      if (!response.ok && response.status !== 409) {
        setPending(false);
        setMessage(data.error || "Leadgeneratie mislukt");
        return;
      }
      const runId = (data.run as Run | undefined)?.id;
      if (!runId) throw new Error("Geen job-ID ontvangen");
      advance(runId);
      void pollUntilFinished(runId);
    } catch {
      setPending(false);
      setMessage("De serververbinding is verbroken. Probeer het opnieuw.");
    }
  }

  async function cancel() {
    actionVersion.current += 1;
    stopped.current = true;
    batchController.current?.abort();
    setPending(false);
    const response = await fetch("/api/generation", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: run?.id }),
    });
    const data = await response.json().catch(() => ({}));
    if (data.run) finish(data.run as Run);
    else { setPending(false); setMessage(data.message || "Zoekrun geannuleerd."); }
  }

  const progress = pending ? Math.max(2, Math.min(100, run?.progress ?? 2)) : Math.min(100, run?.progress ?? 0);
  const activity = pending && (run?.candidatesFound ?? 0) === 0;
  const elapsedSeconds = run?.startedAt ? Math.max(0, Math.floor((now - new Date(run.startedAt).getTime()) / 1_000)) : 0;
  const elapsed = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
  return <div className="generation-control">
    <button className="button button-primary" onClick={generate} disabled={pending} aria-busy={pending}>
      {pending ? <LoaderCircle className="animate-spin" size={15}/> : message ? <RotateCcw size={15}/> : <Plus size={15}/>} {pending ? "Leads controleren…" : message ? "Opnieuw genereren" : "Nieuwe leads genereren"}
    </button>
    {pending && <section className="generation-progress" aria-live="polite" aria-label="Voortgang leadgeneratie">
      <div className="generation-progress-head"><span>{run?.currentPhase || "Zoekopdracht valideren"}</span><strong>{Math.round(progress)}%</strong></div>
      <div className={`progress${activity ? " progress-active" : ""}`}><span style={{ width: `${progress}%` }}/></div>
      <p className="generation-source-note">{[run?.currentSource, run?.currentRegion, run?.currentCategory, run?.currentTile].filter(Boolean).join(" · ") || "Persistente zoekjob wordt voorbereid"} · batch {run?.batchNumber ?? 0} · {elapsed}</p>
      <p className="generation-source-note">{run?.message || "De eerste kleine zoekbatch start binnen enkele seconden."}</p>
      <div className="generation-metrics">
        <Metric label="Kandidaten" value={run?.candidatesFound ?? 0}/><Metric label="Gecontroleerd" value={run?.candidatesChecked ?? 0}/>
        <Metric label="Websites" value={run?.websitesChecked ?? 0}/><Metric label="Duplicaten" value={run?.duplicates ?? 0}/>
        <Metric label="Zonder website" value={run?.withoutWebsite ?? 0}/><Metric label="Website gevonden" value={run?.websitesFound ?? 0}/>
        <Metric label="Gesloten verwijderd" value={(run?.permanentlyClosed ?? 0) + (run?.temporarilyClosed ?? 0)}/><Metric label="Later opnieuw" value={run?.retriedCandidates ?? 0}/>
        <Metric label="Brussel afgewezen" value={run?.blockedBrussels ?? 0}/><Metric label="Gent afgewezen" value={run?.blockedGhent ?? 0}/>
        <Metric label="Zonder geldig telefoonnummer" value={run?.invalidPhone ?? 0}/><Metric label="Niet Nederlandstalig" value={run?.languageRejected ?? 0}/>
        <Metric label="Bestaand" value={run?.existingLeads ?? 0}/><Metric label="Onzeker in retryqueue" value={run?.manualReview ?? 0}/>
        <Metric label="Afgewezen" value={run?.rejected ?? 0}/><Metric label="Mislukte zoekopdrachten" value={run?.sourceFailures ?? 0}/>
        <Metric label="Nieuw bewaard" value={`${run?.stored ?? 0}/${run?.targetCount ?? 50}`} strong/>
      </div>
      <p className="generation-source-note">{run?.pendingCandidates ?? 0} kandidaten wachten in deze run · {run?.manualReview ?? 0} onzekere kandidaten staan duurzaam in de PostgreSQL-retryqueue · {run?.sourceFailures ?? 0} bronfouten</p>
      <button className="button button-secondary generation-cancel" onClick={cancel}><Square size={13}/>Zoekrun annuleren</button>
    </section>}
    {message && <p className={["COMPLETE", "PARTIALLY_COMPLETED"].includes(run?.status ?? "") ? "success-message" : "alert"} role="status">{["COMPLETE", "PARTIALLY_COMPLETED"].includes(run?.status ?? "") && <CheckCircle2 size={15}/>} {message}</p>}
  </div>;
}

function Metric({ label, value, strong = false }: { label: string; value: number | string; strong?: boolean }) {
  return <div><span>{label}</span><strong className={strong ? "generation-total" : undefined}>{value}</strong></div>;
}
