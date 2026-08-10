import { describe, expect, it } from "vitest";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import {
  coldEmailCampaignWeek,
  coldEmailDailyLimit,
  coldEmailSlot,
  immediateColdEmailAllowed,
  localDayKey,
  withinColdEmailWindow,
} from "@/lib/email/schedule";
import { pipelineStages, toManualPipelineOptions } from "@/lib/leads/pipeline";

const timeZone = "Europe/Amsterdam";

describe("cold-emailopbouw en tijdslots", () => {
  it("bouwt iedere zeven dagen op van twintig naar maximaal honderd", () => {
    expect(coldEmailDailyLimit("2026-08-03", "2026-08-04")).toBe(0);
    expect(coldEmailDailyLimit("2026-08-04", "2026-08-04")).toBe(20);
    expect(coldEmailDailyLimit("2026-08-10", "2026-08-04")).toBe(20);
    expect(coldEmailDailyLimit("2026-08-11", "2026-08-04")).toBe(30);
    expect(coldEmailDailyLimit("2026-09-22", "2026-08-04")).toBe(90);
    expect(coldEmailDailyLimit("2026-09-29", "2026-08-04")).toBe(100);
    expect(coldEmailDailyLimit("2027-08-04", "2026-08-04")).toBe(100);
    expect(coldEmailCampaignWeek("2026-08-10", "2026-08-04")).toBe(1);
    expect(coldEmailCampaignWeek("2026-08-11", "2026-08-04")).toBe(2);
  });

  it("verdeelt tien mails gelijkmatig binnen 09:00 en 17:00 Nederlandse tijd", () => {
    const slots = Array.from({ length: 10 }, (_, index) => coldEmailSlot("2026-08-04", index, 10, timeZone));
    expect(formatInTimeZone(slots[0], timeZone, "HH:mm")).toBe("09:24");
    expect(formatInTimeZone(slots[9], timeZone, "HH:mm")).toBe("16:36");
    expect(slots.every((slot) => withinColdEmailWindow(slot, timeZone))).toBe(true);
  });

  it("respecteert de lokale grenzen en staat de eenmalige directe verzending alleen vóór de start toe", () => {
    expect(withinColdEmailWindow(fromZonedTime("2026-08-04T09:00:00", timeZone), timeZone)).toBe(true);
    expect(withinColdEmailWindow(fromZonedTime("2026-08-04T16:59:00", timeZone), timeZone)).toBe(true);
    expect(withinColdEmailWindow(fromZonedTime("2026-08-04T17:00:00", timeZone), timeZone)).toBe(false);
    expect(immediateColdEmailAllowed(fromZonedTime("2026-08-03T23:59:00", timeZone), "2026-08-04", timeZone)).toBe(true);
    expect(immediateColdEmailAllowed(fromZonedTime("2026-08-04T00:00:00", timeZone), "2026-08-04", timeZone)).toBe(false);
  });

  it("reset de dagtelling op de Nederlandse kalenderdag", () => {
    expect(localDayKey(new Date("2026-08-10T21:59:59.000Z"), timeZone)).toBe("2026-08-10");
    expect(localDayKey(new Date("2026-08-10T22:00:00.000Z"), timeZone)).toBe("2026-08-11");
  });

  it("biedt Gemaild niet als handmatige keuze aan", () => {
    expect(toManualPipelineOptions([...pipelineStages].map((stage) => ({ id: stage.id, slug: stage.slug, name: stage.label, position: stage.position })), "nieuw").map((stage) => stage.slug))
      .not.toContain("gemaild");
  });
});
