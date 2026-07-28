"use client";

import { useState } from "react";
import { LoaderCircle, RadioTower } from "lucide-react";

type Probe = { endpoint: string; ok: boolean; durationMs: number; validJson: boolean; error?: string };

export function SourceHealthProbe() {
  const [running, setRunning] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [probes, setProbes] = useState<Probe[]>([]);
  const [error, setError] = useState("");

  async function runProbe() {
    setRunning(true);
    setError("");
    try {
      const response = await fetch("/api/admin/source-health/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "De bronprobe is mislukt.");
      setCheckedAt(data.checkedAt);
      setProbes(data.probes ?? []);
    } catch (probeError) {
      setError(probeError instanceof Error ? probeError.message : "De bronprobe is mislukt.");
    } finally {
      setRunning(false);
    }
  }

  return <section className="card card-pad admin-section">
    <div>
      <h2>Vercel-broncontrole</h2>
      <p className="small muted">Test de ingestelde Overpass-hosts vanuit productie en werk de duurzame circuitbreaker bij.</p>
    </div>
    <button className="button button-secondary" type="button" onClick={runProbe} disabled={running}>
      {running ? <LoaderCircle className="animate-spin" size={15}/> : <RadioTower size={15}/>}
      {running ? "Bronhosts controleren…" : "Bronhosts controleren"}
    </button>
    {checkedAt && <p className="small muted">Gecontroleerd op {new Date(checkedAt).toLocaleString("nl-NL")} vanuit Vercel.</p>}
    {error && <p className="alert" role="alert">{error}</p>}
    {probes.length > 0 && <div className="table-scroll"><table>
      <thead><tr><th>Host</th><th>Resultaat</th><th>Reactietijd</th><th>JSON</th></tr></thead>
      <tbody>{probes.map((probe) => <tr key={probe.endpoint}>
        <td>{new URL(probe.endpoint).host}</td>
        <td>{probe.ok ? "Werkend" : probe.error || "Niet bereikbaar"}</td>
        <td>{probe.durationMs} ms</td>
        <td>{probe.validJson ? "Geldig" : "Ongeldig/geen response"}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
