import assert from "node:assert/strict";
import test from "node:test";
import { mergeCodexSemanticAnalysis } from "../src/ai/codexCliProposal.js";
import { parseLocalProposal } from "../src/ai/localProposal.js";
import { createLocalRepository } from "../src/data/local/localRepository.js";

const accounts = [{
  id: "account-daily",
  institutionName: "建设银行",
  displayName: "日常账户",
  currency: "CNY",
}];

test("Codex intent selects deterministic extraction without generating money fields", () => {
  const transcript = "今天从建设银行日常账户花了三百六十八元买日用品。";
  const proposal = parseLocalProposal({
    transcript,
    context: "assistant",
    accounts,
    intentHint: "transaction",
    now: new Date("2026-08-09T08:00:00+08:00"),
  });
  const merged = mergeCodexSemanticAnalysis(proposal, {
    providerId: "codex_cli_v1",
    model: "codex-cli-account-default",
    intent: "transaction",
    confidenceBps: 9_900,
    summary: "一笔日用品支出。",
    evidenceQuotes: [transcript],
    warnings: [],
  });

  assert.equal(merged.providerId, "codex_cli_v1");
  assert.equal(merged.draftRequest.amount, "368");
  assert.equal(merged.draftRequest.accountId, "account-daily");
  assert.equal(merged.analysisSummary, "一笔日用品支出。");
  assert.ok(merged.evidence.some((item) => item.field === "ai_intent"));
});

test("Codex evidence must still be an exact quote from the original input", () => {
  const proposal = parseLocalProposal({
    transcript: "今天花了368元买日用品。",
    context: "cashflow",
    accounts,
    intentHint: "transaction",
  });
  assert.throws(
    () => mergeCodexSemanticAnalysis(proposal, {
      providerId: "codex_cli_v1",
      confidenceBps: 9_000,
      summary: "支出",
      evidenceQuotes: ["今天花了369元"],
      warnings: [],
    }),
    /not present/,
  );
});

test("unsupported Codex intent fails closed without a domain draft", () => {
  const proposal = parseLocalProposal({
    transcript: "帮我写一句欢迎语。",
    context: "assistant",
    intentHint: "unsupported",
  });
  assert.equal(proposal.status, "unsupported");
  assert.equal(proposal.draftRequest, null);
});

test("native Codex bridge always carries explicit per-request confirmation", async () => {
  const calls = [];
  const repository = createLocalRepository(async (command, payload) => {
    calls.push({ command, payload });
    return command === "codex_cli_status" ? { ready: true } : { intent: "transaction" };
  });
  await repository.getCodexCliStatus();
  await repository.analyzeFinanceInputWithCodex({
    text: "今天花了368元。",
    moduleContext: "cashflow",
  });
  assert.deepEqual(calls, [
    { command: "codex_cli_status", payload: undefined },
    {
      command: "codex_cli_analyze_finance",
      payload: {
        request: {
          text: "今天花了368元。",
          moduleContext: "cashflow",
          confirmedByUser: true,
        },
      },
    },
  ]);
});
