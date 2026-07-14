export const dateFormatter = new Intl.DateTimeFormat("nl-NL", { day: "2-digit", month: "short", year: "numeric" });
export const numberFormatter = new Intl.NumberFormat("nl-NL");
export const statusLabels: Record<string, string> = {
  NEW: "Nieuw", NOT_CALLED: "Nog niet gebeld", NO_ANSWER: "Geen gehoor", CALLBACK: "Terugbellen", INTERESTED: "Interesse",
  QUOTE_SENT: "Offerte verstuurd", CUSTOMER: "Klant geworden", NOT_INTERESTED: "Geen interesse", DO_NOT_CONTACT: "Niet benaderen", INVALID_NUMBER: "Ongeldig nummer",
  PENDING: "Gepland", RUNNING: "Bezig", COMPLETE: "Voltooid", FAILED: "Mislukt", PAUSED: "Gepauzeerd",
  CALLED: "Gebeld", INVOICED: "Gefactureerd", FILTERED: "Gefilterd", NO_WEBSITE: "Geen website", OUTDATED_WEBSITE: "Verouderde website",
};
