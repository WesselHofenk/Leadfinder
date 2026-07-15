"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, LoaderCircle, Plus, RotateCcw, Square } from "lucide-react";

type Run = {
  id:string; status:string; targetCount:number; candidatesFound:number; candidatesChecked:number; stored:number; manualReview:number; duplicates:number; rejected:number;
  websitesChecked:number; permanentlyClosed:number; temporarilyClosed:number; noWebsite:number; sourceFailures:number; exhausted:boolean;
  apiErrors:string[]; warnings:string[]; currentPhase:string; currentSource?:string; currentRegion?:string; stopReason?:string;
};
const terminal=new Set(["COMPLETE","FAILED","CANCELLED"]);

export function GenerationButton(){
  const router=useRouter();const alive=useRef(true);const polling=useRef(false);
  const[pending,setPending]=useState(false);const[run,setRun]=useState<Run|null>(null);const[message,setMessage]=useState("");
  const finish=useCallback((latest:Run)=>{setPending(false);setMessage(latest.status==="COMPLETE"?`${latest.stored} Google-bevestigde leads, ${latest.manualReview} kandidaten wachten op controle. ${latest.stopReason||"De zoekrun is afgerond."}`:latest.status==="CANCELLED"?latest.stopReason||"Zoekrun geannuleerd.":latest.apiErrors?.at(-1)||latest.stopReason||"Leadgeneratie is gestopt.");router.refresh();},[router]);
  const pollUntilFinished=useCallback(async()=>{if(polling.current)return;polling.current=true;try{while(alive.current){await new Promise((resolve)=>setTimeout(resolve,1200));const response=await fetch("/api/generation",{cache:"no-store"});if(!response.ok)continue;const data=await response.json();const latest=data.run as Run|null;if(!latest||!alive.current)return;setRun(latest);if(terminal.has(latest.status)){finish(latest);return;}}}finally{polling.current=false;}},[finish]);
  useEffect(()=>{alive.current=true;void(async()=>{const response=await fetch("/api/generation",{cache:"no-store"});if(!response.ok||!alive.current)return;const data=await response.json();if(data.run&&!terminal.has(data.run.status)){setRun(data.run);setPending(true);void pollUntilFinished();}})();return()=>{alive.current=false;};},[pollUntilFinished]);
  async function generate(){setPending(true);setMessage("");setRun(null);try{const response=await fetch("/api/generation",{method:"POST"});const data=await response.json();if(data.run)setRun(data.run);if(!response.ok&&response.status!==409){setPending(false);setMessage(data.error||"Leadgeneratie mislukt");return;}void pollUntilFinished();}catch{setPending(false);setMessage("De lokale serververbinding is verbroken; controleer de terminal.");}}
  async function cancel(){await fetch("/api/generation",{method:"DELETE"});setMessage("Annuleren aangevraagd; de huidige veilige controle wordt afgerond.");}
  const progress=Math.min(100,(((run?.stored??0)+(run?.manualReview??0))/(run?.targetCount??50))*100);
  return <div className="generation-control"><button className="button button-primary" onClick={generate} disabled={pending} aria-busy={pending}>{pending?<LoaderCircle className="animate-spin" size={15}/>:message?<RotateCcw size={15}/>:<Plus size={15}/>} {pending?"Leads controleren…":message?"Opnieuw genereren":"Nieuwe leads genereren"}</button>{pending&&<section className="generation-progress" aria-live="polite" aria-label="Voortgang leadgeneratie"><div className="generation-progress-head"><span>{run?.currentPhase||"Voorbereiden"}</span><strong>{Math.round(progress)}%</strong></div><div className="progress"><span style={{width:`${progress}%`}}/></div><p className="generation-source-note">{[run?.currentSource,run?.currentRegion].filter(Boolean).join(" · ")||"Lokale job wordt voorbereid"}</p><div className="generation-metrics"><Metric label="Kandidaten" value={run?.candidatesFound??0}/><Metric label="Gecontroleerd" value={run?.candidatesChecked??0}/><Metric label="Websites" value={run?.websitesChecked??0}/><Metric label="Duplicaten" value={run?.duplicates??0}/><Metric label="Google-controle" value={run?.manualReview??0}/><Metric label="Bevestigd" value={`${run?.stored??0}/${run?.targetCount??50}`} strong/></div><p className="generation-source-note">Alleen handmatig via Google bevestigde bedrijven worden actieve leads · {run?.sourceFailures??0} bronfouten</p><button className="button button-secondary generation-cancel" onClick={cancel}><Square size={13}/>Zoekrun annuleren</button></section>}{message&&<p className={run?.status==="COMPLETE"?"success-message":"alert"} role="status">{run?.status==="COMPLETE"&&<CheckCircle2 size={15}/>} {message}</p>}</div>;
}
function Metric({label,value,strong=false}:{label:string;value:number|string;strong?:boolean}){return <div><span>{label}</span><strong className={strong?"generation-total":undefined}>{value}</strong></div>;}
