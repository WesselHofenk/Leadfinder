import {
  BusinessStatus,
  LeadSource,
  Prisma,
  PrismaClient,
} from "@prisma/client";

const smokeId = `smoke-${Date.now()}-${crypto.randomUUID()}`;
let prisma = new PrismaClient();

async function reconnect() {
  await prisma.$disconnect();
  prisma = new PrismaClient();
}

async function main() {
  try {
    const created = await prisma.lead.create({
      data: {
        externalPlaceId: smokeId,
        companyName: "Leadfinder database-smoketest",
        normalizedCompanyName: smokeId,
        phoneNumber: "+3197000000000",
        normalizedPhoneNumber: smokeId,
        category: "Smoketest",
        country: "NL",
        city: "Amsterdam",
        streetAddress: "Teststraat 1",
        normalizedAddress: smokeId,
        latitude: "52.3676000",
        longitude: "4.9041000",
        googleMapsUrl: "https://www.google.com/maps/search/?api=1&query=smoketest",
        businessStatus: BusinessStatus.OPERATIONAL,
        source: LeadSource.MANUAL,
      },
    });

    const read = await prisma.lead.findUniqueOrThrow({
      where: { externalPlaceId: smokeId },
    });
    if (read.id !== created.id) throw new Error("Create/read-controle mislukt");

    await prisma.lead.update({
      where: { externalPlaceId: smokeId },
      data: { notes: "Automatische database-smoketest bijgewerkt" },
    });

    let duplicateBlocked = false;
    try {
      await prisma.lead.create({
        data: {
          externalPlaceId: `${smokeId}-duplicate`,
          companyName: "Leadfinder database-smoketest duplicaat",
          normalizedCompanyName: smokeId,
          phoneNumber: "+3197000000001",
          normalizedPhoneNumber: `${smokeId}-duplicate`,
          category: "Smoketest",
          country: "NL",
          city: "Amsterdam",
          streetAddress: "Teststraat 1",
          normalizedAddress: smokeId,
          latitude: "52.3676001",
          longitude: "4.9041001",
          googleMapsUrl: "https://www.google.com/maps/search/?api=1&query=smoketest",
          businessStatus: BusinessStatus.OPERATIONAL,
          source: LeadSource.MANUAL,
        },
      });
    } catch (error) {
      duplicateBlocked =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!duplicateBlocked) throw error;
    }
    if (!duplicateBlocked) throw new Error("Dubbele-leadcontrole mislukt");

    await reconnect();
    const persisted = await prisma.lead.findUniqueOrThrow({
      where: { externalPlaceId: smokeId },
    });
    if (!persisted.notes.endsWith("bijgewerkt")) {
      throw new Error("Update/reconnect-controle mislukt");
    }

    await prisma.lead.delete({ where: { externalPlaceId: smokeId } });
    const deleted = await prisma.lead.findUnique({
      where: { externalPlaceId: smokeId },
    });
    if (deleted) throw new Error("Delete-controle mislukt");

    console.log(
      "Lead-databasesmoketest geslaagd: create, read, update, duplicate-preventie, reconnect en delete.",
    );
  } finally {
    await prisma.lead.deleteMany({
      where: { externalPlaceId: { startsWith: smokeId } },
    });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Database-smoketest mislukt", error);
  process.exitCode = 1;
});
