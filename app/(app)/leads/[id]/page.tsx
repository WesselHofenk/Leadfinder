import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, MapPin, MessageCircle, Phone } from "lucide-react";

import { LeadEditor, SuppressLeadButton } from "@/components/lead-actions";
import { dateFormatter, statusLabels } from "@/lib/format";
import { getGoogleBusinessUrl } from "@/lib/leads/google-business-url";
import { toPipelineOptions } from "@/lib/leads/pipeline";
import { prisma } from "@/lib/prisma";
import { isBlockedLocation } from "@/lib/leads/blocked-location";

function readableAddress(streetAddress: string, formattedAddress: string | null) {
  const value = (formattedAddress || streetAddress).trim();
  return /\([-+]?\d+\.\d+,\s*[-+]?\d+\.\d+\)/.test(value) ? null : value;
}

function socialLinks(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => {
    if (typeof item !== "string") return false;
    try {
      return /(^|\.)(facebook\.com|instagram\.com|linkedin\.com|tiktok\.com)$/i.test(new URL(item).hostname);
    } catch { return false; }
  });
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lead, stages] = await Promise.all([
    prisma.lead.findUnique({
      where: { id },
      include: {
        pipelineStage: true,
        leadNotes: { orderBy: { createdAt: "desc" }, take: 20, include: { user: { select: { name: true } } } },
        activities: { orderBy: { createdAt: "desc" }, take: 40 },
      },
    }),
    prisma.pipelineStage.findMany({ where: { isActive: true }, orderBy: { position: "asc" } }),
  ]);
  if (!lead || isBlockedLocation(lead as typeof lead & Record<string, unknown>)) notFound();

  const address = readableAddress(lead.streetAddress, lead.formattedAddress);
  const socials = socialLinks(lead.socialUrls);
  const mapsUrl = lead.googleBusinessProfileUrl || getGoogleBusinessUrl(lead);
  const noWebsiteConfirmed = lead.websiteStatus === "NO_WEBSITE_CONFIRMED" && !lead.websiteUrl;

  return <div className="content">
    <Link href="/leads" className="button button-secondary back-button"><ArrowLeft size={15} />Terug naar leads</Link>
    <header className="page-head">
      <div><span className="eyebrow">{lead.pipelineStage.name}</span><h1>{lead.companyName}</h1><p className="muted">{lead.category.replaceAll("_", " ")} · {lead.city}, {lead.country}</p></div>
      <div className="actions detail-actions">
        {lead.normalizedPhoneNumber && <>
          <a className="button button-secondary" href={`tel:${lead.normalizedPhoneNumber}`}><Phone size={15} />Bellen</a>
          <a className="button button-secondary" href={`https://wa.me/${lead.normalizedPhoneNumber.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={15} />WhatsApp</a>
        </>}
        {lead.email && <a className="button button-secondary" href={`mailto:${lead.email}`}><Mail size={15} />E-mail</a>}
        <a className="button button-secondary" href={mapsUrl} target="_blank" rel="noopener noreferrer"><MapPin size={15} />Google Maps</a>
        <SuppressLeadButton leadId={lead.id} />
      </div>
    </header>

    <div className="detail-grid"><div className="detail-main">
      <section className="card card-pad"><h2>Bedrijfsgegevens</h2><dl>
        <Row label="Bedrijfsnaam">{lead.companyName}</Row>
        <Row label="Categorie">{lead.category.replaceAll("_", " ")}</Row>
        <Row label="Bedrijfsstatus">{lead.businessStatus === "OPERATIONAL" ? "Actief" : statusLabels[lead.businessStatus]}</Row>
        <Row label="Telefoon">{lead.normalizedPhoneNumber ? <a className="text-link" href={`tel:${lead.normalizedPhoneNumber}`}>{lead.normalizedPhoneNumber}</a> : "Niet beschikbaar"}</Row>
        <Row label="E-mail">{lead.email ? <a className="text-link" href={`mailto:${lead.email}`}>{lead.email}</a> : "Niet beschikbaar"}</Row>
        <Row label="E-mailbron">{lead.emailSourceUrl ? <a className="text-link" href={lead.emailSourceUrl} target="_blank" rel="noopener noreferrer">{lead.emailSource || "Openbare bron"}</a> : lead.emailSource || "Niet vastgelegd"}</Row>
        <Row label="E-mailcontrole">{lead.emailMxVerified ? `MX bevestigd${lead.emailVerifiedAt ? ` · ${dateFormatter.format(lead.emailVerifiedAt)}` : ""}` : "Niet bevestigd"}</Row>
        <Row label="Contactpersoon">{lead.contactPerson || lead.contactPersonName || "Niet beschikbaar"}</Row>
      </dl></section>

      <section className="card card-pad"><h2>Locatie</h2><dl>
        <Row label="Volledig adres">{address || "Normaal adres nog niet beschikbaar"}</Row>
        <Row label="Postcode en plaats">{[lead.postalCode, lead.city].filter(Boolean).join(" ")}</Row>
        <Row label="Gemeente">{lead.municipality || "Niet beschikbaar"}</Row>
        <Row label="Provincie / regio">{lead.province || "Niet beschikbaar"}</Row>
        <Row label="Land">{lead.country === "NL" ? "Nederland" : lead.country === "BE" ? "België" : lead.country}</Row>
      </dl><p><a className="button button-secondary" href={mapsUrl} target="_blank" rel="noopener noreferrer"><MapPin size={15} />Open in Google Maps</a></p></section>

      <section className="card card-pad"><h2>Online</h2><dl>
        <Row label="Website">{noWebsiteConfirmed ? "Geen eigen website gevonden" : lead.websiteUrl || "Nog niet bevestigd"}</Row>
        <Row label="Google Bedrijfsprofiel">{lead.googleBusinessProfileVerified ? <a className="text-link" href={mapsUrl} target="_blank" rel="noopener noreferrer">Open profiel</a> : "Niet bevestigd voor deze bestaande lead"}</Row>
        <Row label="Taal">{lead.language === "nl" ? "Nederlands" : lead.language || "Nog niet bevestigd"}</Row>
        {socials.length > 0 && <Row label="Sociale profielen"><span>{socials.map((url, index) => <span key={url}>{index > 0 && " · "}<a className="text-link" href={url} target="_blank" rel="noopener noreferrer">{new URL(url).hostname.replace(/^www\./, "")}</a></span>)}</span></Row>}
      </dl></section>

      <section className="card card-pad"><h2>Leadinformatie</h2><dl>
        <Row label="Pipelinefase">{lead.pipelineStage.name}</Row>
        <Row label="Bron">{statusLabels[lead.source]}</Row>
        <Row label="Bron opgehaald">{lead.sourceFetchedAt ? dateFormatter.format(lead.sourceFetchedAt) : "Onbekend"}</Row>
        <Row label="Laatst gecontroleerd">{dateFormatter.format(lead.lastVerifiedAt)}</Row>
        <Row label="Volgende opvolging">{lead.nextFollowUpAt ? dateFormatter.format(lead.nextFollowUpAt) : "Niet gepland"}</Row>
      </dl></section>

      <section className="card card-pad"><h2>Notities</h2>{lead.leadNotes.length ? <div className="note-list">{lead.leadNotes.map((note) => <div key={note.id}><p>{note.content}</p><span className="small muted">{note.user.name} · {note.createdAt.toLocaleString("nl-NL")}</span></div>)}</div> : <p className="small muted">Nog geen notities toegevoegd.</p>}</section>
      <section className="card card-pad"><h2>Activiteit</h2>{lead.activities.length ? <ol className="timeline">{lead.activities.map((activity) => <li key={activity.id}><strong>{activity.summary}</strong><div className="small muted">{activity.createdAt.toLocaleString("nl-NL")}</div></li>)}</ol> : <p className="small muted">Nog geen activiteiten vastgelegd.</p>}</section>
    </div>
      <aside className="detail-sidebar">
        <section className="card card-pad"><h2>Pipeline</h2><p><span className="badge badge-blue">{lead.pipelineStage.name}</span></p><p className="small muted">Handmatige status en notities worden niet door hercontroles overschreven.</p></section>
        <LeadEditor leadId={lead.id} stageSlug={lead.pipelineStage.slug} stages={toPipelineOptions(stages)} notes={lead.notes} filterReason={lead.filterReason} />
      </aside>
    </div>
  </div>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="definition"><dt>{label}</dt><dd>{children}</dd></div>;
}
