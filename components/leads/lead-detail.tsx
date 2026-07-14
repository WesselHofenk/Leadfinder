"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  Check,
  Clock3,
  ExternalLink,
  Globe2,
  LoaderCircle,
  Mail,
  MapPin,
  MessageSquareText,
  Phone,
  Save,
  ShieldAlert,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useAppStore } from "@/components/app-store";
import { LEAD_STATUSES, type AuditResult, type LeadStatus } from "@/types/lead";
import { websiteQualityLabel } from "@/lib/scoring/lead-score";

const staticExport = process.env.NEXT_PUBLIC_STATIC_EXPORT === "true";
const formatDateTime = (value: string) => {
  const [date, time] = new Date(value).toISOString().split("T");
  const [year, month, day] = date.split("-");
  return `${day}-${month}-${year} ${time.slice(0, 5)} UTC`;
};
export function LeadDetail({ id }: { id: string }) {
  const router = useRouter();
  const {
      leads,
      savedIds,
      toggleSave,
      updateLead,
      setStatus,
      addTag,
      deleteLeads,
    } = useAppStore(),
    found = leads.find((l) => l.id === id);
  const [audit, setAudit] = useState<AuditResult | null>(null),
    [auditing, setAuditing] = useState(false),
    [tone, setTone] = useState("Professioneel en direct"),
    [service, setService] = useState("een modernere website"),
    [draft, setDraft] = useState("");
  if (!found)
    return (
      <div className="card p-8 text-center">
        <h1 className="font-bold">Lead niet gevonden</h1>
        <Link href="/leads" className="btn btn-secondary mt-4">
          Terug naar leads
        </Link>
      </div>
    );
  const lead = found;
  async function runAudit() {
    if (!lead?.website || staticExport) return;
    setAuditing(true);
    const res = await fetch("/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: lead.website }),
    });
    const d = await res.json();
    if (res.ok) {
      setAudit(d);
      toast.success("Website-audit voltooid");
    } else toast.error(d.error);
    setAuditing(false);
  }
  function generate() {
    const issue = !lead.website
      ? "dat er nog geen website zichtbaar is"
      : lead.websiteScore < 40
        ? "dat de huidige website technisch en inhoudelijk kansen laat liggen"
        : "dat de online presentatie scherper kan aansluiten op de kwaliteit van het bedrijf";
    setDraft(
      `Onderwerp: Een concrete online kans voor ${lead.name}\n\nGoedendag,\n\nTijdens mijn oriëntatie op ${lead.branch.toLowerCase()} in ${lead.city} viel ${lead.name} positief op. Tegelijk zag ik ${issue}.\n\nIk help Nederlandse bedrijven met ${service}, zonder ingewikkeld traject. Ik laat graag vrijblijvend in 15 minuten zien welke drie verbeteringen bij jullie de meeste impact kunnen maken.\n\nZou een korte kennismaking volgende week passen?\n\nMet vriendelijke groet,\n[Naam]\n[Bedrijf]\n\nGeen interesse? Laat het gerust weten; dan neem ik geen contact meer op.`,
    );
  }
  const saved = savedIds.includes(id);
  return (
    <>
      <Link
        href="/leads"
        className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-[#a95022]"
      >
        <ArrowLeft size={16} />
        Terug naar opgeslagen leads
      </Link>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge">{lead.branch}</span>
            <span className="badge">Bron: {lead.source}</span>
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-[-.04em]">
            {lead.name}
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
            <MapPin size={15} />
            {lead.address}, {lead.postalCode} {lead.city}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Leadstatus"
            value={lead.status}
            onChange={(e) => setStatus([id], e.target.value as LeadStatus)}
            className="input w-auto font-semibold"
          >
            {LEAD_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button
            onClick={() => {
              toggleSave(id);
              toast.success(
                saved ? "Verwijderd uit opgeslagen leads" : "Lead opgeslagen",
              );
            }}
            className={`btn pressable ${saved ? "btn-primary" : "btn-secondary"}`}
          >
            <Save size={17} />
            {saved ? "Opgeslagen" : "Opslaan"}
          </button>
          <button
            onClick={() => {
              if (
                window.confirm(
                  "Weet je zeker dat je deze lead wilt verwijderen?",
                )
              ) {
                deleteLeads([id]);
                toast.success("Lead verwijderd");
                router.push("/leads");
              }
            }}
            className="btn pressable border-red-200 bg-red-50 text-red-700"
          >
            <Trash2 size={17} />
            Verwijderen
          </button>
        </div>
      </div>
      <div className="mt-6 grid gap-5 xl:grid-cols-[1.5fr_.8fr]">
        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="font-bold">Bedrijfsinformatie</h2>
            <p className="mt-2 text-sm text-slate-600">{lead.description}</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {(
                [
                  [
                    Phone,
                    lead.phone,
                    "Telefoon",
                    lead.phone ? `tel:${lead.phone}` : undefined,
                    lead.verification.phone,
                  ],
                  [
                    Mail,
                    lead.email,
                    "E-mail",
                    lead.email ? `mailto:${lead.email}` : undefined,
                    lead.verification.email,
                  ],
                  [
                    Globe2,
                    lead.website,
                    "Website",
                    lead.website,
                    lead.verification.website,
                  ],
                  [
                    MapPin,
                    "Open in Google Maps",
                    "Kaart",
                    lead.mapsUrl,
                    "openbare bron",
                  ],
                ] as const
              ).map(([Icon, value, label, href, verification]) => (
                <div
                  key={String(label)}
                  className="rounded-xl border border-slate-200 p-4"
                >
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.08em] text-slate-400">
                    <Icon size={15} />
                    {label}
                  </div>
                  {href ? (
                    <a
                      href={String(href)}
                      target={
                        String(href).startsWith("http") ? "_blank" : undefined
                      }
                      rel="noreferrer"
                      className="mt-2 flex items-center gap-1 break-all text-sm font-bold text-[#8f461f] hover:underline"
                    >
                      {value || "Openen"}
                      <ExternalLink size={13} />
                    </a>
                  ) : (
                    <p className="mt-2 text-sm text-slate-400">
                      Niet beschikbaar
                    </p>
                  )}
                  <span className="mt-2 block text-[11px] text-slate-400">
                    Verificatie: {String(verification)}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section className="card p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-bold">Website-audit</h2>
                <p className="text-sm text-slate-500">
                  {staticExport
                    ? "Niet beschikbaar op de statische demo."
                    : "Hoofdpagina, maximaal enkele veilige controles."}
                </p>
              </div>
              <button
                disabled={!lead.website || auditing || staticExport}
                onClick={runAudit}
                className="btn btn-secondary pressable disabled:opacity-50"
              >
                {auditing ? (
                  <LoaderCircle size={17} className="animate-spin" />
                ) : (
                  <Globe2 size={17} />
                )}{" "}
                {audit ? "Opnieuw controleren" : "Audit uitvoeren"}
              </button>
            </div>
            {staticExport ? (
              <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                De live GitHub Pages-versie voert geen server-side
                websiteverzoeken uit.
              </div>
            ) : !lead.website ? (
              <div className="mt-5 rounded-xl bg-orange-50 p-4 text-sm text-orange-800">
                Geen website gevonden; dit is een directe webdesignkans.
              </div>
            ) : audit ? (
              <div className="mt-5">
                <div className="mb-4 flex items-center gap-4 rounded-xl bg-slate-50 p-4">
                  <span className="grid h-14 w-14 place-items-center rounded-full bg-[#142644] text-lg font-bold text-white">
                    {audit.score}
                  </span>
                  <div>
                    <p className="font-bold">
                      {websiteQualityLabel(audit.score)} websitekwaliteit
                    </p>
                    <p className="text-xs text-slate-500">
                      {audit.responseTimeMs} ms · gecontroleerd{" "}
                      {formatDateTime(audit.checkedAt)}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {Object.entries({
                    HTTPS: audit.https,
                    "Mobiele viewport": audit.viewport,
                    Paginatitel: audit.title,
                    "Meta description": audit.metaDescription,
                    Favicon: audit.favicon,
                    "Social links": audit.socialLinks,
                    Contactpagina: audit.contactPage,
                    Formulier: audit.form,
                    Telefoon: audit.phone,
                    "E-mail": audit.email,
                  }).map(([label, ok]) => (
                    <div
                      key={label}
                      className="flex items-center gap-2 rounded-lg border border-slate-200 p-2.5 text-xs"
                    >
                      <span
                        className={`grid h-5 w-5 place-items-center rounded-full ${ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}
                      >
                        {ok ? <Check size={12} /> : "×"}
                      </span>
                      {label}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-5 grid grid-cols-3 gap-3">
                {[1, 2, 3].map((x) => (
                  <div key={x} className="skeleton h-16 rounded-lg" />
                ))}
              </div>
            )}
          </section>
          <section className="card p-5">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-[#a95022]" />
              <h2 className="font-bold">Veilig e-mailconcept</h2>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label>
                <span className="label">Gewenste dienst</span>
                <input
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                  className="input"
                />
              </label>
              <label>
                <span className="label">Tone of voice</span>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="input"
                >
                  <option>Professioneel en direct</option>
                  <option>Warm en persoonlijk</option>
                  <option>Kort en informeel</option>
                </select>
              </label>
            </div>
            <button
              onClick={generate}
              className="btn btn-primary pressable mt-3"
            >
              <Sparkles size={17} />
              Concept genereren
            </button>
            {draft && (
              <textarea
                aria-label="E-mailconcept"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="input mt-4 min-h-72 font-mono text-sm"
              />
            )}
            <div className="mt-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
              <ShieldAlert size={18} className="mt-0.5 shrink-0" />
              <p>
                Benader alleen relevante zakelijke ontvangers, identificeer de
                afzender correct, bied een opt-out en respecteer AVG en
                spamregels. Sitora verstuurt niets automatisch.
              </p>
            </div>
          </section>
        </div>
        <aside className="space-y-5">
          <section className="card p-5">
            <h2 className="font-bold">Kansscore</h2>
            <div className="mt-4 flex items-center gap-4">
              <span className="grid h-20 w-20 place-items-center rounded-full border-[7px] border-[#c26a32] text-2xl font-bold">
                {lead.leadScore}
              </span>
              <div>
                <p className="font-bold">Hoge commerciële kans</p>
                <p className="text-xs text-slate-500">Score van 0–100</p>
              </div>
            </div>
            <ul className="mt-5 space-y-2">
              {lead.scoreReasons.map((r) => (
                <li key={r} className="flex gap-2 text-sm">
                  <Check
                    size={16}
                    className="mt-0.5 shrink-0 text-emerald-600"
                  />
                  {r}
                </li>
              ))}
            </ul>
          </section>
          <section className="card p-5">
            <div className="flex items-center gap-2">
              <Tag size={17} />
              <h2 className="font-bold">Tags</h2>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {lead.tags.length ? (
                lead.tags.map((t) => (
                  <span key={t} className="badge">
                    {t}
                  </span>
                ))
              ) : (
                <p className="text-sm text-slate-400">Nog geen tags</p>
              )}
            </div>
            <button
              onClick={() => {
                const t = window.prompt("Nieuwe tag");
                if (t) addTag([id], t);
              }}
              className="btn btn-secondary pressable mt-4 w-full"
            >
              Tag toevoegen
            </button>
          </section>
          <section className="card p-5">
            <div className="flex items-center gap-2">
              <MessageSquareText size={17} />
              <h2 className="font-bold">Notities</h2>
            </div>
            <textarea
              defaultValue={lead.notes}
              onBlur={(e) => {
                updateLead(id, { notes: e.target.value });
                toast.success("Notitie opgeslagen");
              }}
              className="input mt-3 min-h-28"
              placeholder="Voeg context of een vervolgstap toe…"
            />
            <p className="mt-2 text-[11px] text-slate-400">
              Wordt automatisch opgeslagen bij verlaten van het veld.
            </p>
          </section>
          <section className="card p-5">
            <div className="flex items-center gap-2">
              <Clock3 size={17} />
              <h2 className="font-bold">Activiteiten</h2>
            </div>
            <div className="mt-4 border-l border-slate-200 pl-4">
              <p className="text-sm font-bold">Lead gevonden</p>
              <p className="text-xs text-slate-500">
                {formatDateTime(lead.foundAt)}
              </p>
              {lead.contactedAt && (
                <>
                  <p className="mt-4 text-sm font-bold">Benaderd</p>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(lead.contactedAt)}
                  </p>
                </>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
