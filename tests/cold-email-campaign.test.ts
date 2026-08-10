import { describe, expect, it, vi } from "vitest";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

vi.mock("server-only", () => ({}));
import {
  availableColdEmailSlots,
  coldEmailBatchDayKey,
  remainingDailyColdEmailCapacity,
  remainingColdEmailSlots,
} from "@/lib/email/campaign";
import {
  COLD_EMAIL_SUBJECT,
  coldEmailTemplateForSequence,
  renderAutomaticColdEmail,
} from "@/lib/email/templates";

const timeZone = "Europe/Amsterdam";

describe("automatische dagelijkse cold-emailbatch", () => {
  it("verdeelt een gemiste ochtendbatch alsnog geleidelijk tot 17:00", () => {
    const now = fromZonedTime("2026-08-04T12:00:00", timeZone);
    const slots = remainingColdEmailSlots("2026-08-04", 10, now, timeZone);
    expect(slots).toHaveLength(10);
    expect(slots.every((slot) => slot > now)).toBe(true);
    expect(slots.every((slot) => formatInTimeZone(slot, timeZone, "HH:mm") < "17:00")).toBe(true);
    expect(new Set(slots.map((slot) => slot.getTime())).size).toBe(10);
  });

  it("propt geen volledige dagbatch in de laatste minuten van het venster", () => {
    const now = fromZonedTime("2026-08-05T16:39:00", timeZone);
    expect(remainingColdEmailSlots("2026-08-05", 10, now, timeZone, 20)).toEqual([]);
    expect(coldEmailBatchDayKey(now, timeZone, 10, 20)).toBe("2026-08-06");
  });

  it("blijft tijdens een normale ochtendrun dezelfde dag inplannen", () => {
    const now = fromZonedTime("2026-08-05T10:00:00", timeZone);
    expect(coldEmailBatchDayKey(now, timeZone)).toBe("2026-08-05");
  });

  it("gebruikt bij later aanvullen alleen nog vrije tijdslots", () => {
    const now = fromZonedTime("2026-08-05T20:00:00", timeZone);
    const occupied = [fromZonedTime("2026-08-06T09:24:00", timeZone)];
    const slots = availableColdEmailSlots("2026-08-06", 9, now, timeZone, occupied);

    expect(slots).toHaveLength(9);
    expect(slots).not.toContainEqual(occupied[0]);
    expect(new Set([...occupied, ...slots].map((slot) => slot.getTime())).size).toBe(10);
  });

  it("wisselt A en B duurzaam op basis van de opgeslagen volgorde", () => {
    expect([0, 1, 2, 3].map(coldEmailTemplateForSequence)).toEqual(["A", "B", "A", "B"]);
    const persistedSequenceAfterRestart = 8;
    expect(coldEmailTemplateForSequence(persistedSequenceAfterRestart)).toBe("A");
  });

  it("telt alleen successen en nog actieve reserveringen tegen het dagmaximum", () => {
    expect(remainingDailyColdEmailCapacity(20, 18, 0)).toBe(2);
    expect(remainingDailyColdEmailCapacity(20, 18, 2)).toBe(0);
    expect(remainingDailyColdEmailCapacity(20, 20, 0)).toBe(0);
  });

  it("gebruikt exact het onderwerp en personaliseert beide templates", () => {
    const templateA = renderAutomaticColdEmail("A", "Voorbeeld BV", "Eva Jansen");
    const templateB = renderAutomaticColdEmail("B", "Voorbeeld BV", "Eva Jansen");
    expect(templateA.subject).toBe(COLD_EMAIL_SUBJECT);
    expect(templateA.bodyText).toContain("website van Voorbeeld BV");
    expect(templateB.bodyText).toContain("Hoi Eva,");
    expect(templateB.bodyText).toContain("website van Voorbeeld BV");
  });

  it("valt zonder voornaam terug op Hoi en laat nooit placeholders door", () => {
    const rendered = renderAutomaticColdEmail("B", "Voorbeeld BV", null);
    expect(rendered.bodyText.startsWith("Hoi,\n")).toBe(true);
    expect(rendered.bodyText).not.toMatch(/\[Bedrijfsnaam\]|\[Voornaam\]|undefined|null|None/);
    expect(() => renderAutomaticColdEmail("A", "[Bedrijfsnaam]", null)).toThrow("bedrijfsnaam");
  });
});
