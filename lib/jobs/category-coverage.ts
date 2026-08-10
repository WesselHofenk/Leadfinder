import type { Prisma } from "@prisma/client";

export async function ensureCategoryCoverage(
  tx: Prisma.TransactionClient,
  category: string,
  now = new Date(),
) {
  const rows = await tx.coverageArea.findMany({
    select: {
      country: true,
      region: true,
      municipality: true,
      city: true,
      latitude: true,
      longitude: true,
      radius: true,
      priority: true,
    },
  });
  const templates = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.country}:${row.city}:${row.latitude.toString()}:${row.longitude.toString()}`;
    const current = templates.get(key);
    if (!current || row.priority < current.priority) templates.set(key, row);
  }
  if (!templates.size) return 0;
  const result = await tx.coverageArea.createMany({
    data: [...templates.values()].map((template) => ({
      ...template,
      category,
      status: "PENDING" as const,
      nextScanAt: now,
    })),
    skipDuplicates: true,
  });
  return result.count;
}
