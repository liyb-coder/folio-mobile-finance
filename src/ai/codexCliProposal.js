const CODEX_CLI_PROVIDER_ID = "codex_cli_v1";
const CODEX_CLI_PARSER_VERSION = "codex-cli-semantic-1";

function exactEvidence(source, quote, index) {
  const start = source.indexOf(quote);
  if (start < 0) {
    throw new Error(`Codex evidence ${index + 1} is not present in the source text.`);
  }
  return {
    field: "ai_intent",
    text: quote,
    range: [start, start + quote.length],
  };
}

export function mergeCodexSemanticAnalysis(proposal, analysis) {
  if (!proposal || typeof proposal !== "object") {
    throw new TypeError("A deterministic Folio proposal is required.");
  }
  if (analysis?.providerId !== CODEX_CLI_PROVIDER_ID) {
    throw new Error("The semantic analysis did not come from Codex CLI.");
  }
  const source = String(proposal.transcript ?? "");
  const quotes = Array.isArray(analysis.evidenceQuotes) ? analysis.evidenceQuotes : [];
  const warnings = Array.isArray(analysis.warnings) ? analysis.warnings : [];
  const semanticConfidence = Math.max(
    0,
    Math.min(1, Number(analysis.confidenceBps ?? 0) / 10_000),
  );
  const localConfidence = Number(proposal.confidence ?? 0);
  return {
    ...proposal,
    providerId: CODEX_CLI_PROVIDER_ID,
    parserVersion: `${CODEX_CLI_PARSER_VERSION}.${proposal.parserVersion}`,
    model: String(analysis.model ?? "codex-cli-account-default"),
    analysisSummary: String(analysis.summary ?? "").trim(),
    confidence: localConfidence > 0
      ? Math.min(localConfidence, semanticConfidence)
      : 0,
    evidence: [
      ...(Array.isArray(proposal.evidence) ? proposal.evidence : []),
      ...quotes.map((quote, index) => exactEvidence(source, quote, index)),
    ],
    warnings: [
      ...(Array.isArray(proposal.warnings) ? proposal.warnings : []),
      ...warnings.map((warning) => `Codex：${warning}`),
    ],
  };
}
