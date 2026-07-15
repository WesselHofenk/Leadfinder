import type { Lead } from "@prisma/client";

const escapeCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
export function leadsToCsv(leads: Lead[]) {
  const headers = ["Branche","Bedrijfsnaam","Contactpersoon","Telefoonnummer","E-mail","Adres","Postcode","Plaats","Regio","Land","Google Maps","Website","Website-status","Statusreden website","Opportunity Score","Notities","Status","Gevonden","Laatst gecontroleerd"];
  const rows = leads.map((lead) => [lead.category,lead.companyName,lead.contactPersonName,lead.normalizedPhoneNumber,lead.email,lead.streetAddress,lead.postalCode,lead.city,lead.province,lead.country,lead.googleMapsUrl,lead.websiteUrl,lead.websiteStatus,lead.websiteStatusReason,lead.opportunityScore,lead.notes,lead.status,lead.firstDiscoveredAt.toISOString(),lead.lastVerifiedAt.toISOString()]);
  return `\uFEFF${[headers, ...rows].map((row) => row.map(escapeCell).join(";")).join("\r\n")}`;
}
