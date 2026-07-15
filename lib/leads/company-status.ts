const permanentBooleanFields = new Set([
  "permanentlyclosed", "ispermanentlyclosed", "closed", "isclosed",
]);

const temporaryBooleanFields = new Set([
  "temporarilyclosed", "istemporarilyclosed",
]);

const permanentKeyPrefixes = ["disused", "abandoned", "demolished", "removed", "razed"];
const permanentCollectionFields = new Set(["closuresignals", "labels", "badges"]);

function normalizeKey(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

export function normalizeBusinessStatusText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function isTruthyStatus(value: unknown) {
  if (value === true) return true;
  if (typeof value === "number") return value === 1;
  return ["1", "true", "yes", "ja", "closed", "gesloten"].includes(normalizeBusinessStatusText(value));
}

function hasNegatedPermanentPhrase(value: string) {
  return [
    "not permanently closed", "not closed permanently", "niet permanent gesloten", "niet definitief gesloten",
    "pas definitivement ferme", "nicht dauerhaft geschlossen", "nicht dauernd geschlossen",
  ].some((phrase) => value.includes(phrase));
}

function hasPermanentPhrase(value: unknown) {
  const normalized = normalizeBusinessStatusText(value);
  if (!normalized || hasNegatedPermanentPhrase(normalized)) return false;
  const compact = normalized.replaceAll(" ", "");
  return [
    "permanently closed", "permanent closed", "closed permanently", "permanent gesloten",
    "permanent gesloten bedrijf", "definitief gesloten", "voorgoed gesloten", "gesloten permanent",
    "definitivement ferme", "ferme definitivement", "dauernd geschlossen", "dauerhaft geschlossen",
  ].some((phrase) => normalized.includes(phrase)) ||
    ["permanentlyclosed", "permanentclosed", "closedpermanently", "permanentgesloten", "definitiefgesloten"]
      .some((phrase) => compact.includes(phrase));
}

function hasTemporaryPhrase(value: unknown) {
  const normalized = normalizeBusinessStatusText(value);
  return [
    "temporarily closed", "temporary closed", "closed temporarily", "tijdelijk gesloten", "temporairement ferme",
    "vorubergehend geschlossen", "voruebergehend geschlossen",
  ].some((phrase) => normalized.includes(phrase));
}

function inspectStatus(input: unknown, target: "permanent" | "temporary") {
  const visited = new WeakSet<object>();
  let nodes = 0;

  function visit(value: unknown, field = "", depth = 0, ancestors: string[] = []): boolean {
    if (depth > 12 || nodes > 2_000 || value == null) return false;
    nodes += 1;
    const key = normalizeKey(field);
    const insideOpeningSchedule = ancestors.some((ancestor) => ["openinghours", "regularopeninghours", "periods", "weekdaydescriptions"].includes(ancestor));

    if (target === "permanent") {
      if (permanentBooleanFields.has(key) && !(key === "closed" && insideOpeningSchedule) && isTruthyStatus(value)) return true;
      if (permanentKeyPrefixes.some((prefix) => key.startsWith(prefix)) && isTruthyStatus(value)) return true;
      if (key === "openinghours" && normalizeBusinessStatusText(value) === "closed") return true;
      if (hasPermanentPhrase(value)) return true;
      if (permanentCollectionFields.has(key) && typeof value === "string" &&
        ["disused", "abandoned", "demolished", "removed", "razed", "was", "end date"].includes(normalizeBusinessStatusText(value))) return true;
    } else {
      if (temporaryBooleanFields.has(key) && isTruthyStatus(value)) return true;
      if (hasTemporaryPhrase(value)) return true;
    }

    if (typeof value !== "object") return false;
    if (visited.has(value)) return false;
    visited.add(value);
    if (Array.isArray(value)) return value.some((item) => visit(item, field, depth + 1, ancestors));
    return Object.entries(value as Record<string, unknown>).some(([childField, child]) => visit(child, childField, depth + 1, [...ancestors, key]));
  }

  return visit(input);
}

export function isPermanentlyClosed(company: unknown) {
  return inspectStatus(company, "permanent");
}

export function isTemporarilyClosed(company: unknown) {
  return !isPermanentlyClosed(company) && inspectStatus(company, "temporary");
}
