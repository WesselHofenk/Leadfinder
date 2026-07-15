import { describe, expect, it } from "vitest";
import { determineIntakeWebsiteStatus, evaluateNewLeadGate } from "@/lib/leads/intake-gate";
import { extractCompanyWebsite, isNonOwnedWebsite, normalizeWebsiteUrl } from "@/lib/leads/website";

describe("defensieve website-extractie", () => {
  it.each([
    ["bruna.nl", "https://bruna.nl"],
    ["www.bruna.nl", "https://bruna.nl"],
    ["HTTPS://WWW.BRUNA.NL/", "https://bruna.nl"],
    ["bruna.nl/contact", "https://bruna.nl/contact"],
  ])("normaliseert %s", (raw, expected) => expect(normalizeWebsiteUrl(raw)).toBe(expected));

  it("decodeert HTML-entiteiten en haalt een echt domein uit een redirectparameter", () => {
    expect(normalizeWebsiteUrl("https://google.com/url?url=https%3A%2F%2FWWW.BRUNA.NL%2F%3Futm_source%3Dmaps&amp;sa=t")).toBe("https://bruna.nl");
  });

  it("behoudt een eigen domein wanneer dat zelf een boekingsparameter bevat", () => {
    expect(normalizeWebsiteUrl("https://bruna.nl/redirect?url=https%3A%2F%2Fbooking.com%2Fbruna")).toBe("https://bruna.nl/redirect?url=https://booking.com/bruna");
  });

  it("vindt websites in geneste objecten, arrays en anders genoemde velden", () => {
    expect(extractCompanyWebsite({ rawData: { contactInfo: { links: [{ type: "official", href: "bruna.nl" }] } } })).toBe("https://bruna.nl");
    expect(extractCompanyWebsite({ sourceData: { attributes: { official_website: "https://bruna.nl/contact" } } })).toBe("https://bruna.nl/contact");
  });

  it.each([
    "https://facebook.com/bruna", "https://maps.google.com/?q=bruna", "https://sub.telefoongids.nl/bruna",
    "https://openingstijden.nl/bruna", "https://tripadvisor.com/bruna", "https://treatwell.nl/bruna",
  ])("behandelt platform %s niet als eigen website", (url) => {
    expect(isNonOwnedWebsite(url)).toBe(true);
    expect(extractCompanyWebsite({ externalLinks: [url] })).toBeNull();
  });

  it("verkiest een officieel domein wanneer daarnaast sociale profielen bestaan", () => {
    expect(extractCompanyWebsite({ socialLinks: ["https://instagram.com/bruna"], details: { companyWebsite: "bruna.nl" } })).toBe("https://bruna.nl");
  });

  it("crasht niet op onverwachte of cyclische brondata", () => {
    const raw: Record<string, unknown> = { links: [null, 42, { label: "geen URL" }] };
    raw.self = raw;
    expect(extractCompanyWebsite(raw)).toBeNull();
  });
});

describe("fail-closed save-gate voor uitsluitend nieuwe leads", () => {
  const confirmed = { status: "NO_WEBSITE_CONFIRMED" as const, website: null, reason: "Expliciet bevestigd" };
  const unknown = { status: "UNKNOWN" as const, website: null, reason: "Timeout" };

  it("laat uitsluitend NO_WEBSITE_CONFIRMED door", () => {
    expect(evaluateNewLeadGate({ companyName: "Nieuwe lead" }, confirmed)).toMatchObject({ allowed: true, websiteStatus: "NO_WEBSITE_CONFIRMED" });
    expect(evaluateNewLeadGate({ companyName: "Nieuwe lead" }, unknown)).toMatchObject({ allowed: false, reason: "SKIPPED_WEBSITE_UNKNOWN" });
  });

  it("sluit een expliciet bedrijfsdomein direct uit zonder netwerkbezoek", () => {
    expect(determineIntakeWebsiteStatus({ details: { website_url: "bruna.nl" } }, unknown)).toMatchObject({ status: "HAS_WEBSITE", website: "https://bruna.nl" });
    expect(evaluateNewLeadGate({ website: "bruna.nl" }, unknown)).toMatchObject({ allowed: false, reason: "SKIPPED_HAS_WEBSITE" });
  });

  it("sluit permanent gesloten bedrijven uit vóór alle andere beslissingen", () => {
    expect(evaluateNewLeadGate({ business_status: "permanently_closed", website: "bruna.nl" }, confirmed)).toMatchObject({ allowed: false, reason: "SKIPPED_PERMANENTLY_CLOSED" });
  });

  it.each(["SOCIAL_ONLY", "MANUAL_REVIEW_REQUIRED", "NO_WEBSITE_LIKELY"] as const)("slaat onzekere status %s nooit als lead op", (status) => {
    expect(evaluateNewLeadGate({}, { status, website: null, reason: "Niet bevestigd" })).toMatchObject({ allowed: false, reason: "SKIPPED_WEBSITE_UNKNOWN" });
  });

  it("muteert de aangeleverde bedrijfsgegevens niet", () => {
    const company = Object.freeze({ companyName: "Bewaard", rawData: Object.freeze({ website: null }) });
    evaluateNewLeadGate(company, confirmed);
    expect(company).toEqual({ companyName: "Bewaard", rawData: { website: null } });
  });
});
