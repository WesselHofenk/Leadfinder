import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const categories = ["aannemer","klusbedrijf","schilder","stukadoor","dakdekker","loodgieter","elektricien","hovenier","schoonmaakbedrijf","verhuisbedrijf","garage","rijschool","kapper","schoonheidssalon","nagelstudio","fysiotherapie","personal trainer","restaurant","lunchroom","catering","hotel","bed and breakfast","makelaar","interieurbedrijf","keukenbedrijf","fotograaf","videograaf","drukkerij","boekhouder","consultant","coach","opleidingsbedrijf","kinderopvang","hondentrimmer","dierenpension","speciaalzaak","groothandel","verhuurbedrijf"];
const excluded = ["bus_station","parking","public_bathroom","park","monument","street_address","atm","local_government_office","place_of_worship","event_venue"];
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
  ["BE", "Antwerpen", "Antwerpen", 51.2194, 4.4025],
  ["BE", "Brussel", "Brussel", 50.8503, 4.3517],
  ["BE", "Oost-Vlaanderen", "Gent", 51.0543, 3.7174],
  ["BE", "West-Vlaanderen", "Brugge", 51.2093, 3.2247],
  ["BE", "Luik", "Luik", 50.6326, 5.5797],
  ["BE", "Limburg", "Hasselt", 50.9307, 5.3325],
  ["BE", "Vlaams-Brabant", "Leuven", 50.8798, 4.7005],
  ["BE", "Waals-Brabant", "Waver", 50.7159, 4.6128],
  ["BE", "Henegouwen", "Bergen", 50.4542, 3.9523],
  ["BE", "Namen", "Namen", 50.4674, 4.8718],
  ["BE", "Luxemburg", "Marche-en-Famenne", 50.2268, 5.3442],
] as const;

async function main() {
  const username = process.env.INITIAL_ADMIN_USERNAME?.trim().toLowerCase() || "sitoro";
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (password) {
    const email = `${username}@leadfinder.local`;
    await prisma.user.upsert({ where: { username }, update: {}, create: { username, email, name: "Sitora", role: "ADMIN", passwordHash: await hash(password, 12) } });
  }
  for (const name of categories) await prisma.category.upsert({ where:{slug:name.replaceAll(" ","-")}, update:{name}, create:{slug:name.replaceAll(" ","-"),name} });
  for (const slug of excluded) await prisma.excludedCategory.upsert({ where:{slug}, update:{}, create:{slug,name:slug.replaceAll("_"," "),reason:"Geen relevante commerciële websitelead"} });
  for (const [country, region, city, latitude, longitude] of centers) {
    for (const category of categories) {
      await prisma.coverageArea.upsert({
        where: { country_city_category_latitude_longitude: { country, city, category, latitude, longitude } },
        update: {},
        create: { country, region, city, latitude, longitude, radius: 12000, category },
      });
    }
  }
}

main().finally(() => prisma.$disconnect());
