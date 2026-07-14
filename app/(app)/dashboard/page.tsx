import Link from "next/link";
import { ArrowRight, Database, Globe2, MapPinned, TrendingUp } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { GenerationButton } from "@/components/generation-button";
import { prisma } from "@/lib/prisma";
import { dateFormatter, numberFormatter, statusLabels } from "@/lib/format";

export default async function DashboardPage() {
  const active: Prisma.LeadWhereInput = { isActive: true, isFiltered: false, isSuppressed: false, businessStatus: { in: ["OPERATIONAL", "UNKNOWN"] }, phoneNumber: { not: "" } };
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const [total, today, noWebsite, websiteOpportunities, called, noAnswer, quoted, invoiced, filtered, average, recent, groups, latestRun] = await Promise.all([
    prisma.lead.count({ where: active }), prisma.lead.count({ where: { ...active, firstDiscoveredAt: { gte: start } } }),
    prisma.lead.count({ where: { ...active, leadType: "NO_WEBSITE" } }),
    prisma.lead.count({ where: { ...active, leadType: { in: ["OUTDATED_WEBSITE", "IMPROVABLE_WEBSITE"] } } }),
    prisma.lead.count({ where: { ...active, status: "CALLED" } }), prisma.lead.count({ where: { ...active, status: "NO_ANSWER" } }),
    prisma.lead.count({ where: { ...active, status: "QUOTE_SENT" } }), prisma.lead.count({ where: { ...active, status: "INVOICED" } }),
    prisma.lead.count({ where: { isFiltered: true, isSuppressed: false } }), prisma.lead.aggregate({ where: active, _avg: { opportunityScore: true } }),
    prisma.lead.findMany({ where: active, orderBy: [{ opportunityScore: "desc" }, { firstDiscoveredAt: "desc" }], take: 7 }),
    prisma.lead.groupBy({ by: ["category"], where: active, _count: { id: true }, orderBy: { _count: { category: "desc" } }, take: 6 }),
    prisma.generationRun.findFirst({ orderBy: { createdAt: "desc" } }),
  ]);
  const groupCount = (group: (typeof groups)[number]) => typeof group._count === "object" && group._count ? group._count.id ?? 0 : 0;
  const max = Math.max(1, ...groups.map(groupCount));
  return <div className="content">
    <header className="page-head"><div><span className="eyebrow">Overzicht</span><h1>Dashboard</h1><p className="muted">De beste nieuwe websitekansen en actuele bronstatus.</p></div><div className="actions"><GenerationButton/><Link className="button button-secondary" href="/leads">Bekijk alle leads <ArrowRight size={15}/></Link></div></header>
    <section className="stats"><Stat icon={<Database size={18}/>} label="Actieve leads" value={total} meta={`${today} vandaag`}/><Stat icon={<Globe2 size={18}/>} label="Geen website" value={noWebsite} meta="Hoge directe kans"/><Stat icon={<TrendingUp size={18}/>} label="Websitekansen" value={websiteOpportunities} meta={`Gem. score ${Math.round(average._avg?.opportunityScore ?? 0)}`}/><Stat icon={<MapPinned size={18}/>} label="Gefilterd" value={filtered} meta="Aparte pipeline"/><Stat label="Gebeld" value={called} meta="Opvolging"/><Stat label="Geen gehoor" value={noAnswer} meta="Blijft bewaard"/><Stat label="Offerte gestuurd" value={quoted} meta="Commerciële kans"/><Stat label="Gefactureerd" value={invoiced} meta="Gewonnen"/></section>
    {latestRun && <section className="card card-pad run-summary"><div><h2>Laatste zoekrun</h2><p className="small muted">{latestRun.createdAt.toLocaleString("nl-NL")} · {statusLabels[latestRun.status]}</p></div><div className="run-summary-metrics"><span><strong>{latestRun.stored}</strong> opgeslagen</span><span><strong>{latestRun.candidatesFound}</strong> gevonden</span><span><strong>{latestRun.duplicates}</strong> duplicaten</span><span><strong>{latestRun.sourceFailures}</strong> bronfouten</span></div></section>}
    <div className="grid-two"><section className="card"><div className="card-pad"><h2>Beste nieuwe kansen</h2><p className="small muted">Gerangschikt op Opportunity Score</p></div>{recent.length ? <div className="table-scroll"><table><thead><tr><th>Bedrijf</th><th>Type</th><th>Score</th><th>Confidence</th><th>Plaats</th><th>Gevonden</th></tr></thead><tbody>{recent.map((lead) => <tr key={lead.id}><td><Link className="company" href={`/leads/${lead.id}`}>{lead.companyName}</Link></td><td><span className="badge">{statusLabels[lead.leadType]}</span></td><td><strong>{lead.opportunityScore}/100</strong></td><td>{lead.confidenceScore}/100</td><td>{lead.city}, {lead.country}</td><td>{dateFormatter.format(lead.firstDiscoveredAt)}</td></tr>)}</tbody></table></div> : <Empty/>}</section><section className="card card-pad"><h2>Leads per branche</h2><div className="bars" style={{ marginTop: 20 }}>{groups.map((group) => <div className="bar-row" key={group.category}><span>{group.category.replaceAll("_", " ")}</span><div className="progress"><span style={{ width: `${groupCount(group) / max * 100}%` }}/></div><strong>{groupCount(group)}</strong></div>)}</div></section></div>
  </div>;
}
function Stat({ icon, label, value, meta }: { icon?: React.ReactNode; label: string; value: number; meta: string }) { return <div className="card stat"><div className="stat-head"><span className="stat-label">{label}</span><span className="stat-icon">{icon}</span></div><div className="stat-value">{numberFormatter.format(value)}</div><div className="stat-meta">{meta}</div></div>; }
function Empty() { return <div className="empty"><strong>Nog geen leads</strong><span>Start een zoekrun om het overzicht te vullen.</span></div>; }
