import { describe, expect, it } from "vitest";
import { determineWebsiteStatus, normalizeWebsite } from "@/lib/leads/website";

describe("centrale website-status", () => {
  it.each(["https://byyoel.nl", "byyoel.nl", " www.BYYOEL.nl "])("herkent %s als eigen website", (website) => {
    expect(determineWebsiteStatus({ companyName: "By Yoel", website }).status).toBe("has_website");
  });

  it("repareert By Yoel wanneer de URL alleen in websiteUrl staat", () => {
    expect(determineWebsiteStatus({ companyName: "By Yoel", website: null, websiteUrl: " https://byyoel.nl " })).toMatchObject({ status: "has_website", normalizedUrl: "https://byyoel.nl", source: "websiteUrl" });
  });

  it("classificeert volledig lege websitevelden als geen website", () => {
    expect(determineWebsiteStatus({ website: "  ", websiteUrl: null, website_url: undefined, domain: "n.v.t." }).status).toBe("no_website");
  });

  it.each([
    "https://facebook.com/byyoel",
    "https://instagram.com/byyoel",
    "https://google.com/maps/place/By+Yoel",
  ])("telt extern profiel %s niet als eigen website", (website) => {
    expect(determineWebsiteStatus({ externalWebsite: website }).status).toBe("no_website");
  });

  it("houdt een eigen domein dat doorlinkt naar een boekingssysteem als eigen website", () => {
    expect(determineWebsiteStatus({ website: "https://byyoel.nl" }, { reachable: true, httpStatus: 200, auditClassification: "USABLE" })).toMatchObject({ status: "has_website", normalizedUrl: "https://byyoel.nl" });
  });

  it("maakt een timeout onbekend en nooit geen website", () => {
    expect(determineWebsiteStatus({ website: "byyoel.nl" }, { reachable: false, failureKind: "timeout" }).status).toBe("unknown");
  });

  it("maakt een HTTP 403 onbekend en nooit geen website", () => {
    expect(determineWebsiteStatus({ website: "byyoel.nl" }, { reachable: false, httpStatus: 403, failureKind: "forbidden" }).status).toBe("unknown");
  });

  it("normaliseert spaties, protocol, hoofdletters en trackingparameters", () => {
    expect(normalizeWebsite("  HTTPS://WWW.ByYoel.NL/?utm_source=maps&fbclid=test  ")).toBe("https://byyoel.nl");
  });

  it("controleert alle ondersteunde bronvelden en verkiest een eigen domein boven een profiel", () => {
    expect(determineWebsiteStatus({ googleMapsWebsite: "https://instagram.com/byyoel", businessWebsite: "byyoel.nl" })).toMatchObject({ status: "has_website", source: "businessWebsite", normalizedUrl: "https://byyoel.nl" });
  });
});
