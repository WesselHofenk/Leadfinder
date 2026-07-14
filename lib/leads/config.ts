export const searchAliases: Record<string, string[]> = {
  aannemer: ["aannemer", "bouwbedrijf", "klusbedrijf"],
  klusbedrijf: ["klusbedrijf", "onderhoudsbedrijf"],
  schilder: ["schilder", "schildersbedrijf"],
  stukadoor: ["stukadoor", "stucadoorsbedrijf"],
  dakdekker: ["dakdekker", "dakdekkersbedrijf"],
  loodgieter: ["loodgieter", "installatiebedrijf"],
  elektricien: ["elektricien", "elektrotechnisch bedrijf"],
  hovenier: ["hovenier", "tuinonderhoud"],
  schoonmaakbedrijf: ["schoonmaakbedrijf", "glazenwasser"],
  garage: ["garage", "autogarage", "autoservice"],
  autobedrijf: ["autobedrijf", "garage"],
  rijschool: ["rijschool", "autorijschool"],
  kapper: ["kapper", "kapsalon"],
  schoonheidssalon: ["schoonheidssalon", "beautysalon"],
  nagelstudio: ["nagelstudio", "nagelsalon"],
  fysiotherapie: ["fysiotherapeut", "fysiotherapiepraktijk"],
  restaurant: ["restaurant", "eetcafé"],
  lunchroom: ["lunchroom", "broodjeszaak"],
  catering: ["catering", "cateraar"],
  makelaar: ["makelaar", "makelaarskantoor"],
  interieurbedrijf: ["interieurbedrijf", "interieurbouwer"],
  fotograaf: ["fotograaf", "fotostudio"],
  coach: ["coach", "coachingpraktijk"],
  hondentrimmer: ["hondentrimmer", "hondensalon"],
  dierenpension: ["dierenpension", "dierenverzorging"],
};

export const excludedBusinessValues = new Set([
  "atm", "bank", "bus_station", "charging_station", "community_centre", "courthouse",
  "fire_station", "government", "hospital", "library", "parking", "place_of_worship",
  "police", "post_box", "public_bath", "recycling", "school", "shelter", "townhall",
  "university", "waste_basket",
]);

export function searchTerms(branch: string) {
  return searchAliases[branch.toLowerCase()] ?? [branch, `${branch} bedrijf`];
}

export function confidenceLevel(score: number): "LOW" | "MEDIUM" | "HIGH" {
  if (score >= 80) return "HIGH";
  if (score >= 60) return "MEDIUM";
  return "LOW";
}
