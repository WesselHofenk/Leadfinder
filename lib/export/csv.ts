import type { Lead } from "@prisma/client";

type ExportLead = Lead & { pipelineStage?: { name: string; slug: string } | null };

const escapeCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
export function leadsToCsv(leads: ExportLead[]) {
  const headers = ["Branche","Bedrijfsnaam","Contactpersoon","Telefoonnummer","E-mail","Adres","Postcode","Plaats","Regio","Land","Google Maps","Website","Website-status","Statusreden website","Opportunity Score","Notities","Status","Gevonden","Laatst gecontroleerd"];
  const rows = leads.map((lead) => [lead.category,lead.companyName,lead.contactPersonName,lead.normalizedPhoneNumber,lead.email,lead.streetAddress,lead.postalCode,lead.city,lead.province,lead.country,lead.googleMapsUrl,lead.websiteUrl,lead.websiteStatus,lead.websiteStatusReason,lead.opportunityScore,lead.notes,lead.pipelineStage?.name ?? "Nieuw",lead.firstDiscoveredAt.toISOString(),lead.lastVerifiedAt.toISOString()]);
  return `\uFEFF${[headers, ...rows].map((row) => row.map(escapeCell).join(";")).join("\r\n")}`;
}
