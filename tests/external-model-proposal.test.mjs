import assert from "node:assert/strict";
import test from "node:test";
import {
  excerptForModelFact,
  mergeExternalModelFact,
  modelFactIntent,
} from "../src/ai/externalModelProposal.js";

test("model fact intent keeps unsupported records out of the ledger", () => {
  assert.equal(modelFactIntent({ kind: "transaction" }), "transaction");
  assert.equal(modelFactIntent({ kind: "legal" }), "unsupported");
  assert.equal(modelFactIntent({ kind: "holding", evidenceQuote: "基金余额十万元" }), "unsupported");
  assert.equal(
    modelFactIntent({ kind: "holding", evidenceQuote: "买入沪深300基金1000元" }),
    "holding_operation",
  );
});

test("model facts use the containing source sentence for deterministic parsing", () => {
  const source = "建行新增租金收入8000元。8月20日提醒交保费一万元。";
  assert.equal(
    excerptForModelFact(source, "8月20日提醒交保费一万元"),
    "8月20日提醒交保费一万元。",
  );
});

test("external model metadata never replaces deterministic draft fields", () => {
  const proposal = {
    transcript: "建行新增租金收入8000元。",
    parserVersion: "local-1",
    confidence: 0.9,
    fields: [{ key: "amount", value: "8000" }],
    evidence: [],
    warnings: [],
    draftRequest: { amount: "8000" },
  };
  const merged = mergeExternalModelFact(proposal, {
    providerId: "openai_responses_v1",
    model: "gpt-5.6-terra",
    documentSummary: "一笔租金收入",
    warnings: [],
  }, {
    title: "租金收入",
    evidenceQuote: "建行新增租金收入8000元",
    confidenceBps: 8500,
    needsReview: true,
    missingFields: [],
  });
  assert.equal(merged.providerId, "openai_responses_v1");
  assert.equal(merged.confidence, 0.85);
  assert.deepEqual(merged.draftRequest, { amount: "8000" });
  assert.equal(merged.evidence.at(-1).text, "建行新增租金收入8000元");
});
