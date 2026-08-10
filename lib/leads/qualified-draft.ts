import { evaluateNewLeadGate } from "./intake-gate";
import { validateCandidateBasics, type Candidate } from "./eligibility";
import { normalizeEmails, normalizePhones } from "./normalization";
import type { ValidatedContacts } from "./contact-validation";
import type { WebsiteVerificationResult } from "./website-verification";

export type DeliverableContacts = Extract<ValidatedContacts, { ok: true }>;

export type QualifiedDraftPayload = {
  candidate: Candidate;
  verification: WebsiteVerificationResult;
  contacts: Omit<DeliverableContacts, "emailValidatedAt" | "phoneValidatedAt"> & {
    emailValidatedAt: string | Date;
    phoneValidatedAt: string | Date;
  };
};

export type DraftQualification =
  | { valid: true; contacts: DeliverableContacts }
  | { valid: false; retry: boolean; reason: string };
export type DraftRejection = Extract<DraftQualification, { valid: false }>;

const flemishProvinces = new Set([
  "antwerpen",
  "limburg",
  "oost-vlaanderen",
  "oost vlaanderen",
  "west-vlaanderen",
  "west vlaanderen",
  "vlaams-brabant",
  "vlaams brabant",
]);

export function precheckQualifiedLocation(candidate: Candidate): DraftRejection | null {
  let supported = candidate.country.toUpperCase() === "NL";
  if (candidate.country.toUpperCase() === "BE") {
    supported = flemishProvinces.has((candidate.province ?? "").trim().toLocaleLowerCase("nl"));
  }
  if (!supported) {
    return {
      valid: false,
      retry: candidate.country.toUpperCase() === "BE" && !candidate.province,
      reason: "locatie_niet_nederlandstalig_vlaanderen",
    };
  }
  // OpenStreetMap levert één concrete fysieke bedrijfsvermelding, maar geen
  // betrouwbaar totaal aantal vestigingen. Bekende keten-/merk-signalen zijn
  // hierboven al door validateCandidateBasics afgewezen, dus een ontbrekend
  // totaal mag zo'n lokale OSM-vermelding niet permanent blokkeren.
  if (candidate.branchCount == null && candidate.source === "OPENSTREETMAP") {
    return null;
  }
  if (candidate.branchCount !== 1) {
    return {
      valid: false,
      retry: candidate.branchCount == null,
      reason: candidate.branchCount == null ? "vestigingsaantal_onzeker" : "meerdere_vestigingen",
    };
  }
  return null;
}

/**
 * Rechecks the durable proof snapshot without starting a new network request.
 * MX and phone proof must already have been obtained in the current run.
 */
export function recheckQualifiedDraft(payload: QualifiedDraftPayload): DraftQualification {
  const basic = validateCandidateBasics(payload.candidate);
  if (!basic.ok) return { valid: false, retry: basic.reason === "onbetrouwbare_status", reason: basic.reason };
  const location = precheckQualifiedLocation(payload.candidate);
  if (location) return location;
  const gate = evaluateNewLeadGate(payload.candidate, payload.verification);
  if (!gate.allowed) {
    return { valid: false, retry: gate.reason === "SKIPPED_WEBSITE_UNKNOWN", reason: gate.reason };
  }

  const normalizedEmail = normalizeEmails([
    payload.candidate.email,
    ...(payload.candidate.emailAddresses ?? []),
  ])[0];
  const normalizedPhone = normalizePhones([
    payload.candidate.internationalPhoneNumber,
    payload.candidate.phoneNumber,
    ...(payload.candidate.phoneNumbers ?? []),
  ], payload.candidate.country)[0];
  const emailValidatedAt = new Date(payload.contacts.emailValidatedAt);
  const phoneValidatedAt = new Date(payload.contacts.phoneValidatedAt);
  if (
    payload.contacts.emailStatus !== "DELIVERABLE"
    || !normalizedEmail
    || payload.contacts.email !== normalizedEmail
    || !payload.contacts.emailSource
    || !Number.isFinite(emailValidatedAt.getTime())
  ) {
    return { valid: false, retry: true, reason: "email_mx_niet_bevestigd" };
  }
  if (
    payload.contacts.phoneStatus !== "VALID"
    || !normalizedPhone
    || payload.contacts.phone !== normalizedPhone
    || !payload.contacts.phoneSource
    || !Number.isFinite(phoneValidatedAt.getTime())
  ) {
    return { valid: false, retry: true, reason: "telefoon_niet_bevestigd" };
  }
  return {
    valid: true,
    contacts: {
      ...payload.contacts,
      emailValidatedAt,
      phoneValidatedAt,
    },
  };
}
