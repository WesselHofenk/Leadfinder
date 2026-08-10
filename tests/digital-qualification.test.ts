import { describe, expect, it } from "vitest";
import { hasRequiredDigitalGap, inspectDigitalHtml } from "@/lib/leads/digital-qualification";

describe("objectieve digitale kwalificatie", () => {
  it("markeert een website pas verouderd bij minimaal twee objectieve problemen", () => {
    const oneIssue = inspectDigitalHtml("https://bedrijf.nl", "<html><head><meta name='viewport' content='width=device-width'></head><body>Welkom</body></html>");
    expect(oneIssue.objectiveIssues).toHaveLength(1);
    expect(oneIssue.status).toBe("WEBSITE_FOUND");

    const outdated = inspectDigitalHtml("http://bedrijf.nl", "<html><body><img src='kapot.jpg'><footer>© 2019</footer></body></html>");
    expect(outdated.objectiveIssues?.length).toBeGreaterThanOrEqual(2);
    expect(outdated.status).toBe("WEBSITE_OUTDATED");
    expect(hasRequiredDigitalGap(outdated)).toBe(true);
  });

  it("controleert zichtbare chatinterface én bekende widgets/scripts", () => {
    const withWidget = inspectDigitalHtml("https://bedrijf.nl", "<meta name='viewport' content='width=device-width'><a href='/contact'>Contact</a><script src='https://client.crisp.chat/l.js'></script>");
    expect(withWidget.chatbotStatus).toBe("PRESENT");
    expect(withWidget.evidence.some((item) => item.checkType === "CHATBOT_INTERFACE_AND_SCRIPT" && item.result === "PRESENT")).toBe(true);

    const withoutWidget = inspectDigitalHtml("https://bedrijf.nl", "<meta name='viewport' content='width=device-width'><a href='/contact'>Contact</a>");
    expect(withoutWidget.chatbotStatus).toBe("NOT_PRESENT");
    expect(withoutWidget.reason).toContain("geen zichtbare chatbot");
    expect(hasRequiredDigitalGap(withoutWidget)).toBe(true);
  });

  it("kwalificeert een defecte website maar faalt gesloten of onzekere controles elders dicht", () => {
    const broken = inspectDigitalHtml("https://bedrijf.nl", "", 503);
    expect(broken.status).toBe("WEBSITE_BROKEN");
    expect(hasRequiredDigitalGap(broken)).toBe(true);
  });
});
