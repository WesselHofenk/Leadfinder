import { describe, expect, it, vi } from "vitest";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

vi.mock("server-only", () => ({}));
import {
  automaticColdEmailBody,
  automaticColdEmailSubject,
  remainingColdEmailSlots,
} from "@/lib/email/campaign";

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
    expect(remainingColdEmailSlots("2026-08-05", 10, now, timeZone)).toEqual([]);
  });

  it("houdt de tekst persoonlijk zonder een websitegebrek te verzinnen", () => {
    expect(automaticColdEmailSubject("Voorbeeld BV")).toContain("Voorbeeld BV");
    expect(automaticColdEmailBody("Voorbeeld BV", "Utrecht", "NO_WEBSITE_CONFIRMED"))
      .toContain("nog geen eigen website");
    expect(automaticColdEmailBody("Voorbeeld BV", "Utrecht", "WEBSITE_OUTDATED"))
      .not.toContain("nog geen eigen website");
  });
});
