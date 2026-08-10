import React from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { pipelineStages } from "@/lib/leads/pipeline";
import { PipelineBoard, type PipelineLead } from "@/components/pipeline-board";

export default async function PipelinePage() {
  const groups = await Promise.all(pipelineStages.map(async ({ status, label }) => {
    const [records, total] = await prisma.$transaction([
      prisma.lead.findMany({ where: { status, isSuppressed: false }, orderBy: { updatedAt: "desc" }, take: 50 }),
      prisma.lead.count({ where: { status, isSuppressed: false } }),
    ]);
    const items: PipelineLead[] = records.map((lead) => ({
      id: lead.id,
      companyName: lead.companyName,
      category: lead.category,
      city: lead.city,
      country: lead.country,
      streetAddress: lead.streetAddress,
      postalCode: lead.postalCode,
      email: lead.email,
      normalizedPhoneNumber: lead.normalizedPhoneNumber,
      googleMapsUrl: lead.googleMapsUrl,
      websiteUrl: lead.websiteUrl,
      websiteStatus: lead.websiteStatus,
      websiteStatusReason: lead.websiteStatusReason,
      chatbotStatus: lead.chatbotStatus,
      chatbotStatusReason: lead.chatbotStatusReason,
      leadType: lead.leadType,
      opportunityScore: lead.opportunityScore,
      websiteConfidence: lead.websiteConfidence,
      lastVerifiedAt: new Date(lead.lastVerifiedAt ?? lead.updatedAt ?? Date.now()).toISOString(),
      status: lead.status,
    }));
    return { status, label, items, total };
  }));
  return <div className="content pipeline-page">
    <header className="page-head"><div><span className="eyebrow">Verkooppipeline</span><h1>Leadopvolging</h1><p className="muted">Nieuwe gekwalificeerde leads verschijnen direct in Nieuw.</p></div><Link className="button button-secondary" href="/leads">Alle leads</Link></header>
    <PipelineBoard stages={groups}/>
  </div>;
}
