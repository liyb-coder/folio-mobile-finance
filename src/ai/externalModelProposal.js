const OPENAI_PROVIDER_ID = "openai_responses_v1";
const OPENAI_PARSER_VERSION = "openai-financial-facts-1";

function exactEvidence(source, quote) {
  const start = source.indexOf(quote);
  if (start < 0) {
    throw new Error("AI 提取的证据不在本次输入中，已停止生成草稿。");
  }
  return {
    field: "ai_fact",
    text: quote,
    range: [start, start + quote.length],
  };
}

export function modelFactIntent(fact) {
  const kind = String(fact?.kind ?? "unknown");
  if (["account", "transaction", "reminder", "planning"].includes(kind)) {
    return kind;
  }
  if (kind === "holding") {
    return /申购|买入|购买|赎回|卖出|分红|派息|手续费|管理费/.test(
      String(fact?.evidenceQuote ?? ""),
    )
      ? "holding_operation"
      : "unsupported";
  }
  if (kind === "insurance") {
    return /提醒|到期|续保|续缴|缴费日/.test(String(fact?.evidenceQuote ?? ""))
      ? "reminder"
      : "unsupported";
  }
  return "unsupported";
}

export function excerptForModelFact(sourceText, evidenceQuote) {
  const source = String(sourceText ?? "");
  const quote = String(evidenceQuote ?? "").trim();
  const quoteStart = source.indexOf(quote);
  if (!quote || quoteStart < 0) {
    throw new Error("AI 提取的证据无法与本次输入核对。");
  }
  const separators = /[\n。！？；;]/;
  let start = quoteStart;
  while (start > 0 && !separators.test(source[start - 1])) start -= 1;
  let end = quoteStart + quote.length;
  while (end < source.length && !separators.test(source[end])) end += 1;
  if (end < source.length) end += 1;
  return source.slice(start, end).trim();
}

export function mergeExternalModelFact(proposal, extraction, fact) {
  if (!proposal || typeof proposal !== "object") {
    throw new TypeError("A deterministic Folio proposal is required.");
  }
  if (extraction?.providerId !== OPENAI_PROVIDER_ID) {
    throw new Error("The extraction did not come from the configured OpenAI provider.");
  }
  const source = String(proposal.transcript ?? "");
  const quote = String(fact?.evidenceQuote ?? "").trim();
  const semanticConfidence = Math.max(
    0,
    Math.min(1, Number(fact?.confidenceBps ?? 0) / 10_000),
  );
  const localConfidence = Number(proposal.confidence ?? 0);
  const missingFields = Array.isArray(fact?.missingFields) ? fact.missingFields : [];
  const providerWarnings = Array.isArray(extraction?.warnings) ? extraction.warnings : [];
  return {
    ...proposal,
    providerId: OPENAI_PROVIDER_ID,
    parserVersion: `${OPENAI_PARSER_VERSION}.${proposal.parserVersion}`,
    model: String(extraction?.model ?? "gpt-5.6-terra"),
    analysisSummary: [extraction?.documentSummary, fact?.title]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .join(" · "),
    confidence: localConfidence > 0
      ? Math.min(localConfidence, semanticConfidence)
      : 0,
    evidence: [
      ...(Array.isArray(proposal.evidence) ? proposal.evidence : []),
      exactEvidence(source, quote),
    ],
    warnings: [
      ...(Array.isArray(proposal.warnings) ? proposal.warnings : []),
      ...providerWarnings.map((warning) => `OpenAI：${warning}`),
      ...missingFields.map((field) => `AI 标记待补充：${field}`),
      ...(fact?.needsReview === false
        ? []
        : ["AI 只负责提取和分类；金额、日期与账户仍由本机规则核对。"]),
    ],
  };
}

