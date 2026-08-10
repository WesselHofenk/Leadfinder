"use client";

import React, { useEffect, useRef, useState } from "react";
import { ExternalLink, Mail, MapPin, Phone, X } from "lucide-react";
import { QuickStatus } from "@/components/lead-actions";

export type PipelineLead = {
  id: string;
  companyName: string;
  category: string;
  city: string;
  country: string;
  streetAddress: string;
  postalCode: string | null;
  email: string | null;
  normalizedPhoneNumber: string;
  googleMapsUrl: string;
  websiteUrl: string | null;
  websiteStatus: string;
  websiteStatusReason: string | null;
  chatbotStatus: string;
  chatbotStatusReason: string | null;
  leadType: string;
  opportunityScore: number;
  websiteConfidence: number;
  lastVerifiedAt: string;
  status: string;
};

type Stage = { status: string; label: string; items: PipelineLead[]; total: number };
const scrollKey = "leadfinder:pipeline-scroll";

function qualificationBadges(lead: PipelineLead) {
  const badges: string[] = [];
  if (["NO_WEBSITE_CONFIRMED", "NO_WEBSITE_LIKELY", "NO_OWN_WEBSITE"].includes(lead.websiteStatus)) badges.push("Geen website");
  if (["WEBSITE_OUTDATED", "WEBSITE_BROKEN", "OUTDATED", "IMPROVABLE", "IMPROVABLE_WEBSITE"].includes(lead.websiteStatus) || lead.leadType === "OUTDATED_WEBSITE") badges.push("Verouderde website");
  if (lead.chatbotStatus === "NOT_PRESENT") badges.push("Geen chatbot");
  return badges.length ? badges : ["Digitale tekortkoming"];
}

function websiteLabel(status: string) {
  if (["NO_WEBSITE_CONFIRMED", "NO_WEBSITE_LIKELY", "NO_OWN_WEBSITE"].includes(status)) return "Geen zelfstandige website";
  if (status === "SOCIAL_ONLY") return "Alleen extern/social profiel";
  if (["WEBSITE_OUTDATED", "WEBSITE_BROKEN", "OUTDATED", "IMPROVABLE", "IMPROVABLE_WEBSITE"].includes(status)) return "Verouderd of defect";
  return "Website aanwezig";
}

function chatbotLabel(status: string) {
  return status === "PRESENT" ? "Aanwezig" : status === "NOT_PRESENT" ? "Niet aanwezig" : "Onbekend";
}

export function PipelineBoard({ stages }: { stages: Stage[] }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState<PipelineLead | null>(null);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const stored = sessionStorage.getItem(scrollKey);
    if (stored) {
      const position = JSON.parse(stored) as { left?: number; columns?: Record<string, number> };
      grid.scrollLeft = position.left ?? 0;
      grid.querySelectorAll<HTMLElement>("[data-pipeline-list]").forEach((list) => {
        list.scrollTop = position.columns?.[list.dataset.pipelineList ?? ""] ?? 0;
      });
    }
    const save = () => {
      const columns: Record<string, number> = {};
      grid.querySelectorAll<HTMLElement>("[data-pipeline-list]").forEach((list) => {
        columns[list.dataset.pipelineList ?? ""] = list.scrollTop;
      });
      sessionStorage.setItem(scrollKey, JSON.stringify({ left: grid.scrollLeft, columns }));
    };
    grid.addEventListener("scroll", save, { passive: true });
    grid.querySelectorAll<HTMLElement>("[data-pipeline-list]").forEach((list) => list.addEventListener("scroll", save, { passive: true }));
    return () => {
      save();
      grid.removeEventListener("scroll", save);
      grid.querySelectorAll<HTMLElement>("[data-pipeline-list]").forEach((list) => list.removeEventListener("scroll", save));
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setSelected(null);
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [selected]);

  return <>
    <div ref={gridRef} className="pipeline-grid" role="region" aria-label="Pipeline met negen horizontaal scrollbare fases" tabIndex={0}>
      {stages.map(({ status, label, items, total }) => <section className="pipeline-column" key={status}>
        <div className="pipeline-title"><strong>{label}</strong><span className="badge">{total}</span></div>
        <div className="pipeline-list" data-pipeline-list={status}>
          {items.map((lead) => <article className="pipeline-card" key={lead.id}>
            <div className="pipeline-card-head"><div><strong>{lead.companyName}</strong><p className="small muted">{lead.category.replaceAll("_", " ")} · {lead.city}</p></div>
              <button className="pipeline-profile-trigger" type="button" onClick={() => setSelected(lead)} aria-label={`Open compact profiel van ${lead.companyName}`}><ExternalLink size={15}/></button>
            </div>
            <span className="small"><b>{lead.opportunityScore}</b>/100 · confidence {lead.websiteConfidence}</span>
            <QuickStatus leadId={lead.id} status={lead.status}/>
          </article>)}
          {!total && <div className="empty small">Geen leads in deze fase.</div>}
        </div>
      </section>)}
    </div>
    {selected && <div className="lead-profile-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setSelected(null);
    }}>
      <aside className="lead-profile-panel" role="dialog" aria-modal="true" aria-labelledby="lead-profile-title">
        <header><div><span className="eyebrow">Leadprofiel</span><h2 id="lead-profile-title">{selected.companyName}</h2></div>
          <button ref={closeRef} className="pipeline-profile-trigger" type="button" onClick={() => setSelected(null)} aria-label="Leadprofiel sluiten"><X size={18}/></button>
        </header>
        <div className="lead-profile-badges">{qualificationBadges(selected).map((badge) => <span className="badge badge-amber" key={badge}>{badge}</span>)}</div>
        <p className="lead-profile-reason">{selected.websiteStatusReason || selected.chatbotStatusReason || "Dit bedrijf voldoet aan de zakelijke contact- en digitale kwalificatiecriteria."}</p>
        <dl className="lead-profile-details">
          <div><dt>E-mail</dt><dd>{selected.email ? <a href={`mailto:${selected.email}`}><Mail size={14}/>{selected.email}</a> : "Niet beschikbaar"}</dd></div>
          <div><dt>Telefoon</dt><dd><a href={`tel:${selected.normalizedPhoneNumber}`}><Phone size={14}/>{selected.normalizedPhoneNumber}</a></dd></div>
          <div><dt>Locatie</dt><dd>{selected.streetAddress}, {selected.postalCode ? `${selected.postalCode} ` : ""}{selected.city}, {selected.country}</dd></div>
          <div><dt>Google Maps</dt><dd><a href={selected.googleMapsUrl} target="_blank" rel="noopener noreferrer"><MapPin size={14}/>Kaart openen <ExternalLink size={12}/></a></dd></div>
          <div><dt>Website</dt><dd>{selected.websiteUrl ? <a href={selected.websiteUrl} target="_blank" rel="noopener noreferrer">{selected.websiteUrl}<ExternalLink size={12}/></a> : "Geen website gevonden"}<span>{websiteLabel(selected.websiteStatus)}</span></dd></div>
          <div><dt>Chatbot</dt><dd>{chatbotLabel(selected.chatbotStatus)}</dd></div>
          <div><dt>Gecontroleerd</dt><dd>{new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium" }).format(new Date(selected.lastVerifiedAt))}</dd></div>
        </dl>
      </aside>
    </div>}
  </>;
}
