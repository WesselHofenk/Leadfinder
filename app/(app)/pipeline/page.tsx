import React from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { toPipelineOptions } from "@/lib/leads/pipeline";
import { QuickStatus } from "@/components/lead-actions";

export default async function PipelinePage() {
  const stages = await prisma.pipelineStage.findMany({ where: { isActive: true }, orderBy: { position: "asc" } });
  const options = toPipelineOptions(stages);
  const groups = await Promise.all(stages.map(async (stage) => {
    const [items, total] = await prisma.$transaction([
      prisma.lead.findMany({ where: { pipelineStageId: stage.id, isSuppressed: false }, orderBy: { updatedAt: "desc" }, take: 50 }),
      prisma.lead.count({ where: { pipelineStageId: stage.id, isSuppressed: false } }),
    ]);
    return { items, total };
  }));

  return <div className="content pipeline-page">
    <header className="page-head"><div><span className="eyebrow">Verkooppipeline</span><h1>Leadopvolging</h1><p className="muted">Acht vaste fases uit PostgreSQL. Iedere wijziging wordt als activiteit opgeslagen.</p></div><Link className="button button-secondary" href="/leads">Alle leads</Link></header>
    <div className="pipeline-grid" role="region" aria-label="Pipeline met acht horizontaal scrollbare fases" tabIndex={0}>
      {stages.map((stage, index) => <section className="pipeline-column" key={stage.id} data-stage-slug={stage.slug} data-stage-position={stage.position}>
        <div className="pipeline-title"><strong>{stage.name}</strong><span className="badge">{groups[index].total}</span></div>
        <div className="pipeline-list">
          {groups[index].items.map((lead) => <article className="pipeline-card" key={lead.id}><div className="pipeline-card-head"><div><strong>{lead.companyName}</strong><p className="small muted">{lead.category.replaceAll("_", " ")} · {lead.city}</p></div><Link href={`/leads/${lead.id}`} aria-label={`Open ${lead.companyName}`}><ExternalLink size={15}/></Link></div><span className="small"><b>{lead.opportunityScore}</b>/100 · confidence {lead.websiteConfidence}</span><QuickStatus leadId={lead.id} stageSlug={stage.slug} stages={options}/></article>)}
          {!groups[index].total && <div className="empty small">Geen leads in deze fase.</div>}
        </div>
      </section>)}
    </div>
  </div>;
}
