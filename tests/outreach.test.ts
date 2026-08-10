import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildColdEmail, buildOutdatedWebsiteEmail, isDailyOutreachWindow, localOutreachTime, scheduledOutreachTarget, weeklyOutreachLimit } from "@/lib/jobs/outreach";

describe("dagelijkse cold-emailautomatisering", () => {
  it("vult de bedrijfsnaam in zonder templatevelden achter te laten", () => {
    const mail = buildColdEmail({ companyName: "De Goede Schilder", senderName: "Wessel Hofenk" });
    expect(mail.subject).toBe("online vindbaarheid");
    expect(mail.text).toContain("Hoi,");
    expect(mail.text).toContain("Ik zocht De Goede Schilder online");
    expect(mail.text).toContain("Ik kan vrijblijvend een voorbeeld maken");
    expect(mail.text).not.toContain("een eerste opzet");
    expect(mail.text).toContain("Wessel Hofenk\nSitora");
    expect(mail.text).not.toContain("{{");
  });

  it("valt veilig terug op een algemene begroeting", () => {
    const mail = buildColdEmail({ companyName: "Voorbeeldbedrijf", senderName: "Wessel Hofenk" });
    expect(mail.text.startsWith("Hoi,\n")).toBe(true);
  });

  it("gebruikt voor een verouderde website de juiste observatie en één eenvoudige vraag", () => {
    const mail = buildOutdatedWebsiteEmail({ companyName: "De Goede Schilder", senderName: "Wessel Hofenk" });
    expect(mail.subject).toBe("online uitstraling");
    expect(mail.text).toContain("website van De Goede Schilder");
    expect(mail.text).toContain("verouderd oogt");
    expect(mail.text).toContain("Ik heb voor jullie een voorbeeld gemaakt waarin jullie website er moderner en duidelijker uit ziet. Zal ik die naar je sturen?");
    expect(mail.text).not.toContain("geen eigen website");
    expect(mail.text).toContain("Wessel Hofenk\nSitora");
  });

  it("staat verzending alleen tussen 09:00 en 17:00 Nederlandse tijd toe", () => {
    expect(isDailyOutreachWindow(new Date("2026-08-01T06:59:00Z"))).toBe(false);
    expect(isDailyOutreachWindow(new Date("2026-08-01T07:00:00Z"))).toBe(true);
    expect(isDailyOutreachWindow(new Date("2026-08-01T14:59:00Z"))).toBe(true);
    expect(isDailyOutreachWindow(new Date("2026-08-01T15:00:00Z"))).toBe(false);
    expect(isDailyOutreachWindow(new Date("2026-12-01T07:59:00Z"))).toBe(false);
    expect(isDailyOutreachWindow(new Date("2026-12-01T08:00:00Z"))).toBe(true);
    expect(isDailyOutreachWindow(new Date("2026-12-01T15:59:00Z"))).toBe(true);
    expect(isDailyOutreachWindow(new Date("2026-12-01T16:00:00Z"))).toBe(false);
    expect(localOutreachTime(new Date("2026-08-01T07:30:00Z")).dateKey).toBe("2026-08-01");
  });

  it("verhoogt de daglimiet vanaf 10 augustus wekelijks van 20 naar maximaal 100", () => {
    expect(weeklyOutreachLimit(new Date("2026-08-10T10:00:00Z"), 100)).toBe(20);
    expect(weeklyOutreachLimit(new Date("2026-08-16T10:00:00Z"), 100)).toBe(20);
    expect(weeklyOutreachLimit(new Date("2026-08-17T10:00:00Z"), 100)).toBe(30);
    expect(weeklyOutreachLimit(new Date("2026-10-05T10:00:00Z"), 100)).toBe(100);
    expect(weeklyOutreachLimit(new Date("2026-10-11T10:00:00Z"), 100)).toBe(100);
    expect(weeklyOutreachLimit(new Date("2027-01-01T10:00:00Z"), 100)).toBe(100);
  });

  it("verdeelt iedere daglimiet cumulatief over acht uurrondes", () => {
    const summerSlots = Array.from({ length: 8 }, (_, index) => new Date(`2026-08-10T${String(index + 7).padStart(2, "0")}:30:00Z`));
    expect(summerSlots.map((now) => scheduledOutreachTarget(now, 10))).toEqual([2, 3, 4, 5, 7, 8, 9, 10]);
    expect(summerSlots.map((now) => scheduledOutreachTarget(now, 100))).toEqual([13, 25, 38, 50, 63, 75, 88, 100]);
    expect(scheduledOutreachTarget(new Date("2026-08-10T06:59:00Z"), 100)).toBe(0);
    expect(scheduledOutreachTarget(new Date("2026-08-10T15:00:00Z"), 100)).toBe(100);
  });

  it("voegt de pipelinefase en uitsluitend additieve verzendregistratie toe", () => {
    const migration = readFileSync(resolve("prisma/migrations/20260801103000_daily_cold_outreach/migration.sql"), "utf8");
    expect(migration).toContain("ADD VALUE IF NOT EXISTS 'EMAILED'");
    expect(migration).toContain('CREATE TABLE "OutreachEmail"');
    expect(migration).toContain('CREATE UNIQUE INDEX "OutreachEmail_leadId_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "OutreachEmail_recipientEmail_key"');
    expect(migration).not.toMatch(/DELETE\s+FROM|TRUNCATE/i);
  });

  it("zet iedere succesvol gemailde lead vanuit iedere fase naar Gemaild", () => {
    const migration = readFileSync(resolve("prisma/migrations/20260806232500_enforce_emailed_after_every_send/migration.sql"), "utf8");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION sync_sent_outreach_to_emailed_lead");
    expect(migration).toContain('AND "status" <> \'EMAILED\'');
    expect(migration).toContain('"status" = \'EMAILED\'');
    expect(migration).toContain('WHERE "status" = \'SENT\'');
    expect(migration).not.toMatch(/DELETE\s+FROM|TRUNCATE/i);
  });
});
