import assert from "node:assert/strict";
import test from "node:test";
import {
  parseChineseInteger,
  parseLocalProposal,
  proposalConfidenceBps,
} from "../src/ai/localProposal.js";

const accounts = Object.freeze([
  {
    id: "account-cmb",
    institutionName: "招商银行",
    displayName: "工资账户",
    currency: "CNY",
  },
  {
    id: "account-ccb",
    institutionName: "建设银行",
    displayName: "日常账户",
    currency: "CNY",
  },
  {
    id: "account-invest",
    institutionName: "测试证券",
    displayName: "投资账户",
    currency: "CNY",
  },
]);
const holdings = Object.freeze([
  {
    id: "holding-csi300",
    accountId: "account-invest",
    accountName: "投资账户",
    name: "沪深300基金",
    currency: "CNY",
    unitsMicros: 10_000_000,
    costBasisMinor: 100_000,
    marketValueMinor: 112_000,
    archivedAt: null,
  },
  {
    id: "holding-bond",
    accountId: "account-invest",
    accountName: "投资账户",
    name: "稳健债券基金",
    currency: "CNY",
    unitsMicros: 20_000_000,
    costBasisMinor: 200_000,
    marketValueMinor: 205_000,
    archivedAt: null,
  },
]);
const now = new Date("2026-07-26T08:00:00+08:00");

test("Chinese financial numerals preserve colloquial trailing place values", () => {
  assert.equal(parseChineseInteger("五万"), 50_000);
  assert.equal(parseChineseInteger("八千六"), 8_600);
  assert.equal(parseChineseInteger("一万二千八"), 12_800);
  assert.equal(parseChineseInteger("三百六十八"), 368);
});

test("local rules create a reviewable transaction proposal without touching a ledger", () => {
  const proposal = parseLocalProposal({
    transcript: "今天从建行日常账户花了三百六十八元买日用品。",
    context: "cashflow",
    accounts,
    now,
  });
  assert.equal(proposal.status, "reviewable");
  assert.equal(proposal.kind, "transaction");
  assert.deepEqual(proposal.draftRequest, {
    transactionKind: "expense",
    accountId: "account-ccb",
    destinationAccountId: null,
    amount: "368",
    occurredOn: "2026-07-26",
    description: "今天从建行日常账户花了三百六十八元买日用品。",
    category: "购物",
    notes: "由本地口述提案生成，确认前请核对原文与证据。",
  });
  assert.ok(proposal.evidence.some((item) => item.field === "amount"));
  assert.ok(proposalConfidenceBps(proposal) >= 8_000);
});

test("local rules require both accounts for transfers", () => {
  const complete = parseLocalProposal({
    transcript: "今天从招行工资账户转账五万元到建行日常账户。",
    context: "cashflow",
    accounts,
    now,
  });
  assert.equal(complete.status, "reviewable");
  assert.equal(complete.draftRequest.transactionKind, "transfer");
  assert.equal(complete.draftRequest.accountId, "account-cmb");
  assert.equal(complete.draftRequest.destinationAccountId, "account-ccb");
  assert.equal(complete.draftRequest.amount, "50000");

  const incomplete = parseLocalProposal({
    transcript: "今天从招行转账五万元。",
    context: "cashflow",
    accounts,
    now,
  });
  assert.equal(incomplete.status, "needs_input");
  assert.match(incomplete.unresolved.join(" "), /转入账户/);
  assert.equal(incomplete.draftRequest, null);
});

test("reminder proposal recognizes Chinese dates and never frames itself as rent collection copy", () => {
  const proposal = parseLocalProposal({
    transcript: "八月二日要缴保险一万二千八百元，提前三天提醒我。",
    context: "reminders",
    accounts,
    now,
  });
  assert.equal(proposal.status, "reviewable");
  assert.equal(proposal.kind, "reminder");
  assert.equal(proposal.draftRequest.dueOn, "2026-08-02");
  assert.equal(proposal.draftRequest.amount, "12800");
  assert.equal(proposal.draftRequest.advanceDays, 3);
  assert.equal(proposal.draftRequest.category, "insurance");
  assert.doesNotMatch(JSON.stringify(proposal), /催租|催收|发送/);
});

test("planning voice creates a reviewable profile update without touching balances", () => {
  const planning = parseLocalProposal({
    transcript: "把活期安全垫调整到八万元。",
    context: "planning",
    accounts,
    now,
    planning: {
      name: "长期资产规划",
      cashBufferMinor: 5_000_000,
      allocations: [
        { category: "cash", targetBps: 2000 },
        { category: "stable", targetBps: 3000 },
        { category: "equity", targetBps: 2000 },
        { category: "gold", targetBps: 1000 },
        { category: "insurance", targetBps: 1500 },
        { category: "other", targetBps: 500 },
      ],
    },
  });
  assert.equal(planning.status, "reviewable");
  assert.equal(planning.kind, "planning");
  assert.equal(planning.draftRequest.cashBuffer, "80000");
  assert.equal(
    planning.draftRequest.allocations.reduce((sum, item) => sum + item.targetBps, 0),
    10_000,
  );
});

test("product trades fail closed instead of fabricating writes", () => {
  const trade = parseLocalProposal({
    transcript: "我把基金卖了五万元又买了理财。",
    context: "assets",
    accounts,
    holdings,
    now,
  });
  assert.equal(trade.status, "needs_input");
  assert.match(trade.unresolved.join(" "), /一次只能口述一种产品操作/);
  assert.equal(trade.draftRequest, null);
});

test("asset voice creates a fully evidenced internal purchase review draft", () => {
  const proposal = parseLocalProposal({
    transcript: "今天申购金额500元的沪深300基金，操作后份额12.5份，操作后累计成本1500元，操作后当前市值1520元。",
    context: "assets",
    accounts,
    holdings,
    now,
  });
  assert.equal(proposal.status, "reviewable");
  assert.equal(proposal.kind, "holding_operation");
  assert.deepEqual(proposal.draftRequest, {
    holdingId: "holding-csi300",
    operationKind: "purchase",
    settlementAccountId: null,
    amount: "500",
    occurredOn: "2026-07-26",
    description: "语音申购 · 沪深300基金",
    notes: "由本地口述提案生成；所有数值来自原文证据，确认前请逐项核对。",
    resultingUnits: "12.5",
    resultingCostBasis: "1500",
    resultingMarketValue: "1520",
    valuationDate: "2026-07-26",
  });
  assert.ok(proposal.evidence.some((item) => item.field === "holding"));
  assert.ok(proposal.evidence.some((item) => item.field === "resultingUnits"));
  assert.match(proposal.warnings.join(" "), /不生成资金流水/);
});

test("asset voice creates a dividend draft and defaults to the holding account", () => {
  const proposal = parseLocalProposal({
    transcript: "今天沪深300基金分红128元。",
    context: "assets",
    accounts,
    holdings,
    now,
  });
  assert.equal(proposal.status, "reviewable");
  assert.equal(proposal.draftRequest.operationKind, "dividend");
  assert.equal(proposal.draftRequest.settlementAccountId, "account-invest");
  assert.equal(proposal.draftRequest.resultingUnits, null);
});

test("asset voice requires exact position results and a single holding", () => {
  const incomplete = parseLocalProposal({
    transcript: "今天申购金额500元的沪深300基金。",
    context: "assets",
    accounts,
    holdings,
    now,
  });
  assert.equal(incomplete.status, "needs_input");
  assert.match(incomplete.unresolved.join(" "), /操作后份额/);
  assert.match(incomplete.unresolved.join(" "), /累计成本/);
  assert.match(incomplete.unresolved.join(" "), /当前市值/);
  assert.equal(incomplete.draftRequest, null);

  const ambiguous = parseLocalProposal({
    transcript: "今天沪深300基金和稳健债券基金都分红128元。",
    context: "assets",
    accounts,
    holdings,
    now,
  });
  assert.equal(ambiguous.status, "needs_input");
  assert.match(ambiguous.unresolved.join(" "), /多个持仓/);
});

test("asset voice input creates an account proposal from the product example", () => {
  const proposal = parseLocalProposal({
    transcript: "添加一个招商银行工资账户，期初余额八千六百元。",
    context: "assets",
    now,
  });

  assert.equal(proposal.status, "reviewable");
  assert.equal(proposal.kind, "account");
  assert.equal(proposal.draftRequest.institutionName, "招商银行");
  assert.equal(proposal.draftRequest.displayName, "工资账户");
  assert.equal(proposal.draftRequest.openingBalance, "8600");
});

test("cold-start document can create the first account from the empty overview", () => {
  const proposal = parseLocalProposal({
    transcript: "添加一个招商银行工资账户，期初余额八千六百元。",
    context: "overview",
    accounts: [],
    now,
  });

  assert.equal(proposal.status, "reviewable");
  assert.equal(proposal.kind, "account");
  assert.equal(proposal.draftRequest.displayName, "工资账户");
  assert.equal(proposal.draftRequest.openingBalance, "8600");
});
