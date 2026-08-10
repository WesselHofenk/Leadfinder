import type { ColdEmailTemplate } from "@prisma/client";

export const COLD_EMAIL_SUBJECT = "online uitstraling";

const forbiddenPersonalization = /\[(?:Bedrijfsnaam|Voornaam)\]|\b(?:undefined|null|None)\b/i;

function inline(value: string) {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function requiredCompanyName(value: string) {
  const companyName = inline(value);
  if (!companyName || forbiddenPersonalization.test(companyName)) {
    throw new Error("De bedrijfsnaam is ongeldig voor personalisatie.");
  }
  return companyName;
}

export function contactFirstName(value?: string | null) {
  const name = inline(value ?? "");
  if (!name || forbiddenPersonalization.test(name)) return null;
  const withoutSalutation = name.replace(/^(?:dhr\.?|mevr\.?|meneer|mevrouw)\s+/i, "");
  return withoutSalutation.split(/[\s,]+/)[0] || null;
}

export function coldEmailTemplateForSequence(sequence: number): ColdEmailTemplate {
  if (!Number.isInteger(sequence) || sequence < 0) throw new Error("Ongeldige templatevolgorde.");
  return sequence % 2 === 0 ? "A" : "B";
}

export function renderAutomaticColdEmail(
  template: ColdEmailTemplate,
  companyValue: string,
  contactName?: string | null,
) {
  const companyName = requiredCompanyName(companyValue);
  const firstName = contactFirstName(contactName);
  const greeting = template === "B" && firstName ? `Hoi ${firstName},` : "Hoi,";
  const bodyText = template === "A"
    ? `Hoi,

Ik bekeek de website van ${companyName} en zag dat die op een paar punten verouderd oogt.

Daardoor krijgen potentiële klanten online mogelijk niet direct het beste beeld van wat jullie doen en kan de website minder prettig werken op mobiel.

Ik heb een voorbeeld gemaakt van hoe uw site eruit zou kunnen zien. Zou ik die naar jullie opsturen?

Met vriendelijke groet,

Wessel Hofenk
Sitora`
    : `${greeting}

Ik kwam de website van ${companyName} tegen en zag een paar kansen om deze moderner, duidelijker en gebruiksvriendelijker te maken.

Veel klanten zoeken tegenwoordig eerst online voordat ze bellen of een aanvraag doen. Een verouderde website kan er daardoor voor zorgen dat potentiële klanten afhaken of het bedrijf minder snel vertrouwen.

Wij helpen bedrijven met een professionele website die duidelijk laat zien wat ze doen en meer aanvragen kan opleveren.

Ik heb een voorbeeld gemaakt van hoe uw site eruit zou kunnen zien. Zou ik die naar jullie opsturen?

Met vriendelijke groet,

Wessel Hofenk
Sitora`;

  if (forbiddenPersonalization.test(bodyText)) {
    throw new Error("De e-mail bevat een ongeldige personalisatieplaceholder.");
  }
  return { subject: COLD_EMAIL_SUBJECT, bodyText, template };
}
