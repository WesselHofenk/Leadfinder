"use client";

import { useState } from "react";
import { MapPinned } from "lucide-react";

export function CoveragePriorityManager() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function update(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    const response = await fetch("/api/admin/coverage-priority", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    setMessage(response.ok ? `${result.updated} zoekcombinaties bijgewerkt.` : result.error || "Bijwerken mislukt.");
    setPending(false);
  }

  return <section className="card card-pad">
    <h2>Zoekgebiedprioriteit</h2>
    <p className="small muted">Een lager getal krijgt binnen de adaptieve selectie eerder capaciteit.</p>
    <form onSubmit={update} className="filter-grid" style={{ gridTemplateColumns: "120px 1fr 150px auto", marginTop: 16 }}>
      <select className="select" name="country" aria-label="Land"><option value="NL">Nederland</option><option value="BE">België</option></select>
      <input className="input" name="city" aria-label="Plaats" placeholder="Bijv. Amersfoort" required />
      <input className="input" name="priority" aria-label="Prioriteit" type="number" min={1} max={999} defaultValue={100} required />
      <button className="button button-secondary" disabled={pending}><MapPinned size={14} />Bijwerken</button>
    </form>
    {message && <p className="small muted" role="status" style={{ marginTop: 10 }}>{message}</p>}
  </section>;
}

