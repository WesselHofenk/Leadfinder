import { describe, expect, it } from "vitest";

import { completedRunMessage, exhaustedSearchAreasReason, preservedCandidateCount, rejectionBreakdown } from "@/lib/jobs/generation-summary";

describe("eindmelding leadgeneratie", () => {
  it("gebruikt de werkelijke backendtellingen en verklaart een nulresultaat", () => {
    expect(completedRunMessage({
      candidatesChecked: 12,
      stored: 0,
      rejected: 10,
      emailsMissing: 2,
      languageRejected: 5,
      manualReview: 2,
      pendingCandidates: 2,
    })).toBe(
      "12 kandidaten zijn gecontroleerd. Geen kandidaten voldeden aan alle vaste criteria. "
      + "Meest voorkomende redenen: 5 waren niet Nederlandstalig, 2 hadden geen openbaar zakelijk e-mailadres. "
      + "2 kandidaten worden tijdens een volgende run verder gecontroleerd.",
    );
  });

  it("telt dezelfde retrykandidaat niet dubbel", () => {
    expect(preservedCandidateCount({ manualReview: 2, pendingCandidates: 2 })).toBe(2);
  });

  it("meldt succesvolle databasewrites, afwijzingen en retries afzonderlijk", () => {
    expect(completedRunMessage({
      candidatesChecked: 176,
      stored: 8,
      rejected: 166,
      manualReview: 2,
      pendingCandidates: 2,
    })).toBe(
      "8 nieuwe gekwalificeerde leads zijn opgeslagen in Nieuw. "
      + "176 kandidaten zijn gecontroleerd, 166 zijn afgewezen en 2 kandidaten worden tijdens een volgende run verder gecontroleerd.",
    );
  });

  it("beperkt de redenlijst tot de belangrijkste backendcategorieën", () => {
    expect(rejectionBreakdown({
      websitesFound: 82,
      invalidPhone: 47,
      duplicates: 31,
      languageRejected: 20,
      emailsInvalid: 5,
    }, 3)).toBe(
      "82 hadden een eigen website, 47 hadden geen geldig telefoonnummer, 31 waren duplicaten",
    );
  });

  it("spreekt succesvolle opslag niet tegen wanneer alle zoekgebieden zijn verwerkt", () => {
    expect(exhaustedSearchAreasReason({ candidatesChecked: 6, stored: 1, rejected: 2, manualReview: 4 })).toBe(
      "Alle beschikbare openbare zoekgebieden zijn voor deze run verwerkt. 1 gekwalificeerde lead blijft veilig opgeslagen in Nieuw.",
    );
    expect(exhaustedSearchAreasReason({ candidatesChecked: 6, stored: 0, rejected: 2, manualReview: 4 })).toBe(
      "Alle beschikbare openbare zoekgebieden zijn voor deze run verwerkt; geen kandidaat voldeed aan alle vaste criteria.",
    );
  });
});
