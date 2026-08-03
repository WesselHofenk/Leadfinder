import { prisma } from "@/lib/prisma";
import { deliverColdEmail, queueColdEmail } from "@/lib/email/service";

const send = process.argv.includes("--send");
const countArgument = process.argv.find((argument) => argument.startsWith("--count="));
const count = Math.min(5, Math.max(1, Number(countArgument?.split("=")[1] || 5)));
const batchKeyArgument = process.argv.find((argument) => argument.startsWith("--batch-key="));
const batchKey = batchKeyArgument?.split("=")[1] || "manual-2026-08-03-five";

function safeInline(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function subject(companyName: string) {
  return `Online vindbaarheid voor ${safeInline(companyName).slice(0, 100)}`;
}

function body(companyName: string, city: string) {
  const company = safeInline(companyName);
  const place = safeInline(city);
  return `Beste ondernemer,

Ik kwam ${company} in ${place} tegen en zag dat er nog geen eigen website bij uw bedrijfsvermelding staat.

Met Sitora help ik lokale ondernemers aan een duidelijke website, zodat potentiële klanten het bedrijf beter online kunnen vinden en gemakkelijk contact kunnen opnemen.

Zal ik vrijblijvend een kort voorstel sturen voor ${company}?

Met vriendelijke groet,

Sitora
info@sitora.nl

Geen interesse? Antwoord met \"afmelden\"; dan ontvangt u geen verdere e-mails.`;
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("Geen actieve beheerder gevonden voor de verzendaudit.");
  let batch = await prisma.coldEmail.findMany({ where: { batchKey }, include: { lead: { select: { companyName: true, city: true } } }, orderBy: { createdAt: "asc" } });
  const missing = count - batch.length;
  const pool = missing > 0 ? await prisma.lead.findMany({
    where: {
      country: "NL",
      isActive: true,
      isFiltered: false,
      isSuppressed: false,
      doNotContact: false,
      email: { not: null },
      pipelineStage: { is: { slug: "nieuw" } },
      coldEmails: { none: { status: { not: "CANCELLED" } } },
    },
    orderBy: [{ opportunityScore: "desc" }, { firstDiscoveredAt: "asc" }],
    take: 100,
    select: { id: true, companyName: true, city: true, email: true },
  }) : [];
  const candidates = pool.filter((lead) => lead.email).slice(0, missing);
  if (candidates.length !== missing) throw new Error(`Slechts ${batch.length + candidates.length} geschikte leads in Nieuw gevonden; er is niets verzonden.`);

  if (!send) {
    console.log(`Droge controle geslaagd: ${batch.length + candidates.length} geschikte leads klaar voor verzending.`);
    for (const email of batch) console.log(`- ${email.lead.companyName} (${email.lead.city}) [${email.status}]`);
    for (const lead of candidates) console.log(`- ${lead.companyName} (${lead.city})`);
    return;
  }

  for (const lead of candidates) {
    await queueColdEmail({
      leadId: lead.id,
      userId: admin.id,
      subject: subject(lead.companyName),
      bodyText: body(lead.companyName, lead.city),
      sendImmediately: true,
      batchKey,
    });
  }
  batch = await prisma.coldEmail.findMany({ where: { batchKey }, include: { lead: { select: { companyName: true, city: true } } }, orderBy: { createdAt: "asc" } });
  const results: Array<{ companyName: string; status: string }> = [];
  for (const email of batch) {
    if (email.status === "SENT") {
      results.push({ companyName: email.lead.companyName, status: email.status });
      continue;
    }
    if (email.status === "FAILED" && email.allowOutsideWindow) {
      await prisma.coldEmail.update({ where: { id: email.id }, data: { scheduledFor: new Date() } });
    }
    const delivered = await deliverColdEmail(email.id);
    results.push({ companyName: email.lead.companyName, status: delivered.status });
  }
  const completed = results.filter((result) => result.status === "SENT").length;
  console.log(`Verzending afgerond: ${completed}/${count} mails bevestigd en gearchiveerd.`);
  for (const result of results) console.log(`- ${result.companyName}: ${result.status}`);
}

main().finally(() => prisma.$disconnect());
