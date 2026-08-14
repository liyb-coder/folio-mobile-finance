import assert from "node:assert/strict";
import test from "node:test";
import { organizeVoiceReview, splitVoiceReviewItems } from "../src/ai/voiceReview.js";
import { parseLocalProposal } from "../src/ai/localProposal.js";

const accounts = [{
  id: "ccb",
  institutionName: "建设银行",
  displayName: "建行日常账户",
  accountType: "savings",
  currency: "CNY",
}];

test("voice review separates a mixed utterance into concise financial changes", () => {
  const review = organizeVoiceReview({
    transcript: "建行新增租金收入8000，补充一个交保费的提醒，今年8月20日需要交一万。",
    context: "overview",
    accounts,
    balances: [{ accountId: "ccb", balanceMinor: 120_000_00, currency: "CNY" }],
    baseCurrency: "CNY",
    now: new Date("2026-08-09T12:00:00+08:00"),
  });

  assert.equal(review.itemCount, 2);
  assert.match(review.reviewText, /1、收入新增：建行日常账户 · 租金 · 8,000 元/);
  assert.match(review.reviewText, /2026-08-09（未说日期，暂按今天）/);
  assert.match(review.reviewText, /预计余额：120,000 元 → 128,000 元/);
  assert.match(review.reviewText, /2、提醒新增：缴纳保费 · 2026-08-20 · 10,000 元 · 提前 3 天/);
  const items = splitVoiceReviewItems(review.reviewText);
  assert.equal(items.length, 2);
  const proposals = items.map((transcript) => parseLocalProposal({
    transcript,
    context: "overview",
    accounts,
    now: new Date("2026-08-09T12:00:00+08:00"),
  }));
  assert.deepEqual(proposals.map((proposal) => proposal.kind), ["transaction", "reminder"]);
  assert.deepEqual(proposals.map((proposal) => proposal.status), ["reviewable", "reviewable"]);
});

test("plain voice text remains a single review item", () => {
  assert.deepEqual(splitVoiceReviewItems("今天从建行花了 368 元买日用品"), [
    "今天从建行花了 368 元买日用品",
  ]);
});
