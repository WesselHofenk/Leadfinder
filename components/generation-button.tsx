"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, LoaderCircle, Plus, RotateCcw } from "lucide-react";

type Run = {
  id: string; status: string; targetCount: number; candidatesFound: number; candidatesChecked: number; stored: number;
  duplicates: number; rejected: number; websitesChecked: number; permanentlyClosed: number; temporarilyClosed: number;
  noWebsite: number; outdatedWebsite: number; improvableWebsite: number; sourceFailures: number; exhausted: boolean; apiErrors: string[];
};
const terminal = new Set(["COMPLETE", "FAILED", "CANCELLED"]);

export function GenerationButton() {
  const router = useRouter(); const alive = useRef(true);
  const [pending, setPending] = useState(false); const [run, setRun] = useState<Run | null>(null); const [message, setMessage] = useState("");

  useEffect(() => {
    alive.current = true;
    (async () => {
      const response = await fetch("/api/generation", { cache: "no-store" });
      if (!response.ok || !alive.current) return;
      const data = await response.json();
      if (data.run && !terminal.has(data.run.status)) { setRun(data.run); setPending(true); await pollUntilFinished(); }
    })();
    return () => { alive.current = false; };
    // Alleen bij mount een bestaande job hervatten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pollUntilFinished() {
    while (alive.current) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const response = await fetch("/api/generation", { cache: "no-store" });
      if (!response.ok) continue;
      const data = await response.json(); const latest = data.run as Run | null;
      if (!latest || !alive.current) return;
      setRun(latest);
      if (terminal.has(latest.status)) { finish(latest); return; }
    }
  }

  function finish(latest: Run) {
    setPending(false);
    if (latest.status === "COMPLETE" && latest.stored >= latest.targetCount) setMessage(`${latest.stored} nieuwe, gecontroleerde leads toegevoegd.`);
    else if (latest.status === "COMPLETE") setMessage(`${latest.stored} geldige leads gevonden; bronnen of veilige looptijd waren uitgeput.`);
    else setMessage(latest.apiErrors?.at(-1) || "Leadgeneratie is gestopt. Probeer veilig opnieuw.");
    router.refresh();
  }

  async function generate() {
    setPending(true); setMessage(""); setRun(null);
    try {
      const response = await fetch("/api/generation", { method: "POST" }); const data = await response.json();
      if (data.run) setRun(data.run);
      if (!response.ok && response.status !== 409) { setPending(false); setMessage(data.error || "Leadgeneratie mislukt"); return; }
      await pollUntilFinished();
    } catch { setPending(false); setMessage("De verbinding met de leadgenerator is verbroken. Een serverjob kan nog doorlopen."); }
  }

  const progress = Math.min(100, ((run?.stored ?? 0) / (run?.targetCount ?? 50)) * 100);
  return <div className="generation-control">
    <button className="button button-primary" onClick={generate} disabled={pending} aria-busy={pending}>
      {pending ? <LoaderCircle className="animate-spin" size={15}/> : message ? <RotateCcw size={15}/> : <Plus size={15}/>}
      {pending ? "Leads controleren…" : message ? "Opnieuw genereren" : "Nieuwe leads genereren"}
    </button>
    {pending && <section className="generation-progress" aria-live="polite" aria-label="Voortgang leadgeneratie">
      <div className="generation-progress-head"><span>Gratis-first zoekrun</span><strong>{Math.round(progress)}%</strong></div>
      <div className="progress"><span style={{ width: `${progress}%` }}/></div>
      <div className="generation-metrics">
        <Metric label="Kandidaten gevonden" value={run?.candidatesFound ?? 0}/>
        <Metric label="Gecontroleerd" value={run?.candidatesChecked ?? 0}/>
        <Metric label="Websites gecontroleerd" value={run?.websitesChecked ?? 0}/>
        <Metric label="Duplicaten verwijderd" value={run?.duplicates ?? 0}/>
        <Metric label="Gesloten verwijderd" value={(run?.permanentlyClosed ?? 0) + (run?.temporarilyClosed ?? 0)}/>
        <Metric label="Opgeslagen" value={`${run?.stored ?? 0}/${run?.targetCount ?? 50}`} strong/>
      </div>
      <p className="generation-source-note">{run?.noWebsite ?? 0} zonder website · {(run?.outdatedWebsite ?? 0) + (run?.improvableWebsite ?? 0)} websitekansen · {run?.sourceFailures ?? 0} bronfouten</p>
    </section>}
    {message && <p className={message.includes("toegevoegd") ? "success-message" : "alert"} role="status">{message.includes("toegevoegd") && <CheckCircle2 size={15}/>} {message}</p>}
  </div>;
}

function Metric({ label, value, strong = false }: { label: string; value: number | string; strong?: boolean }) {
  return <div><span>{label}</span><strong className={strong ? "generation-total" : undefined}>{value}</strong></div>;
}
