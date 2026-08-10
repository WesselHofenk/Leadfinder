import ExcelJS from "exceljs";
import type { Lead } from "@prisma/client";

type ExportLead = Lead & { pipelineStage?: { name: string; slug: string } | null };

export async function leadsToXlsx(leads: ExportLead[]) {
  const workbook = new ExcelJS.Workbook(); workbook.creator = "Leadfinder Sitora";
  const sheet = workbook.addWorksheet("Leads", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Branche", key: "category", width: 22 }, { header: "Bedrijfsnaam", key: "companyName", width: 32 },
    { header: "Contactpersoon", key: "contactPersonName", width: 24 }, { header: "Telefoonnummer", key: "normalizedPhoneNumber", width: 18 },
    { header: "E-mail", key: "email", width: 28 }, { header: "Adres", key: "streetAddress", width: 40 },
    { header: "Postcode", key: "postalCode", width: 12 }, { header: "Plaats", key: "city", width: 20 },
    { header: "Regio", key: "province", width: 22 }, { header: "Land", key: "country", width: 10 },
    { header: "Google Maps", key: "googleMapsUrl", width: 40 }, { header: "Website", key: "websiteUrl", width: 35 },
    { header: "Website-status", key: "websiteStatus", width: 24 }, { header: "Statusreden website", key: "websiteStatusReason", width: 48 },
    { header: "Opportunity Score", key: "opportunityScore", width: 18 }, { header: "Notities", key: "notes", width: 45 },
    { header: "Status", key: "pipelineStatus", width: 20 }, { header: "Gevonden", key: "firstDiscoveredAt", width: 20 },
    { header: "Gecontroleerd", key: "lastVerifiedAt", width: 20 },
  ];
  for (const lead of leads) sheet.addRow({ ...lead, pipelineStatus: lead.pipelineStage?.name ?? "Nieuw" });
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E7C5B" } };
  sheet.autoFilter = { from: "A1", to: "S1" };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
