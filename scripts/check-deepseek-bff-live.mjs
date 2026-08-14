import { createDeepSeekProvider } from "../services/folio-bff/deepseek-provider.js";

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    configured: false,
    reason: "DEEPSEEK_API_KEY is not visible to this server process",
  }, null, 2)}\n`);
  process.exitCode = 2;
} else {
  const provider = createDeepSeekProvider({
    apiKey,
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  });
  const sourceText = "建行新增租金收入8000，今年8月20日需要交保费一万。";
  const proposal = await provider.parseFinancialText({
    proposalId: "proposal-live-doctor",
    sourceId: "fictional-live-doctor",
    sourceKind: "text",
    text: sourceText,
  });
  const evidenceCovered = proposal.items.every((item) => item.evidence.every(
    (evidence) => sourceText.includes(evidence.quote),
  ));
  process.stdout.write(`${JSON.stringify({
    ok: proposal.state === "pending_review" && evidenceCovered,
    configured: true,
    provider: proposal.provider.id,
    model: proposal.provider.model,
    state: proposal.state,
    itemKinds: proposal.items.map((item) => item.kind),
    evidenceCovered,
  }, null, 2)}\n`);
}
