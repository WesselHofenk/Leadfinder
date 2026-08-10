import { Clock3, MailCheck } from "lucide-react";

import type { getColdEmailTaskSnapshot } from "@/lib/jobs/outreach";

type Snapshot = Awaited<ReturnType<typeof getColdEmailTaskSnapshot>>;

export function ColdEmailTaskCard({ snapshot }: { snapshot: Snapshot }) {
  const { task } = snapshot;
  const active = task.enabled && task.status !== "ERROR";
  return <section className="generation-control generation-task-card" aria-label="Cold-emailtaakstatus">
    <div className="generation-task-head">
      <span className={`status-dot ${active ? "status-dot-active" : ""}`} aria-hidden="true"/>
      <div>
        <strong>{task.name}</strong>
        <span>{task.enabled ? `Status: ${task.status.toLowerCase()}` : "Status: inactief"}</span>
      </div>
      <MailCheck size={18}/>
    </div>
    <div className="generation-metrics automation-metrics">
      <Metric label="Vandaag" value={`${snapshot.sentToday}/${snapshot.dailyLimit}`}/>
      <Metric label="Weekniveau" value={`${snapshot.weekLevel} · ${snapshot.dailyLimit}/dag`}/>
      <Metric label="Volgende week" value={`${snapshot.nextWeekLimit}/dag`}/>
      <Metric label="Beschikbare leads" value={snapshot.availableLeads}/>
      <Metric label="Mislukt vandaag" value={snapshot.failedToday}/>
      <Metric label="Tijdsvenster" value={`${String(task.windowStartHour).padStart(2, "0")}:00–${String(task.windowEndHour).padStart(2, "0")}:00`}/>
    </div>
    <p className="generation-source-note"><Clock3 size={13}/> Volgende geplande verzending: {snapshot.nextScheduled}</p>
    <p className="generation-source-note">Laatste succesvolle verzending: {snapshot.lastSuccessfulSentAt ? snapshot.lastSuccessfulSentAt.toLocaleString("nl-NL", { timeZone: task.timeZone }) : "Nog niet beschikbaar"}</p>
    {task.lastError && <p className="alert" role="alert">{task.lastError}</p>}
  </section>;
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}
