"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  ExternalLink,
  LoaderCircle,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { getExportFile } from "@/lib/export/download";
import { generateNewOsmLeads, type SeenLeadKeys } from "@/lib/providers/openstreetmap-live";
import type { Lead } from "@/types/lead";

type VivoStatus = "Nieuw" | "Mail gestuurd (nog te bellen)" | "Gebeld";
type LocalLead = Lead & { vivoStatus: VivoStatus };
type Filters = { province: string; city: string; branch: string; status: string };
type StoredPipeline = SeenLeadKeys & { version: 1; leads: LocalLead[]; regionCursor: number };

const provinces = ["Noord-Holland", "Zuid-Holland", "Utrecht", "Noord-Brabant", "Gelderland", "Overijssel", "Groningen", "Friesland", "Drenthe", "Flevoland", "Limburg", "Zeeland"];
const emptyFilters: Filters = { province: "", city: "", branch: "", status: "" };
const STORAGE_KEY = "sitora-qualified-lead-pipeline-v1";
const LEGACY_KEYS = ["sitora-leadfinder-state-v2", "sitora-demo-state-v1", "sitora-reference-leadfinder-state-v1"];

function matches(lead: LocalLead, filters: Filters) {
  return (!filters.province || lead.province === filters.province)
    && (!filters.city || lead.city.toLowerCase().includes(filters.city.toLowerCase()))
    && (!filters.branch || lead.branch.toLowerCase().includes(filters.branch.toLowerCase()))
    && (!filters.status || lead.vivoStatus === filters.status);
}

function parseStoredPipeline(raw: string | null): StoredPipeline | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredPipeline>;
    if (value.version !== 1 || !Array.isArray(value.leads)) return null;
    return {
      version: 1,
      leads: value.leads,
      providerIds: Array.isArray(value.providerIds) ? value.providerIds : [],
      phoneKeys: Array.isArray(value.phoneKeys) ? value.phoneKeys : [],
      businessKeys: Array.isArray(value.businessKeys) ? value.businessKeys : [],
      regionCursor: typeof value.regionCursor === "number" ? value.regionCursor : 0,
    };
  } catch {
    return null;
  }
}

export function ReferenceLeadfinder() {
  const [leads, setLeads] = useState<LocalLead[]>([]);
  const [seen, setSeen] = useState<SeenLeadKeys>({ providerIds: [], phoneKeys: [], businessKeys: [] });
  const [regionCursor, setRegionCursor] = useState(0);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<LocalLead | null>(null);
  const [lastRunCount, setLastRunCount] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    const stored = parseStoredPipeline(localStorage.getItem(STORAGE_KEY));
    if (!stored) {
      LEGACY_KEYS.forEach(key => localStorage.removeItem(key));
      sessionStorage.removeItem("sitora-result-ids");
      localStorage.setItem("sitora-old-leads-cleared-v1", new Date().toISOString());
    }
    queueMicrotask(() => {
      if (stored) {
        setLeads(stored.leads);
        setSeen({ providerIds: stored.providerIds, phoneKeys: stored.phoneKeys, businessKeys: stored.businessKeys });
        setRegionCursor(stored.regionCursor);
      }
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    const stored: StoredPipeline = { version: 1, leads, ...seen, regionCursor };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  }, [leads, ready, regionCursor, seen]);

  const filtered = useMemo(() => leads.filter(lead => matches(lead, filters)).sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name, "nl");
    if (sort === "city") return a.city.localeCompare(b.city, "nl");
    if (sort === "branch") return a.branch.localeCompare(b.branch, "nl");
    return b.foundAt.localeCompare(a.foundAt);
  }), [leads, filters, sort]);

  const perPage = 10;
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const visible = filtered.slice((page - 1) * perPage, page * perPage);
  const hasFilters = Object.values(filters).some(Boolean);

  async function generate() {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const result = await generateNewOsmLeads({ targetCount: 20, regionCursor, seen, maxRegions: 4 });
      const newLeads = result.leads.map(lead => ({ ...lead, vivoStatus: "Nieuw" as const }));
      setLastRunCount(newLeads.length);
      setLeads(current => [...newLeads, ...current]);
      setSeen(current => ({
        providerIds: Array.from(new Set([...current.providerIds, ...result.examinedProviderIds])),
        phoneKeys: Array.from(new Set([...current.phoneKeys, ...result.acceptedPhoneKeys])),
        businessKeys: Array.from(new Set([...current.businessKeys, ...result.acceptedBusinessKeys])),
      }));
      setRegionCursor(result.nextRegionCursor);
      setDraft(emptyFilters);
      setFilters(emptyFilters);
      setPage(1);
      if (newLeads.length) {
        toast.success(`${newLeads.length} echt nieuwe leads toegevoegd`, { description: `${result.examinedProviderIds.length - newLeads.length} kandidaten zijn overgeslagen.` });
      } else {
        toast.info("Geen nieuwe geschikte bedrijven gevonden", { description: "De volgende klik zoekt automatisch verder in andere regio's." });
      }
    } catch (error) {
      toast.error("Leads genereren is nu niet gelukt", { description: error instanceof Error ? error.message : "De openbare bedrijfsbron is tijdelijk niet bereikbaar." });
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
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
    const text = filtered.map(lead => `${lead.name}\t${lead.city}\t${lead.phone || ""}`).join("\n");
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
          <p>Vind actieve, zelfstandige bedrijven zonder website en mét een vermeld telefoonnummer.</p>
        </div>
        <button onClick={generate} disabled={loading || !ready} className="vivo-generate">
          {loading ? <LoaderCircle className="spin" size={19} /> : <Sparkles size={19} />}
          {loading ? "Nieuwe bedrijven zoeken…" : "Nieuwe leads genereren"}
        </button>
      </header>

      <div className="tech-badges" aria-label="Selectievoorwaarden">
        <span>Bron: OpenStreetMap</span><span>Alleen zonder website</span><span>Telefoon verplicht</span><span>Grote ketens uitgesloten</span><span>Duplicaten geblokkeerd</span>
      </div>

      <div className="public-notice"><ShieldCheck size={17} /> Alleen kandidaten die alle controles doorstaan worden toegevoegd. Gegevens: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap-bijdragers</a>.</div>

      <section className="stat-grid" aria-label="Leadstatistieken">
        <Stat value={leads.length} label="Leads in pipeline" tone="dark" />
        <Stat value={lastRunCount} label="Laatste generatierun" tone="blue" />
        <Stat value={leads.length} label="Zonder website" tone="red" />
        <Stat value={leads.filter(lead => lead.phone).length} label="Met telefoonnummer" tone="orange" />
        <Stat value={seen.providerIds.length} label="Uniek gecontroleerd" tone="green" />
      </section>

      <form onSubmit={applyFilters} className="filter-panel">
        <div className="panel-title"><h2>Pipeline filteren</h2><button type="button" onClick={clearFilters}>Wissen</button></div>
        <div className="filter-grid">
          <Field label="Provincie"><select value={draft.province} onChange={event => setDraft({ ...draft, province: event.target.value })}><option value="">Alle provincies</option>{provinces.map(province => <option key={province}>{province}</option>)}</select></Field>
          <Field label="Plaats"><input value={draft.city} onChange={event => setDraft({ ...draft, city: event.target.value })} placeholder="bijv. Utrecht" /></Field>
          <Field label="Branche"><input value={draft.branch} onChange={event => setDraft({ ...draft, branch: event.target.value })} placeholder="bijv. Kapper" /></Field>
          <Field label="Status"><select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}><option value="">Alle statussen</option><option>Nieuw</option><option>Mail gestuurd (nog te bellen)</option><option>Gebeld</option></select></Field>
        </div>
        <button type="submit" className="apply-button"><Search size={16} /> Filters toepassen</button>
      </form>

      <section className="results-section">
        <div className="results-toolbar">
          <div><h2>{filtered.length} leads</h2><p>{hasFilters ? "Resultaten op basis van je filters" : "Nieuwe, gekwalificeerde bedrijven in je pipeline"}</p></div>
          <div className="toolbar-actions">
            <select aria-label="Resultaten sorteren" value={sort} onChange={event => setSort(event.target.value)}><option value="newest">Nieuwste eerst</option><option value="name">Bedrijfsnaam A–Z</option><option value="city">Plaats A–Z</option><option value="branch">Branche A–Z</option></select>
            <button onClick={() => exportFile("csv")} disabled={!filtered.length}><ArrowDownToLine size={15} /> CSV</button>
            <button onClick={() => exportFile("xls")} disabled={!filtered.length}><ArrowDownToLine size={15} /> Excel</button>
            <button onClick={copyAll} disabled={!filtered.length}><Clipboard size={15} /> Kopieer alles</button>
          </div>
        </div>

        {loading ? <LoadingRows /> : !filtered.length ? <div className="empty-state"><Search size={32} /><h3>{leads.length ? "Geen leads binnen deze filters" : "Je pipeline is leeg"}</h3><p>{leads.length ? "Wis of wijzig de filters om je leads te bekijken." : "Klik op ‘Nieuwe leads genereren’ voor uitsluitend nieuwe, gekwalificeerde bedrijven."}</p><button onClick={leads.length ? clearFilters : generate}><RefreshCw size={16} /> {leads.length ? "Filters wissen" : "Nieuwe leads genereren"}</button></div> : <>
          <div className="lead-table-wrap"><table className="lead-table"><thead><tr><th>Bedrijf</th><th>Locatie</th><th>Telefoon</th><th>Kwalificatie</th><th>Branche</th><th>Status</th><th><span className="sr-only">Acties</span></th></tr></thead><tbody>{visible.map(lead => <LeadRow key={lead.id} lead={lead} onOpen={() => setSelected(lead)} onStatus={value => updateStatus(lead.id, value)} />)}</tbody></table></div>
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

function QualificationBadge() { return <span className="website-score score-success"><Check size={11} /> Goedgekeurd</span>; }

function LeadRow({ lead, onOpen, onStatus }: { lead: LocalLead; onOpen: () => void; onStatus: (value: VivoStatus) => void }) {
  return <tr><td><button className="company-link" onClick={onOpen}>{lead.name}</button><small>OpenStreetMap-ID: {lead.id.replace("osm-", "")}</small></td><td><span className="cell-icon"><MapPin size={14} />{lead.city}</span><small>{lead.province}</small></td><td>{lead.phone && <a href={`tel:${lead.phone}`}><Phone size={14} />{lead.phone}</a>}</td><td><QualificationBadge /><small>Geen website · geen groot ketensignaal</small></td><td>{lead.branch}</td><td><select aria-label={`Status van ${lead.name}`} value={lead.vivoStatus} onChange={event => onStatus(event.target.value as VivoStatus)}><option>Nieuw</option><option>Mail gestuurd (nog te bellen)</option><option>Gebeld</option></select></td><td><button className="details-button" onClick={onOpen}>Details <ExternalLink size={14} /></button></td></tr>;
}

function LeadCard({ lead, onOpen, onStatus }: { lead: LocalLead; onOpen: () => void; onStatus: (value: VivoStatus) => void }) {
  return <article className="lead-card"><div className="lead-card-head"><div><button onClick={onOpen}>{lead.name}</button><p>{lead.branch} · {lead.city}</p></div><QualificationBadge /></div><div className="lead-card-meta"><span><Check size={14} />Geen website</span>{lead.phone && <a href={`tel:${lead.phone}`}><Phone size={14} />{lead.phone}</a>}</div><div className="lead-card-actions"><select aria-label={`Status van ${lead.name}`} value={lead.vivoStatus} onChange={event => onStatus(event.target.value as VivoStatus)}><option>Nieuw</option><option>Mail gestuurd (nog te bellen)</option><option>Gebeld</option></select><button onClick={onOpen}>Details</button></div></article>;
}

function LeadDialog({ lead, onClose, onStatus }: { lead: LocalLead; onClose: () => void; onStatus: (value: VivoStatus) => void }) {
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}><section role="dialog" aria-modal="true" aria-labelledby="lead-title" className="lead-dialog"><button className="dialog-close" aria-label="Sluiten" onClick={onClose}><X size={20} /></button><div className="dialog-icon"><Building2 size={24} /></div><p className="dialog-eyebrow">{lead.branch}</p><h2 id="lead-title">{lead.name}</h2><p className="dialog-description">{lead.description}</p><div className="dialog-grid"><div><span>Adres</span><b>{lead.address}{lead.postalCode ? `, ${lead.postalCode}` : ""} {lead.city}</b></div><div><span>Telefoon</span><b>{lead.phone}</b></div><div><span>Selectie</span><b className="score-success">Geen website vermeld</b></div><div><span>Status</span><select value={lead.vivoStatus} onChange={event => onStatus(event.target.value as VivoStatus)}><option>Nieuw</option><option>Mail gestuurd (nog te bellen)</option><option>Gebeld</option></select></div></div><div className="dialog-links">{lead.phone && <a href={`tel:${lead.phone}`}><Phone size={17} />{lead.phone}</a>}<a href={lead.mapsUrl} target="_blank" rel="noreferrer"><MapPin size={17} />Bronvermelding openen</a></div><div className="public-notice" style={{ marginTop: 16 }}><Check size={16} /> Geen websiteveld, een bronvermeld telefoonnummer en geen groot franchise- of sluitingssignaal gevonden.</div><button className="dialog-done" onClick={onClose}>Sluiten</button></section></div>;
}

function LoadingRows() { return <div className="loading-list" aria-label="Nieuwe bedrijven controleren"><div /><div /><div /><div /></div>; }
