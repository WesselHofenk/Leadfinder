export type ScoreSignals = {
  reachable: boolean; mobileScore: number | null; desktopScore: number | null; viewport: boolean | null;
  cta: boolean | null; form: boolean | null; placeholder: boolean | null; outdatedCopyright: boolean | null;
  brokenLinks: number; brokenImages?: number; loadTimeMs: number | null; https?: boolean | null;
  invalidSsl?: boolean | null; legacyTechnology?: boolean | null; tinyText?: boolean | null;
};

export function classifyWebsiteScore(score: number) {
  if (score >= 60) return "OUTDATED" as const;
  if (score >= 30) return "IMPROVABLE" as const;
  return "USABLE" as const;
}

export function scoreWebsite(signals: ScoreSignals) {
  const reasons: { code: string; label: string; weight: number }[] = [];
  const add = (code: string, label: string, weight: number) => reasons.push({ code, label, weight });
  if (!signals.reachable) add("UNREACHABLE", "Website na meerdere pogingen niet bereikbaar", 60);
  if (signals.https === false) add("NO_HTTPS", "Website gebruikt geen HTTPS", 12);
  if (signals.invalidSsl) add("INVALID_SSL", "HTTPS-certificaat kon niet veilig worden gevalideerd", 30);
  if (signals.mobileScore !== null && signals.mobileScore < 50) add("VERY_SLOW_MOBILE", `Mobiele score ${signals.mobileScore}/100`, 22);
  else if (signals.mobileScore !== null && signals.mobileScore < 75) add("SLOW_MOBILE", `Mobiele score ${signals.mobileScore}/100`, 12);
  if (signals.desktopScore !== null && signals.desktopScore < 60) add("SLOW_DESKTOP", `Desktopscore ${signals.desktopScore}/100`, 8);
  if (signals.viewport === false) add("NOT_MOBILE_FRIENDLY", "Viewport-instelling ontbreekt", 18);
  if (signals.cta === false) add("NO_CTA", "Geen duidelijke contact- of actieknop gevonden", 10);
  if (signals.form === false) add("NO_CONTACT_FORM", "Geen contactformulier gevonden", 7);
  if (signals.placeholder) add("PLACEHOLDER", "Placeholder, onderhouds- of onafgemaakte pagina", 35);
  if (signals.outdatedCopyright) add("OUTDATED_COPYRIGHT", "Copyrightvermelding is verouderd", 5);
  if (signals.brokenLinks > 0) add("BROKEN_LINKS", `${signals.brokenLinks} niet-werkende interne links in steekproef`, Math.min(16, signals.brokenLinks * 4));
  if ((signals.brokenImages ?? 0) > 0) add("BROKEN_IMAGES", `${signals.brokenImages} kapotte afbeeldingen in steekproef`, Math.min(12, (signals.brokenImages ?? 0) * 4));
  if (signals.legacyTechnology) add("LEGACY_TECH", "Verouderde webtechniek of oude library aangetroffen", 18);
  if (signals.tinyText) add("TINY_TEXT", "Zeer kleine tekstgrootte in de pagina aangetroffen", 8);
  if ((signals.loadTimeMs ?? 0) > 8_000) add("VERY_SLOW_RESPONSE", "Zeer trage serverreactie", 14);
  else if ((signals.loadTimeMs ?? 0) > 4_000) add("SLOW_RESPONSE", "Trage serverreactie", 8);
  const opportunityScore = Math.min(100, reasons.reduce((sum, reason) => sum + reason.weight, 0));
  const conversionQualityScore = Math.max(0, 100 - opportunityScore);
  return { opportunityScore, conversionQualityScore, reasons, classification: classifyWebsiteScore(opportunityScore) };
}
