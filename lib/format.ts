export const dateFormatter = new Intl.DateTimeFormat("nl-NL", { day: "2-digit", month: "short", year: "numeric" });
export const numberFormatter = new Intl.NumberFormat("nl-NL");
export const currencyFormatter = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
export const websiteStatusLabels: Record<string, string> = {
  NO_WEBSITE_CONFIRMED:"Geen website bevestigd", NO_WEBSITE_LIKELY:"Waarschijnlijk geen website", SOCIAL_ONLY:"Alleen extern profiel",
  WEBSITE_FOUND:"Eigen website gevonden", WEBSITE_OUTDATED:"Website verouderd", WEBSITE_BROKEN:"Website kapot",
  MANUAL_REVIEW_REQUIRED:"Handmatige controle", UNKNOWN:"Onbekend", NO_OWN_WEBSITE:"Geen website (oud)", OWN_WEBSITE:"Eigen website (oud)",
  OUTDATED:"Verouderd (oud)", IMPROVABLE:"Verbeterbaar (oud)",
};
export const statusLabels: Record<string, string> = {
  NEW:"Nieuw", NEEDS_REVIEW:"Te controleren", VERIFIED:"Geverifieerd", CALLED:"Gebeld", NO_ANSWER:"Geen gehoor", CALL_BACK:"Terugbellen",
  INTERESTED:"Geïnteresseerd", APPOINTMENT:"Afspraak", QUOTE_SENT:"Offerte verstuurd", WON:"Gewonnen", INVOICED:"Gefactureerd",
  LOST:"Verloren", REJECTED:"Afgewezen", HAS_WEBSITE:"Heeft website", PERMANENTLY_CLOSED:"Permanent gesloten",
  DO_NOT_CONTACT:"Niet benaderen", FILTERED:"Gefilterd", PENDING:"Gepland", RUNNING:"Bezig", COMPLETE:"Voltooid", FAILED:"Mislukt",
  CANCELLED:"Geannuleerd", PAUSED:"Gepauzeerd", NO_WEBSITE:"Geen website", OUTDATED_WEBSITE:"Verouderde website",
  IMPROVABLE_WEBSITE:"Website verbeterbaar", OPERATIONAL:"Operationeel", UNKNOWN:"Status onbekend", CLOSED_TEMPORARILY:"Tijdelijk gesloten",
  CLOSED_PERMANENTLY:"Permanent gesloten", FUTURE_OPENING:"Opent later", GOOGLE_PLACES:"Google Places (historisch)", OPENSTREETMAP:"OpenStreetMap",
  OPEN_DATA:"Open data", PUBLIC_WEBSITE:"Openbare website", MANUAL:"Handmatig", ...websiteStatusLabels,
};
