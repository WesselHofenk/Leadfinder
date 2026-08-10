import type { Evidence, WebsiteVerificationResult } from "./website-verification";

const chatbotPatterns = [
  /intercom/i, /crisp\.chat/i, /tawk\.to/i, /drift\.com/i, /livechat/i, /chatwoot/i,
  /zendesk.*(chat|messenger)/i, /hubspot.*conversations/i, /freshchat/i,
  /aria-label=["'][^"']*(chat|bericht)/i, />\s*(chat met ons|start chat|live chat)\s*</i,
];

export function inspectDigitalHtml(url: string, html: string, statusCode = 200): WebsiteVerificationResult {
  const issues: string[] = [];
  if (!url.startsWith("https://")) issues.push("Geen beveiligde HTTPS-verbinding");
  if (statusCode >= 400) issues.push(`Website reageert met HTTP ${statusCode}`);
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) issues.push("Geen mobiele viewportconfiguratie");
  if (!/(contact|offerte|boek|reserveer|afspraak|bel ons|mailto:|tel:)/i.test(html)) issues.push("Geen duidelijke contact-, boekings- of offerteactie");
  const years = [...html.matchAll(/(?:©|copyright)\s*(20\d{2})/gi)].map((match) => Number(match[1]));
  if (years.length && Math.max(...years) < new Date().getFullYear() - 2) issues.push("Duidelijk verouderde copyright- of inhoudsdatum");
  if (/<img\b(?![^>]*\balt=)[^>]*>/i.test(html)) issues.push("Afbeeldingen zonder alternatieve tekst");

  const chatbotPresent = chatbotPatterns.some((pattern) => pattern.test(html));
  const evidence: Evidence[] = [
    ...issues.map((issue) => ({ checkType: "OBJECTIVE_WEBSITE_ISSUE", result: "FOUND", confidence: 90, evidenceUrl: url, shortExplanation: issue })),
    {
      checkType: "CHATBOT_INTERFACE_AND_SCRIPT",
      result: chatbotPresent ? "PRESENT" : "NOT_PRESENT",
      confidence: 88,
      evidenceUrl: url,
      shortExplanation: chatbotPresent
        ? "Een zichtbare chatindicatie of bekende chatwidget/script-signatuur is aangetroffen."
        : "Zowel zichtbare chatlabels als bekende widget- en scriptsignaturen zijn gecontroleerd en niet aangetroffen.",
    },
  ];
  const outdated = issues.length >= 2;
  return {
    status: statusCode >= 400 ? "WEBSITE_BROKEN" : outdated ? "WEBSITE_OUTDATED" : "WEBSITE_FOUND",
    confidence: statusCode >= 400 ? 95 : 88,
    website: url,
    chatbotStatus: chatbotPresent ? "PRESENT" : "NOT_PRESENT",
    chatbotReason: evidence.at(-1)?.shortExplanation,
    objectiveIssues: issues,
    reason: outdated
      ? `Verouderde of slecht functionerende website op basis van ${issues.length} objectieve problemen: ${issues.join("; ")}.`
      : chatbotPresent
        ? "Website functioneert zonder twee aangetoonde verouderingsproblemen en bevat een chatfunctie."
        : "Website gecontroleerd: geen zichtbare chatbot en geen bekende chatwidget of chatscript aangetroffen.",
    evidence,
  };
}

export async function inspectOwnedWebsite(url: string, fetchImpl: typeof fetch = fetch): Promise<WebsiteVerificationResult> {
  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(5_000),
      headers: { "User-Agent": "LeadfinderSitora/5.0 digital-qualification" },
    });
    const html = (await response.text()).slice(0, 1_000_000);
    return inspectDigitalHtml(response.url || url, html, response.status);
  } catch {
    return {
      status: "MANUAL_REVIEW_REQUIRED",
      confidence: 35,
      website: url,
      chatbotStatus: "UNKNOWN",
      chatbotReason: "De interface en scripts konden niet betrouwbaar worden opgehaald.",
      objectiveIssues: [],
      reason: "Websitecontrole mislukte of werd geblokkeerd; digitale kwalificatie blijft onbekend.",
      evidence: [{ checkType: "WEBSITE_FETCH", result: "UNKNOWN", confidence: 35, evidenceUrl: url, shortExplanation: "Geen betrouwbare HTTP/HTML-respons ontvangen." }],
    };
  }
}

export function hasRequiredDigitalGap(result: Pick<WebsiteVerificationResult, "status" | "chatbotStatus"> & { evidence?: Evidence[] }) {
  return ["NO_WEBSITE_CONFIRMED", "WEBSITE_OUTDATED", "WEBSITE_BROKEN"].includes(result.status)
    || (result.status === "SOCIAL_ONLY" && Boolean(result.evidence?.length))
    || result.chatbotStatus === "NOT_PRESENT";
}
