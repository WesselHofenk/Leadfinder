"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus } from "lucide-react";

type Run = { status: string; targetCount: number; candidatesFound: number; candidatesChecked: number; stored: number; exhausted: boolean; apiErrors: string[] };

export function GenerationButton() {
  const router = useRouter(); const [pending, setPending] = useState(false); const [run, setRun] = useState<Run | null>(null); const [message, setMessage] = useState(""); const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  async function refreshProgress() { const response = await fetch("/api/generation", { cache: "no-store" }); if (response.ok) { const data = await response.json(); if (data.run) setRun(data.run); } }
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  async function generate() {
    setPending(true); setMessage(""); setRun(null); timer.current = setInterval(refreshProgress, 1200);
    try {
      const response = await fetch("/api/generation", { method: "POST" }); const data = await response.json();
      if (data.run) setRun(data.run);
      if (!response.ok) setMessage(data.error || "Leadgeneratie mislukt");
      else if (data.run.stored >= data.run.targetCount) setMessage(`${data.run.stored} nieuwe leads zonder website toegevoegd.`);
      else if (data.run.status === "COMPLETE") setMessage(`Er zijn ${data.run.stored} nieuwe geldige leads gevonden. De beschikbare zoekgebieden zijn uitgeput.`);
      else setMessage(data.run.apiErrors?.at(-1) || "Leadgeneratie mislukt");
      router.refresh();
    } catch { setMessage("De verbinding met de leadgenerator is verbroken."); }
    finally { setPending(false); if (timer.current) clearInterval(timer.current); timer.current = null; }
  }
  return <div className="generation-control"><button className="button button-primary" onClick={generate} disabled={pending}>{pending ? <LoaderCircle className="animate-spin" size={15}/> : <Plus size={15}/>}Nieuwe leads genereren</button>{pending && <div className="generation-progress" aria-live="polite"><div><span>Kandidaten gevonden</span><strong>{run?.candidatesFound ?? 0}</strong></div><div><span>Kandidaten gecontroleerd</span><strong>{run?.candidatesChecked ?? 0}</strong></div><div><span>Geldige leads gevonden</span><strong>{run?.stored ?? 0}/{run?.targetCount ?? 50}</strong></div><div className="progress"><span style={{ width: `${Math.min(100, ((run?.stored ?? 0) / (run?.targetCount ?? 50)) * 100)}%` }}/></div></div>}{message && <p className={message.includes("toegevoegd") ? "success-message" : "alert"} role="status">{message}</p>}</div>;
}
