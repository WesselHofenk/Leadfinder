import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { candidateDedupeKeys, fingerprintValues } from "../lib/leads/deduplication";
import type { Candidate } from "../lib/leads/eligibility";

async function main() {
  const backupDir = resolve(process.argv[2] || "");
  if (!process.argv[2]) throw new Error("Geef de externe back-upmap als argument.");
  const files = (await readdir(backupDir)).filter((file) => /^leads-\d+\.json$/.test(file)).sort();
  const fingerprints = new Set<string>();
  const leadIds = new Set<string>();
  for (const file of files) {
    const page = JSON.parse(await readFile(resolve(backupDir, file), "utf8")) as { leads?: Array<Record<string, unknown>> };
    for (const lead of page.leads ?? []) {
      if (typeof lead.id === "string") leadIds.add(lead.id);
      const candidate: Candidate = {
        externalPlaceId: String(lead.externalPlaceId ?? ""),
        companyName: String(lead.companyName ?? ""),
        phoneNumber: typeof lead.normalizedPhoneNumber === "string" ? lead.normalizedPhoneNumber : undefined,
        email: typeof lead.email === "string" ? lead.email : undefined,
        website: typeof lead.websiteUrl === "string" ? lead.websiteUrl : undefined,
        businessStatus: String(lead.businessStatus ?? "UNKNOWN"),
        country: String(lead.country ?? "NL"),
        category: String(lead.category ?? "bedrijf"),
        city: String(lead.city ?? ""),
        postalCode: typeof lead.postalCode === "string" ? lead.postalCode : undefined,
        streetAddress: String(lead.streetAddress ?? ""),
        latitude: Number(lead.latitude ?? 0),
        longitude: Number(lead.longitude ?? 0),
        googleMapsUrl: String(lead.googleMapsUrl ?? ""),
      };
      for (const { fingerprint } of fingerprintValues(candidateDedupeKeys(candidate))) fingerprints.add(fingerprint);
    }
  }
  const output = resolve(backupDir, "fingerprints-v1.json");
  await writeFile(output, JSON.stringify({ version: 1, leadCount: leadIds.size, fingerprints: [...fingerprints].sort() }, null, 2), { flag: "wx", mode: 0o600 });
  console.info(JSON.stringify({ output, leadCount: leadIds.size, fingerprintCount: fingerprints.size }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Fingerprintexport mislukt");
  process.exitCode = 1;
});
