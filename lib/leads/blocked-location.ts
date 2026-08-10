import type { Prisma } from "@prisma/client";

import { normalizeText } from "./normalization";

export type BlockedArea = "BRUSSELS" | "GHENT";
export type BlockedLocationResult = {
  blocked: boolean;
  area?: BlockedArea;
  reason?: string;
  matchedField?: string;
  matchedValue?: string;
};

type LocationInput = Record<string, unknown> & {
  city?: unknown; municipality?: unknown; province?: unknown; postalCode?: unknown;
  streetAddress?: unknown; formattedAddress?: unknown; regionLanguage?: unknown;
  locality?: unknown; town?: unknown; village?: unknown; suburb?: unknown;
  district?: unknown; county?: unknown; region?: unknown; rawData?: unknown; sourceData?: unknown;
};

export const brusselsPostcodes = ["1000", "1020", "1030", "1040", "1047", "1049", "1050", "1060", "1070", "1080", "1081", "1082", "1083", "1090", "1120", "1130", "1140", "1150", "1160", "1170", "1180", "1190", "1200", "1210"] as const;
export const ghentPostcodes = ["9000", "9030", "9031", "9032", "9040", "9041", "9042", "9050", "9051", "9052"] as const;

export const brusselsNames = [
  "brussel", "brussels", "bruxelles", "brussel stad", "bruxelles ville", "city of brussels",
  "brussels hoofdstedelijk gewest", "region de bruxelles capitale", "brussels capital region",
  "anderlecht", "elsene", "ixelles", "etterbeek", "evere", "ganshoren", "jette", "koekelberg",
  "oudergem", "auderghem", "schaarbeek", "schaerbeek", "sint agatha berchem", "berchem sainte agathe",
  "sint gillis", "saint gilles", "sint jans molenbeek", "molenbeek saint jean", "sint joost ten node",
  "saint josse ten noode", "sint lambrechts woluwe", "woluwe saint lambert", "sint pieters woluwe",
  "woluwe saint pierre", "ukkel", "uccle", "vorst", "forest", "watermaal bosvoorde", "watermael boitsfort",
] as const;

export const ghentNames = [
  "gent", "ghent", "gand", "stad gent", "city of ghent", "gent centrum", "gentbrugge", "ledeberg",
  "mariakerke", "drongen", "wondelgem", "sint amandsberg", "oostakker", "desteldonk", "mendonk",
  "sint kruis winkel", "zwijnaarde", "afsnee",
] as const;

const directFields = ["city", "municipality", "locality", "town", "village", "suburb", "district", "county", "province", "region", "regionLanguage", "postalCode", "formattedAddress", "streetAddress"] as const;
const metadataLocationKey = /^(?:addr:)?(?:city|place|municipality|locality|town|village|suburb|district|county|province|state|region|postcode|postal_code|full|street|address)$|^is_in(?::|$)/i;

function valueStrings(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(valueStrings);
  return [];
}

function metadataValues(value: unknown, depth = 0): Array<{ field: string; value: string }> {
  if (!value || typeof value !== "object" || depth > 5) return [];
  if (Array.isArray(value)) return value.flatMap((item) => metadataValues(item, depth + 1));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const own = metadataLocationKey.test(key) ? valueStrings(child).map((item) => ({ field: `metadata.${key}`, value: item })) : [];
    return [...own, ...metadataValues(child, depth + 1)];
  });
}

function hasPhrase(value: string, phrase: string) {
  const normalized = ` ${normalizeText(value)} `;
  return normalized.includes(` ${phrase} `);
}

function firstPostcode(value: string) {
  return value.match(/\b\d{4}\b/)?.[0];
}

export function detectBlockedLocation(input: LocationInput): BlockedLocationResult {
  const values = [
    ...directFields.flatMap((field) => valueStrings(input[field]).map((value) => ({ field, value }))),
    ...metadataValues(input.rawData),
    ...metadataValues(input.sourceData),
  ];

  for (const item of values) {
    const postcode = firstPostcode(item.value);
    if (postcode && (brusselsPostcodes as readonly string[]).includes(postcode)) {
      return { blocked: true, area: "BRUSSELS", reason: "blocked_brussels_postcode", matchedField: item.field, matchedValue: postcode };
    }
    if (postcode && (ghentPostcodes as readonly string[]).includes(postcode)) {
      return { blocked: true, area: "GHENT", reason: "blocked_ghent_postcode", matchedField: item.field, matchedValue: postcode };
    }
  }
  for (const item of values) {
    const brussels = brusselsNames.find((name) => hasPhrase(item.value, name));
    if (brussels) return { blocked: true, area: "BRUSSELS", reason: `blocked_brussels_${item.field}`, matchedField: item.field, matchedValue: brussels };
    const ghent = ghentNames.find((name) => hasPhrase(item.value, name));
    if (ghent) return { blocked: true, area: "GHENT", reason: `blocked_ghent_${item.field}`, matchedField: item.field, matchedValue: ghent };
  }
  return { blocked: false };
}

export function isBlockedLocation(input: LocationInput) {
  return detectBlockedLocation(input).blocked;
}

const exactLocationNames = [...brusselsNames, ...ghentNames];
const blockedPostcodes = [...brusselsPostcodes, ...ghentPostcodes];
export const blockedLeadWhere = {
  OR: [
    ...["city", "municipality", "province"].flatMap((field) => exactLocationNames.map((name) => ({ [field]: { equals: name, mode: "insensitive" as const } }))),
    { postalCode: { in: blockedPostcodes } },
    ...["streetAddress", "formattedAddress"].flatMap((field) => exactLocationNames.map((name) => ({ [field]: { contains: name, mode: "insensitive" as const } }))),
  ],
} satisfies Prisma.LeadWhereInput;

// Een SQL `NOT (a OR b ...)` levert bij nullable adresvelden UNKNOWN op en kan
// daardoor ook geldige rijen verbergen. Deze positieve, NULL-veilige vorm is
// bedoeld voor alle leesquery's; de uitgebreidere JS-detector blijft de harde
// poort bij imports en mutaties.
export const nonBlockedLeadWhere = {
  AND: [
    { city: { notIn: exactLocationNames, mode: "insensitive" as const } },
    { OR: [{ municipality: null }, { municipality: { notIn: exactLocationNames, mode: "insensitive" as const } }] },
    { OR: [{ province: null }, { province: { notIn: exactLocationNames, mode: "insensitive" as const } }] },
    { OR: [{ postalCode: null }, { postalCode: { notIn: blockedPostcodes } }] },
  ],
} satisfies Prisma.LeadWhereInput;

export function visibleLeadWhere(base: Prisma.LeadWhereInput = {}): Prisma.LeadWhereInput {
  return { AND: [base, nonBlockedLeadWhere] };
}
