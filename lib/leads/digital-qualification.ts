
import type { Candidate } from "./eligibility";
import type { WebsiteAnalysisResult } from "@/lib/website/analyze";
import { verifyWebsiteCandidate, type Evidence, type WebsiteVerificationResult } from "./website-verification";

function analysisEvidence(result: WebsiteAnalysisResult): Evidence[] {
  return result.reasons.map((reason) => ({
    checkType: reason.code,
    result: "FOUND",
    confidence: 90,
    evidenceUrl: result.websiteUrl,
    shortExplanation: reason.label,
  }));
}

export function classifyOwnedWebsite(
  source: WebsiteVerificationResult,
  analysis: WebsiteAnalysisResult,
): WebsiteVerificationResult {
  const evidence = [...source.evidence, ...analysisEvidence(analysis)];
  const repeatedHttpFailure = analysis.httpStatus === 404
    || analysis.httpStatus === 410
    || Boolean(analysis.httpStatus && analysis.httpStatus >= 500);
  if (!analysis.isReachable) {
    if (analysis.hasInvalidSsl || repeatedHttpFailure) {
      return {
        status: "WEBSITE_BROKEN",
        confidence: 92,
        website: source.website,
        reason: analysis.hasInvalidSsl
          ? "De eigen website heeft na herhaalde controle een ongeldig TLS-certificaat."
          : `De eigen website bleef na herhaalde controle antwoorden met HTTP ${analysis.httpStatus}.`,
        evidence,
      };
    }
    return {
      status: "UNKNOWN",
      confidence: 35,
      website: source.website,
      reason: "De website was tijdelijk niet betrouwbaar te controleren; één timeout of blokkade geldt niet als bewijs van een kapotte website.",
      evidence,
    };
  }
  if (analysis.classification === "OUTDATED") {
    return {
      status: "WEBSITE_OUTDATED",
      confidence: 92,
      website: source.website,
      reason: `De eigen website heeft aantoonbare verouderingssignalen (${analysis.opportunityScore}/100): ${analysis.reasons.map(({ label }) => label).join("; ")}.`,
      evidence,
    };
  }
  if (analysis.classification === "IMPROVABLE" && analysis.reasons.length >= 2) {
    return {
      status: "IMPROVABLE_WEBSITE",
      confidence: 86,
      website: source.website,
      reason: `De eigen website heeft meerdere concrete verbeterpunten (${analysis.opportunityScore}/100): ${analysis.reasons.map(({ label }) => label).join("; ")}.`,
      evidence,
    };
  }
  return {
    status: "WEBSITE_FOUND",
    confidence: 92,
    website: source.website,
    reason: "De eigen website is bereikbaar en heeft onvoldoende objectief bewijs voor een verouderde, kapotte of duidelijk verbeterbare classificatie.",
    evidence,
  };
}

export async function qualifyWebsiteCandidate(candidate: Candidate): Promise<WebsiteVerificationResult> {
  const source = await verifyWebsiteCandidate(candidate);
  if (source.status !== "WEBSITE_FOUND" || !source.website) return source;
  const { analyzeWebsite } = await import("@/lib/website/analyze");
  const analysis = await analyzeWebsite(source.website);
  return classifyOwnedWebsite(source, analysis);
}
