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
  manualReview: number;
  duplicates: number;
  existingLeads: number;
  rejected: number;
  websitesChecked: number;
  permanentlyClosed: number;
  sourceFailures: number;
  exhausted: boolean;
  apiErrors: string[];
  warnings: string[];
  currentPhase: string;
  currentSource?: string;
  currentRegion?: string;
  currentTile?: string;
  stopReason?: string;
  updatedAt: string;
};

function resultMessage(run: Run) {
  if (run.status === "COMPLETE") return `${run.stored} bevestigde leads en ${run.manualReview} kandidaten voor handmatige controle. ${run.stopReason || "De zoekrun is afgerond."}`;
  if (run.status === "CANCELLED") return run.stopReason || "Zoekrun geannuleerd.";
  if (run.status === "TIMED_OUT") return run.stopReason || "De zoekrun is na de maximale verwerkingstijd gestopt. Probeer opnieuw.";
  return run.apiErrors?.at(-1) || run.stopReason || "Leadgeneratie is gestopt.";
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
      if (latest && !isTerminalGenerationStatus(latest.status)) {
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
  }, [advance, pollUntilFinished]);

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
  return <div className="generation-control">
    <button className="button button-primary" onClick={generate} disabled={pending} aria-busy={pending}>
      {pending ? <LoaderCircle className="animate-spin" size={15}/> : message ? <RotateCcw size={15}/> : <Plus size={15}/>} {pending ? "Leads controleren…" : message ? "Opnieuw genereren" : "Nieuwe leads genereren"}
    </button>
    {pending && <section className="generation-progress" aria-live="polite" aria-label="Voortgang leadgeneratie">
      <div className="generation-progress-head"><span>{run?.currentPhase || "Zoekopdracht valideren"}</span><strong>{Math.round(progress)}%</strong></div>
      <div className={`progress${activity ? " progress-active" : ""}`}><span style={{ width: `${progress}%` }}/></div>
      <p className="generation-source-note">{[run?.currentSource, run?.currentRegion, run?.currentTile].filter(Boolean).join(" · ") || "Persistente zoekjob wordt voorbereid"}</p>
      <p className="generation-source-note">{run?.message || "De eerste kleine zoekbatch start binnen enkele seconden."}</p>
      <div className="generation-metrics">
        <Metric label="Kandidaten" value={run?.candidatesFound ?? 0}/><Metric label="Gecontroleerd" value={run?.candidatesChecked ?? 0}/>
        <Metric label="Websites" value={run?.websitesChecked ?? 0}/><Metric label="Duplicaten" value={run?.duplicates ?? 0}/>
        <Metric label="Bestaand" value={run?.existingLeads ?? 0}/><Metric label="Handmatige controle" value={run?.manualReview ?? 0}/>
        <Metric label="Nieuw bewaard" value={`${(run?.stored ?? 0) + (run?.manualReview ?? 0)}/${run?.targetCount ?? 50}`} strong/>
      </div>
      <p className="generation-source-note">Onzekere website- of bedrijfsstatussen worden alleen in de handmatige wachtrij gezet · {run?.sourceFailures ?? 0} bronfouten</p>
      <button className="button button-secondary generation-cancel" onClick={cancel}><Square size={13}/>Zoekrun annuleren</button>
    </section>}
    {message && <p className={run?.status === "COMPLETE" ? "success-message" : "alert"} role="status">{run?.status === "COMPLETE" && <CheckCircle2 size={15}/>} {message}</p>}
  </div>;
}

function Metric({ label, value, strong = false }: { label: string; value: number | string; strong?: boolean }) {
  return <div><span>{label}</span><strong className={strong ? "generation-total" : undefined}>{value}</strong></div>;
}
