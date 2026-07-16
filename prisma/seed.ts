import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { pipelineStages } from "../lib/leads/pipeline";

const prisma = new PrismaClient();
const categories = ["aannemer","klusbedrijf","schilder","stukadoor","tegelzetter","installatiebedrijf","dakdekker","loodgieter","elektricien","hovenier","schoonmaakbedrijf","verhuisbedrijf","garage","autobedrijf","rijschool","kapper","schoonheidssalon","nagelstudio","fysiotherapie","wellness","personal trainer","restaurant","café","lunchroom","catering","hotel","bed and breakfast","makelaar","interieurbedrijf","keukenbedrijf","fotograaf","videograaf","drukkerij","boekhouder","consultant","coach","opleidingsbedrijf","kinderopvang","hondenuitlaatservice","hondentrimmer","dierenpension","speciaalzaak","groothandel","verhuurbedrijf"];
const excluded = ["bus_station","parking","public_bathroom","park","monument","street_address","atm","local_government_office","place_of_worship","event_venue"];
const alternativeCategories = ["barbier", "accountant", "lokale winkel", "ambachtsbedrijf"];
const centers = [
  ["NL", "Noord-Holland", "Amsterdam", 52.3676, 4.9041],
  ["NL", "Zuid-Holland", "Rotterdam", 51.9244, 4.4777],
  ["NL", "Utrecht", "Utrecht", 52.0907, 5.1214],
  ["NL", "Noord-Brabant", "Eindhoven", 51.4416, 5.4697],
  ["NL", "Gelderland", "Arnhem", 51.9851, 5.8987],
  ["NL", "Overijssel", "Zwolle", 52.5168, 6.0830],
  ["NL", "Groningen", "Groningen", 53.2194, 6.5665],
  ["NL", "Friesland", "Leeuwarden", 53.2012, 5.7999],
  ["NL", "Drenthe", "Emmen", 52.7858, 6.8976],
  ["NL", "Flevoland", "Lelystad", 52.5185, 5.4714],
  ["NL", "Zeeland", "Middelburg", 51.4988, 3.6109],
  ["NL", "Limburg", "Roermond", 51.1942, 5.9870],
  ["NL", "Noord-Brabant", "Breda", 51.5719, 4.7683],
  ["NL", "Zuid-Holland", "Gouda", 52.0116, 4.7105],
  ["NL", "Noord-Holland", "Alkmaar", 52.6324, 4.7534],
  ["NL", "Noord-Holland", "Haarlem", 52.3874, 4.6462],
  ["NL", "Utrecht", "Amersfoort", 52.1561, 5.3878],
  ["NL", "Gelderland", "Apeldoorn", 52.2112, 5.9699],
  ["NL", "Gelderland", "Nijmegen", 51.8126, 5.8372],
  ["NL", "Overijssel", "Enschede", 52.2215, 6.8937],
  ["NL", "Noord-Brabant", "Tilburg", 51.5555, 5.0913],
  ["NL", "Noord-Brabant", "Den Bosch", 51.6978, 5.3037],
  ["NL", "Zuid-Holland", "Dordrecht", 51.8133, 4.6901],
  ["NL", "Zuid-Holland", "Zoetermeer", 52.0607, 4.4940],
  ["NL", "Zuid-Holland", "Den Haag", 52.0705, 4.3007],
  ["NL", "Zuid-Holland", "Leiden", 52.1601, 4.4970],
  ["NL", "Zuid-Holland", "Delft", 52.0116, 4.3571],
  ["NL", "Overijssel", "Deventer", 52.2661, 6.1552],
  ["NL", "Limburg", "Maastricht", 50.8514, 5.6910],
  ["BE", "Antwerpen", "Antwerpen", 51.2194, 4.4025],
  ["BE", "West-Vlaanderen", "Brugge", 51.2093, 3.2247],
  ["BE", "Luik", "Luik", 50.6326, 5.5797],
  ["BE", "Limburg", "Hasselt", 50.9307, 5.3325],
  ["BE", "Vlaams-Brabant", "Leuven", 50.8798, 4.7005],
  ["BE", "Waals-Brabant", "Waver", 50.7159, 4.6128],
  ["BE", "Henegouwen", "Bergen", 50.4542, 3.9523],
  ["BE", "Namen", "Namen", 50.4674, 4.8718],
  ["BE", "Luxemburg", "Marche-en-Famenne", 50.2268, 5.3442],
  ["BE", "Antwerpen", "Mechelen", 51.0259, 4.4776],
  ["BE", "West-Vlaanderen", "Kortrijk", 50.8280, 3.2649],
  ["BE", "Oost-Vlaanderen", "Aalst", 50.9383, 4.0392],
  ["BE", "Oost-Vlaanderen", "Sint-Niklaas", 51.1651, 4.1437],
  ["BE", "Limburg", "Genk", 50.9661, 5.5001],
  ["BE", "Antwerpen", "Turnhout", 51.3225, 4.9447],
  ["BE", "West-Vlaanderen", "Oostende", 51.2300, 2.9200],
  ["BE", "West-Vlaanderen", "Roeselare", 50.9465, 3.1227],
  ["BE", "Henegouwen", "Charleroi", 50.4108, 4.4446],
] as const;

async function main() {
  for (const stage of pipelineStages) {
    await prisma.pipelineStage.upsert({
      where: { id: stage.id },
      create: { id: stage.id, slug: stage.slug, name: stage.label, position: stage.position },
      update: { slug: stage.slug, name: stage.label, position: stage.position, isActive: true },
    });
  }
  const username = process.env.INITIAL_ADMIN_USERNAME?.trim().toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (username && password) {
    const email = `${username}@leadfinder.local`;
    await prisma.user.upsert({ where: { username }, update: {}, create: { username, email, name: "Sitora", role: "ADMIN", passwordHash: await hash(password, 12) } });
  }
  for (const name of [...categories, ...alternativeCategories]) {
    const slug = name.replaceAll(" ", "-");
    await prisma.category.upsert({ where: { slug }, create: { slug, name }, update: { name } });
  }
  for (const slug of excluded) await prisma.excludedCategory.upsert({ where:{slug}, update:{}, create:{slug,name:slug.replaceAll("_"," "),reason:"Geen relevante commerciële websitelead"} });
  for (const [country, region, city, latitude, longitude] of centers) {
    for (const category of [...categories, ...alternativeCategories]) {
      await prisma.coverageArea.upsert({
        where: { country_city_category_latitude_longitude: { country, city, category, latitude, longitude } },
        create: { country, region, city, latitude, longitude, radius: 12000, category },
        update: { region, radius: 12000 },
      });
    }
  }
}

main().finally(() => prisma.$disconnect());
