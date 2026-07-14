"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  ExternalLink,
  LoaderCircle,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { demoLeads } from "@/lib/demo/leads";
import { getExportFile } from "@/lib/export/download";
import type { Lead } from "@/types/lead";

type VivoStatus = "Nieuw" | "Mail gestuurd (nog te bellen)" | "Gebeld";
type LocalLead = Lead & { employees: number; vivoStatus: VivoStatus; staleWebsite: boolean };
type Filters = {
  province: string;
  city: string;
  branch: string;
  status: string;
  minScore: string;
  minEmployees: string;
  maxEmployees: string;
  noWebsite: boolean;
  staleWebsite: boolean;
  hasEmail: boolean;
};

const provinces = ["Noord-Holland", "Zuid-Holland", "Utrecht", "Noord-Brabant", "Gelderland", "Overijssel", "Groningen", "Friesland", "Drenthe", "Flevoland", "Limburg", "Zeeland"];
const emptyFilters: Filters = { province: "", city: "", branch: "", status: "", minScore: "", minEmployees: "", maxEmployees: "", noWebsite: false, staleWebsite: false, hasEmail: false };

const allLeads: LocalLead[] = Array.from({ length: 50 }, (_, index) => {
  const source = demoLeads[index % demoLeads.length];
  const cycle = Math.floor(index / demoLeads.length);
  const status: VivoStatus = index % 7 === 0 ? "Gebeld" : index % 5 === 0 ? "Mail gestuurd (nog te bellen)" : "Nieuw";
  return {
    ...source,
    id: `vivo-${index + 1}`,
    name: cycle ? `${source.name} Noord` : source.name,
    employees: 2 + ((index * 7) % 63),
    vivoStatus: status,
    staleWebsite: Boolean(source.website) && source.websiteScore < 60,
  };
});

function matches(lead: LocalLead, filters: Filters) {
  const minScore = Number(filters.minScore || 0);
  const minEmployees = Number(filters.minEmployees || 0);
  const maxEmployees = Number(filters.maxEmployees || Infinity);
  return (!filters.province || lead.province === filters.province)
    && (!filters.city || lead.city.toLowerCase().includes(filters.city.toLowerCase()))
    && (!filters.branch || lead.branch.toLowerCase().includes(filters.branch.toLowerCase()))
    && (!filters.status || lead.vivoStatus === filters.status)
    && lead.websiteScore >= minScore
    && lead.employees >= minEmployees
    && lead.employees <= maxEmployees
    && (!filters.noWebsite || !lead.website)
    && (!filters.staleWebsite || lead.staleWebsite)
    && (!filters.hasEmail || Boolean(lead.email));
}

function websiteLabel(lead: LocalLead) {
  if (!lead.website) return { label: "Geen website", className: "score-danger" };
  if (lead.staleWebsite) return { label: `${lead.websiteScore}/100`, className: "score-warning" };
  return { label: `${lead.websiteScore}/100`, className: "score-success" };
}

export function ReferenceLeadfinder() {
  const [leads, setLeads] = useState<LocalLead[]>(allLeads);
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<LocalLead | null>(null);

  const filtered = useMemo(() => leads.filter(lead => matches(lead, filters)).sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "score") return a.websiteScore - b.websiteScore;
    if (sort === "employees") return b.employees - a.employees;
    return b.foundAt.localeCompare(a.foundAt);
  }), [leads, filters, sort]);

  const perPage = 10;
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const visible = filtered.slice((page - 1) * perPage, page * perPage);
  const withoutWebsite = leads.filter(lead => !lead.website).length;
  const stale = leads.filter(lead => lead.staleWebsite).length;
  const average = leads.length ? Math.round(leads.reduce((sum, lead) => sum + lead.websiteScore, 0) / leads.length) : 0;

  function generate() {
    setLoading(true);
    window.setTimeout(() => {
      setLeads(allLeads.map((lead, index) => ({ ...lead, foundAt: new Date(Date.now() - index * 3600000).toISOString() })));
      setDraft(emptyFilters);
      setFilters(emptyFilters);
      setPage(1);
      setLoading(false);
      toast.success("50 nieuwe leads gegenereerd");
    }, 650);
  }

  function applyFilters(event: React.FormEvent) {
    event.preventDefault();
    setFilters(draft);
    setPage(1);
    toast.success("Filters toegepast");
  }

  function clearFilters() {
    setDraft(emptyFilters);
    setFilters(emptyFilters);
    setPage(1);
  }

  async function copyAll() {
    const text = filtered.map(lead => `${lead.name}\t${lead.city}\t${lead.email || ""}\t${lead.phone || ""}`).join("\n");
    await navigator.clipboard.writeText(text);
    toast.success(`${filtered.length} leads gekopieerd`);
  }

  function exportFile(format: "csv" | "xls") {
    const file = getExportFile(filtered, format);
    const anchor = document.createElement("a");
    anchor.href = file.href;
    anchor.download = format === "xls" ? "leads.xlsx" : "leads.csv";
    anchor.click();
    toast.success(`${format === "xls" ? "Excel" : "CSV"}-bestand aangemaakt`);
  }

  function updateStatus(id: string, vivoStatus: VivoStatus) {
    setLeads(current => current.map(lead => lead.id === id ? { ...lead, vivoStatus } : lead));
    if (selected?.id === id) setSelected({ ...selected, vivoStatus });
  }

  return <main id="main" className="vivo-page">
    <div className="vivo-container">
      <header className="vivo-header">
        <div>
          <h1>LeadfinderSitora<span>.nl</span></h1>
          <p>Vind bedrijven zonder of met een verouderde website — kansen voor webdesign.</p>
        </div>
        <button onClick={generate} disabled={loading} className="vivo-generate">
          {loading ? <LoaderCircle className="spin" size={19} /> : <Sparkles size={19} />}
          {loading ? "Leads genereren…" : "Genereer 50 Leads"}
        </button>
      </header>

      <div className="tech-badges" aria-label="Systeeminformatie">
        <span>Bron: openstreetmap</span><span>Opslag: lokaal</span><span>Queue: inline</span><span>AI: demo</span>
      </div>

      <div className="public-notice"><Check size={17} /> Openbare demo — geen account of login nodig</div>

      <section className="stat-grid" aria-label="Leadstatistieken">
        <Stat value={leads.length} label="Totaal gevonden leads" tone="dark" />
        <Stat value={leads.filter(l => Date.now() - new Date(l.foundAt).getTime() < 86400000).length} label="Nieuwe leads vandaag" tone="blue" />
        <Stat value={withoutWebsite} label="Zonder website" tone="red" />
        <Stat value={stale} label="Zwakke website" tone="orange" />
        <Stat value={`${average}/100`} label="Gem. websitescore" tone="green" />
      </section>

      <form onSubmit={applyFilters} className="filter-panel">
        <div className="panel-title"><h2>Filters</h2><button type="button" onClick={clearFilters}>Wissen</button></div>
        <div className="filter-grid">
          <Field label="Provincie"><select value={draft.province} onChange={e => setDraft({ ...draft, province: e.target.value })}><option value="">Alle provincies</option>{provinces.map(province => <option key={province}>{province}</option>)}</select></Field>
          <Field label="Plaats"><input value={draft.city} onChange={e => setDraft({ ...draft, city: e.target.value })} placeholder="bv. Utrecht" /></Field>
          <Field label="Branche"><input value={draft.branch} onChange={e => setDraft({ ...draft, branch: e.target.value })} placeholder="bv. Kapper" /></Field>
          <Field label="Status"><select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}><option value="">Alle statussen</option><option>Nieuw</option><option>Mail gestuurd (nog te bellen)</option><option>Gebeld</option></select></Field>
          <Field label="Min. websitescore"><input type="number" min="0" max="100" value={draft.minScore} onChange={e => setDraft({ ...draft, minScore: e.target.value })} /></Field>
          <Field label="Min. werknemers"><input type="number" min="0" value={draft.minEmployees} onChange={e => setDraft({ ...draft, minEmployees: e.target.value })} /></Field>
          <Field label="Max. werknemers"><input type="number" min="0" value={draft.maxEmployees} onChange={e => setDraft({ ...draft, maxEmployees: e.target.value })} /></Field>
          <div className="check-stack"><Checkbox label="Alleen zonder website" checked={draft.noWebsite} onChange={value => setDraft({ ...draft, noWebsite: value, staleWebsite: value ? false : draft.staleWebsite })} /><Checkbox label="Alleen verouderde website" checked={draft.staleWebsite} onChange={value => setDraft({ ...draft, staleWebsite: value, noWebsite: value ? false : draft.noWebsite })} /></div>
          <Checkbox label="Alleen met e-mailadres" checked={draft.hasEmail} onChange={value => setDraft({ ...draft, hasEmail: value })} />
        </div>
        <button type="submit" className="apply-button"><Search size={16} /> Filters toepassen</button>
      </form>

      <section className="results-section">
        <div className="results-toolbar">
          <div><h2>{filtered.length} leads</h2><p>{filters === emptyFilters ? "Alle gevonden bedrijven" : "Resultaten op basis van je filters"}</p></div>
          <div className="toolbar-actions">
            <select aria-label="Resultaten sorteren" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Nieuwste eerst</option><option value="name">Bedrijfsnaam A–Z</option><option value="score">Laagste websitescore</option><option value="employees">Meeste werknemers</option></select>
            <button onClick={() => exportFile("csv")} disabled={!filtered.length}><ArrowDownToLine size={15} /> CSV</button>
            <button onClick={() => exportFile("xls")} disabled={!filtered.length}><ArrowDownToLine size={15} /> Excel</button>
            <button onClick={copyAll} disabled={!filtered.length}><Clipboard size={15} /> Kopieer alles</button>
          </div>
        </div>

        {loading ? <LoadingRows /> : !filtered.length ? <div className="empty-state"><Search size={32} /><h3>Geen leads gevonden</h3><p>Pas je filters aan of genereer een nieuwe set leads.</p><button onClick={clearFilters}><RefreshCw size={16} /> Filters wissen</button></div> : <>
          <div className="lead-table-wrap"><table className="lead-table"><thead><tr><th>Bedrijf</th><th>Locatie</th><th>Contact</th><th>Website</th><th>Werknemers</th><th>Status</th><th><span className="sr-only">Acties</span></th></tr></thead><tbody>{visible.map(lead => <LeadRow key={lead.id} lead={lead} onOpen={() => setSelected(lead)} onStatus={value => updateStatus(lead.id, value)} />)}</tbody></table></div>
          <div className="lead-cards">{visible.map(lead => <LeadCard key={lead.id} lead={lead} onOpen={() => setSelected(lead)} onStatus={value => updateStatus(lead.id, value)} />)}</div>
          <nav className="pagination" aria-label="Paginering"><span>{(page - 1) * perPage + 1}–{Math.min(page * perPage, filtered.length)} van {filtered.length}</span><div><button aria-label="Vorige pagina" disabled={page === 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={17} /></button><b>{page} / {pages}</b><button aria-label="Volgende pagina" disabled={page === pages} onClick={() => setPage(value => value + 1)}><ChevronRight size={17} /></button></div></nav>
        </>}
      </section>
    </div>
    {selected && <LeadDialog lead={selected} onClose={() => setSelected(null)} onStatus={value => updateStatus(selected.id, value)} />}
  </main>;
}

function Stat({ value, label, tone }: { value: string | number; label: string; tone: string }) { return <article className={`stat-card stat-${tone}`}><strong>{value}</strong><span>{label}</span></article>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="filter-field"><span>{label}</span>{children}</label>; }
function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="filter-check"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /><span>{label}</span></label>; }

function LeadRow({ lead, onOpen, onStatus }: { lead: LocalLead; onOpen: () => void; onStatus: (value: VivoStatus) => void }) {
  const score = websiteLabel(lead);
  return <tr><td><button className="company-link" onClick={onOpen}>{lead.name}</button><small>{lead.branch}</small></td><td><span className="cell-icon"><MapPin size={14} />{lead.city}</span><small>{lead.province}</small></td><td>{lead.email && <a href={`mailto:${lead.email}`}><Mail size={14} />{lead.email}</a>}{lead.phone && <a href={`tel:${lead.phone}`}><Phone size={14} />{lead.phone}</a>}</td><td><span className={`website-score ${score.className}`}>{score.label}</span></td><td><span className="cell-icon"><Users size={14} />{lead.employees}</span></td><td><select aria-label={`Status van ${lead.name}`} value={lead.vivoStatus} onChange={e => onStatus(e.target.value as VivoStatus)}><option>Nieuw</option><option>Mail gestuurd (nog te bellen)</option><option>Gebeld</option></select></td><td><button className="details-button" onClick={onOpen}>Details <ExternalLink size={14} /></button></td></tr>;
}

function LeadCard({ lead, onOpen, onStatus }: { lead: LocalLead; onOpen: () => void; onStatus: (value: VivoStatus) => void }) {
  const score = websiteLabel(lead);
  return <article className="lead-card"><div className="lead-card-head"><div><button onClick={onOpen}>{lead.name}</button><p>{lead.branch} · {lead.city}</p></div><span className={`website-score ${score.className}`}>{score.label}</span></div><div className="lead-card-meta"><span><Users size={14} />{lead.employees} werknemers</span>{lead.email && <a href={`mailto:${lead.email}`}><Mail size={14} />E-mail</a>}{lead.phone && <a href={`tel:${lead.phone}`}><Phone size={14} />Bellen</a>}</div><div className="lead-card-actions"><select aria-label={`Status van ${lead.name}`} value={lead.vivoStatus} onChange={e => onStatus(e.target.value as VivoStatus)}><option>Nieuw</option><option>Mail gestuurd (nog te bellen)</option><option>Gebeld</option></select><button onClick={onOpen}>Details</button></div></article>;
}

function LeadDialog({ lead, onClose, onStatus }: { lead: LocalLead; onClose: () => void; onStatus: (value: VivoStatus) => void }) {
  const score = websiteLabel(lead);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}><section role="dialog" aria-modal="true" aria-labelledby="lead-title" className="lead-dialog"><button className="dialog-close" aria-label="Sluiten" onClick={onClose}><X size={20} /></button><div className="dialog-icon"><Building2 size={24} /></div><p className="dialog-eyebrow">{lead.branch}</p><h2 id="lead-title">{lead.name}</h2><p className="dialog-description">{lead.description}</p><div className="dialog-grid"><div><span>Adres</span><b>{lead.address}, {lead.postalCode} {lead.city}</b></div><div><span>Werknemers</span><b>{lead.employees}</b></div><div><span>Website</span><b className={score.className}>{score.label}</b></div><div><span>Status</span><select value={lead.vivoStatus} onChange={e => onStatus(e.target.value as VivoStatus)}><option>Nieuw</option><option>Mail gestuurd (nog te bellen)</option><option>Gebeld</option></select></div></div><div className="dialog-links">{lead.email && <a href={`mailto:${lead.email}`}><Mail size={17} />{lead.email}</a>}{lead.phone && <a href={`tel:${lead.phone}`}><Phone size={17} />{lead.phone}</a>}{lead.website && <a href={lead.website} target="_blank" rel="noreferrer"><ExternalLink size={17} />Website openen</a>}</div><button className="dialog-done" onClick={onClose}>Sluiten</button></section></div>;
}

function LoadingRows() { return <div className="loading-list" aria-label="Leads laden"><div /><div /><div /><div /></div>; }
