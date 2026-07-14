import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { serverEnv } from "@/lib/env";
import { qualifyCandidate } from "@/lib/leads/eligibility";
import { getPlaceDetails, searchPlaces } from "@/lib/google/places";
import { acquireJobLock } from "./lock";
import { reserveApiCall } from "./quota";

export async function runDiscoveryJob() {
  const lock = await acquireJobLock("discovery");
  if (!lock) return { skipped: true, reason: "Er draait al een synchronisatie" };
  try {
    const env = serverEnv();
    if (!env.GOOGLE_PLACES_API_KEY) throw new Error("GOOGLE_PLACES_API_KEY ontbreekt");
    const area = await prisma.coverageArea.findFirst({ where: { status: { in: ["PENDING","COMPLETE","FAILED"] }, nextScanAt: { lte: new Date() } }, orderBy: [{ priority: "asc" }, { lastScannedAt: "asc" }] });
    if (!area) return { skipped: true, reason: "Geen zoekgebied klaar" };
    const job = await prisma.scanJob.create({ data: { type: "DISCOVERY", status: "RUNNING", coverageAreaId: area.id, startedAt: new Date(), attempt: 1 } });
    await prisma.coverageArea.update({ where: { id: area.id }, data: { status: "RUNNING", errorMessage: null } });
    const excludedCategories = new Set((await prisma.excludedCategory.findMany({ where: { isActive: true }, select: { slug: true } })).map((item) => item.slug));
    let pageToken: string | undefined; let calls = 0; let found = 0; let stored = 0;
    try {
      for (let page = 0; page < env.GOOGLE_PLACES_MAX_PAGES_PER_JOB; page += 1) {
        await reserveApiCall(env.GOOGLE_PLACES_DAILY_LIMIT); calls += 1;
        const result = await searchPlaces({ apiKey: env.GOOGLE_PLACES_API_KEY, query: area.category, country: area.country, latitude: Number(area.latitude), longitude: Number(area.longitude), radius: area.radius, pageToken });
        found += result.candidates.length;
        for (const candidate of result.candidates) {
          if (excludedCategories.has(candidate.category) || (candidate.subCategory && excludedCategories.has(candidate.subCategory))) continue;
          const qualified = qualifyCandidate(candidate); if (!qualified.ok) continue;
          const lead = qualified.lead;
          try {
            const saved = await prisma.lead.upsert({
              where: { externalPlaceId: lead.externalPlaceId },
              create: { ...lead, websiteUrl: lead.website || null, latitude: new Prisma.Decimal(lead.latitude), longitude: new Prisma.Decimal(lead.longitude), phoneNumber: lead.phoneNumber || lead.normalizedPhoneNumber, internationalPhoneNumber: lead.internationalPhoneNumber || lead.normalizedPhoneNumber, opportunityScore: lead.leadType === "NO_WEBSITE" ? 95 : 0, isActive: lead.leadType === "NO_WEBSITE", isFiltered: lead.leadType === "OUTDATED_WEBSITE", status: lead.leadType === "NO_WEBSITE" ? "NEW" : "FILTERED", filterReason: lead.leadType === "OUTDATED_WEBSITE" ? "Websiteanalyse in wachtrij" : null },
              update: { companyName: lead.companyName, phoneNumber: lead.phoneNumber || lead.normalizedPhoneNumber, internationalPhoneNumber: lead.internationalPhoneNumber || lead.normalizedPhoneNumber, normalizedPhoneNumber: lead.normalizedPhoneNumber, category: lead.category, subCategory: lead.subCategory, country: lead.country, province: lead.province, municipality: lead.municipality, city: lead.city, postalCode: lead.postalCode, streetAddress: lead.streetAddress, normalizedAddress: lead.normalizedAddress, latitude: lead.latitude, longitude: lead.longitude, googleMapsUrl: lead.googleMapsUrl, website: lead.website || null, websiteUrl: lead.website || null, leadType: lead.leadType, businessStatus: "OPERATIONAL", lastVerifiedAt: new Date() },
            });
            if (lead.leadType === "OUTDATED_WEBSITE") {
              const queued = await prisma.scanJob.count({ where: { leadId: saved.id, type: "WEBSITE_ANALYSIS", status: { in: ["PENDING", "RUNNING"] } } });
              if (!queued) await prisma.scanJob.create({ data: { type: "WEBSITE_ANALYSIS", leadId: saved.id } });
            } else if (!(await prisma.websiteAnalysis.count({ where: { leadId: saved.id } }))) {
              await prisma.websiteAnalysis.create({ data: { leadId: saved.id, websiteUrl: "", opportunityScore: 95, conversionQualityScore: 0, isReachable: false, reasons: [{ code: "NO_WEBSITE", label: "Geen website gevonden", weight: 95 }] } });
            }
            stored += 1;
          } catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error; }
        }
        pageToken = result.nextPageToken; if (!pageToken) break;
      }
      const nextScanAt = new Date(Date.now() + 30 * 86_400_000);
      await prisma.$transaction([
        prisma.coverageArea.update({ where: { id: area.id }, data: { status: "COMPLETE", lastScannedAt: new Date(), nextScanAt, resultsFound: { increment: stored }, apiCallsUsed: { increment: calls } } }),
        prisma.scanJob.update({ where: { id: job.id }, data: { status: "COMPLETE", finishedAt: new Date(), apiCallsUsed: calls, recordsFound: found, recordsStored: stored } }),
      ]);
      return { skipped: false, area: area.city, found, stored, calls };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Onbekende synchronisatiefout";
      const retryAt = new Date(Date.now() + Math.min(24, 2 ** job.attempt) * 60 * 60_000);
      await prisma.$transaction([
        prisma.coverageArea.update({ where: { id: area.id }, data: { status: "FAILED", errorMessage: message, nextScanAt: retryAt } }),
        prisma.scanJob.update({ where: { id: job.id }, data: { status: "FAILED", finishedAt: new Date(), errorMessage: message, nextAttemptAt: retryAt, apiCallsUsed: calls, recordsFound: found, recordsStored: stored } }),
      ]);
      throw error;
    }
  } finally { await lock.release(); }
}

export async function reverifyStaleLeads() {
  const lock = await acquireJobLock("reverify"); if (!lock) return { skipped: true };
  try {
    const env=serverEnv();if(!env.GOOGLE_PLACES_API_KEY)throw new Error("GOOGLE_PLACES_API_KEY ontbreekt");const stale=await prisma.lead.findMany({where:{OR:[{firstDiscoveredAt:{gte:new Date(Date.now()-7*86_400_000)},lastVerifiedAt:{lte:new Date(Date.now()-7*86_400_000)}},{lastVerifiedAt:{lte:new Date(Date.now()-30*86_400_000)}}]},take:20,orderBy:{lastVerifiedAt:"asc"}});const job=await prisma.scanJob.create({data:{type:"REVERIFY",status:"RUNNING",startedAt:new Date(),attempt:1}});let calls=0;let active=0;
    for(const existing of stale){await reserveApiCall(env.GOOGLE_PLACES_DAILY_LIMIT);calls+=1;const candidate=await getPlaceDetails(env.GOOGLE_PLACES_API_KEY,existing.externalPlaceId,existing.country);const qualified=candidate?qualifyCandidate(candidate):{ok:false as const,reason:"onvolledig"};if(!qualified.ok){await prisma.$transaction([prisma.lead.update({where:{id:existing.id},data:{isActive:false,isFiltered:true,filterReason:existing.filterReason||qualified.reason,status:["DO_NOT_CONTACT","FILTERED"].includes(existing.status)?existing.status:"FILTERED",website:candidate?.website||null,websiteUrl:candidate?.website||null,businessStatus:candidate?.businessStatus==="CLOSED_PERMANENTLY"?"CLOSED_PERMANENTLY":candidate?.businessStatus==="CLOSED_TEMPORARILY"?"CLOSED_TEMPORARILY":"UNKNOWN",lastVerifiedAt:new Date()}}),prisma.leadHistory.create({data:{leadId:existing.id,event:"DEACTIVATED",details:{reason:qualified.reason}}})]);continue}
      const lead=qualified.lead;await prisma.$transaction([prisma.lead.update({where:{id:existing.id},data:{companyName:lead.companyName,normalizedCompanyName:lead.normalizedCompanyName,phoneNumber:lead.phoneNumber||lead.normalizedPhoneNumber,normalizedPhoneNumber:lead.normalizedPhoneNumber,internationalPhoneNumber:lead.internationalPhoneNumber||lead.normalizedPhoneNumber,category:lead.category,subCategory:lead.subCategory,country:lead.country,province:lead.province,municipality:lead.municipality,city:lead.city,postalCode:lead.postalCode,streetAddress:lead.streetAddress,normalizedAddress:lead.normalizedAddress,latitude:lead.latitude,longitude:lead.longitude,googleMapsUrl:lead.googleMapsUrl,website:lead.website||null,websiteUrl:lead.website||null,leadType:lead.leadType,businessStatus:"OPERATIONAL",opportunityScore:lead.leadType==="NO_WEBSITE"?95:existing.opportunityScore,lastVerifiedAt:new Date()}}),prisma.leadHistory.create({data:{leadId:existing.id,event:"VERIFIED"}})]);if(lead.leadType==="OUTDATED_WEBSITE"){const queued=await prisma.scanJob.count({where:{leadId:existing.id,type:"WEBSITE_ANALYSIS",status:{in:["PENDING","RUNNING"]}}});if(!queued)await prisma.scanJob.create({data:{type:"WEBSITE_ANALYSIS",leadId:existing.id}})}if(existing.isActive)active+=1}
    await prisma.scanJob.update({where:{id:job.id},data:{status:"COMPLETE",finishedAt:new Date(),recordsFound:stale.length,recordsStored:active,apiCallsUsed:calls}});return{skipped:false,checked:stale.length,active,calls};
  } finally { await lock.release(); }
}
