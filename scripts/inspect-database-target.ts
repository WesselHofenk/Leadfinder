import { PrismaClient } from "@prisma/client";

function safeTarget(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return { protocol: url.protocol, host: url.host, database: url.pathname.replace(/^\//, "") || null };
  } catch {
    return { protocol: "unparseable", host: null, database: null };
  }
}

async function main() {
  const variables = ["NEON_POSTGRES_PRISMA_URL", "NEON_POSTGRES_URL_NON_POOLING"];
  console.info(JSON.stringify({
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "local",
    targets: Object.fromEntries(variables.map((name) => [name, safeTarget(process.env[name])])),
  }));
  if (!process.env.NEON_POSTGRES_PRISMA_URL) return;
  const prisma = new PrismaClient();
  try {
    const [identity, leadCount] = await Promise.all([
      prisma.$queryRaw<Array<{ database_name: string; current_user_name: string }>>`
        SELECT current_database() AS database_name, current_user AS current_user_name
      `,
      prisma.lead.count(),
    ]);
    console.info(JSON.stringify({ connection: identity[0], leadCount, readOnlyProbe: true }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    readOnlyProbe: false,
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
