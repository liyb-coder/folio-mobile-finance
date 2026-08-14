import assert from "node:assert/strict";
import test from "node:test";
import { answerLocalLedgerQuestion } from "../src/ai/localLedgerQa.js";

const now = new Date("2026-07-26T08:00:00+08:00");
const snapshot = Object.freeze({
  vault: { baseCurrency: "CNY" },
  accounts: [
    {
      id: "account-1",
      institutionName: "招商银行",
      displayName: "工资账户",
      currency: "CNY",
      balanceMinor: 1_200_000,
      lastEventAt: "2026-07-26T00:00:00.000Z",
    },
    {
      id: "account-2",
      institutionName: "建设银行",
      displayName: "日常账户",
      currency: "CNY",
      balanceMinor: 340_000,
      lastEventAt: "2026-07-25T00:00:00.000Z",
    },
  ],
  balances: [
    {
      accountId: "account-1",
      currency: "CNY",
      balanceMinor: 1_200_000,
      lastEventAt: "2026-07-26T00:00:00.000Z",
    },
    {
      accountId: "account-2",
      currency: "CNY",
      balanceMinor: 340_000,
      lastEventAt: "2026-07-25T00:00:00.000Z",
    },
  ],
  transactions: [
    {
      id: "event-expense",
      kind: "expense",
      accountName: "日常账户",
      amountMinor: 36_800,
      currency: "CNY",
      occurredAt: "2026-07-26T00:00:00.000Z",
      createdAt: "2026-07-26T00:01:00.000Z",
      description: "日用品",
      reversed: false,
    },
    {
      id: "event-reversed",
      kind: "expense",
      accountName: "日常账户",
      amountMinor: 99_900,
      currency: "CNY",
      occurredAt: "2026-07-26T00:00:00.000Z",
      createdAt: "2026-07-26T00:02:00.000Z",
      description: "已冲销",
      reversed: true,
    },
    {
      id: "event-income",
      kind: "income",
      accountName: "工资账户",
      amountMinor: 500_000,
      currency: "CNY",
      occurredAt: "2026-07-01T00:00:00.000Z",
      createdAt: "2026-07-01T00:01:00.000Z",
      description: "工资",
      reversed: false,
    },
  ],
  reminders: [
    {
      id: "reminder-1",
      title: "保险续缴",
      dueOn: "2026-08-02",
      status: "active",
      amountMinor: 1_280_000,
      currency: "CNY",
      updatedAt: "2026-07-26T00:03:00.000Z",
    },
  ],
});

const analyticsSnapshot = Object.freeze({
  ...snapshot,
  transactions: [
    ...snapshot.transactions.map((item) => (
      item.id === "event-expense" ? { ...item, category: "购物" } : item
    )),
    {
      id: "event-dining",
      kind: "expense",
      accountName: "日常账户",
      amountMinor: 120_000,
      currency: "CNY",
      occurredAt: "2026-07-25T00:00:00.000Z",
      createdAt: "2026-07-25T00:01:00.000Z",
      description: "家庭聚餐",
      category: "餐饮",
      reversed: false,
    },
    {
      id: "event-june-expense",
      kind: "expense",
      accountName: "日常账户",
      amountMinor: 60_000,
      currency: "CNY",
      occurredAt: "2026-06-30T00:00:00.000Z",
      createdAt: "2026-06-30T00:01:00.000Z",
      description: "六月购物",
      category: "购物",
      reversed: false,
    },
    {
      id: "event-june-income",
      kind: "income",
      accountName: "工资账户",
      amountMinor: 400_000,
      currency: "CNY",
      occurredAt: "2026-06-01T00:00:00.000Z",
      createdAt: "2026-06-01T00:01:00.000Z",
      description: "六月工资",
      category: "工资",
      reversed: false,
    },
    {
      id: "event-usd-expense",
      kind: "expense",
      accountName: "美元账户",
      amountMinor: 999_999,
      currency: "USD",
      occurredAt: "2026-07-20T00:00:00.000Z",
      createdAt: "2026-07-20T00:01:00.000Z",
      description: "美元支出",
      category: "其他",
      reversed: false,
    },
    {
      id: "event-transfer",
      kind: "transfer",
      accountName: "工资账户",
      amountMinor: 5_000_000,
      currency: "CNY",
      occurredAt: "2026-07-18T00:00:00.000Z",
      createdAt: "2026-07-18T00:01:00.000Z",
      description: "内部调拨",
      category: "账户调拨",
      reversed: false,
    },
  ],
});

test("local ledger QA totals only confirmed base-currency balances with citations", () => {
  const answer = answerLocalLedgerQuestion({
    question: "我现在总余额有多少钱？",
    snapshot,
    now,
  });
  assert.equal(answer.status, "answered");
  assert.equal(answer.providerId, "local_ledger_qa_v2");
  assert.equal(answer.intent, "total_balance");
  assert.match(answer.answer, /¥15,400\.00/);
  assert.equal(answer.citations.length, 2);
  assert.ok(answer.citations.every((item) => item.refType === "account_balance"));
  assert.equal(answer.privacy, "local_only");
});

test("local ledger QA cites a named account instead of guessing a portfolio value", () => {
  const answer = answerLocalLedgerQuestion({
    question: "招行工资账户还有多少钱？",
    snapshot,
    now,
  });
  assert.equal(answer.status, "answered");
  assert.equal(answer.intent, "account_balance");
  assert.match(answer.answer, /¥12,000\.00/);
  assert.equal(answer.citations[0].refId, "account-1");
});

test("local ledger QA excludes reversed events from current-month expense", () => {
  const answer = answerLocalLedgerQuestion({
    question: "本月支出多少？",
    snapshot,
    now,
  });
  assert.equal(answer.status, "answered");
  assert.equal(answer.intent, "expense_total");
  assert.match(answer.answer, /¥368\.00/);
  assert.deepEqual(answer.citations.map((item) => item.refId), ["event-expense"]);
});

test("local ledger QA answers reminders with source IDs and data timestamps", () => {
  const answer = answerLocalLedgerQuestion({
    question: "接下来有什么待处理事项？",
    snapshot,
    now,
  });
  assert.equal(answer.status, "answered");
  assert.equal(answer.intent, "upcoming_reminders");
  assert.equal(answer.citations[0].refId, "reminder-1");
  assert.equal(answer.dataUpdatedAt, "2026-07-26T00:03:00.000Z");
});

test("local ledger QA refuses predictions and unsupported questions without writes", () => {
  const prediction = answerLocalLedgerQuestion({
    question: "推荐我买什么基金，预测收益率",
    snapshot,
    now,
  });
  assert.equal(prediction.status, "unsupported");
  assert.equal(prediction.citations.length, 0);
  assert.match(prediction.answer, /不提供收益预测/);

  const unknown = answerLocalLedgerQuestion({
    question: "帮我解释一下生活",
    snapshot,
    now,
  });
  assert.equal(unknown.status, "unsupported");
  assert.match(unknown.answer, /不会发送到云端/);
});

test("local ledger QA compares current and previous month using exact active base-currency rows", () => {
  const answer = answerLocalLedgerQuestion({
    question: "本月支出比上月多了吗？",
    snapshot: analyticsSnapshot,
    now,
  });
  assert.equal(answer.status, "answered");
  assert.equal(answer.intent, "expense_month_comparison");
  assert.match(answer.answer, /本月支出 ¥1,568\.00/);
  assert.match(answer.answer, /上月支出 ¥600\.00/);
  assert.match(answer.answer, /增加 ¥968\.00（161\.3%）/);
  assert.equal(answer.sourceCount, 3);
  assert.deepEqual(
    new Set(answer.citations.map((item) => item.refId)),
    new Set(["event-expense", "event-dining", "event-june-expense"]),
  );
  assert.ok(answer.citations.every((item) => !["event-reversed", "event-usd-expense", "event-transfer"].includes(item.refId)));
});

test("local ledger QA explains cashflow without treating transfers or other currencies as income", () => {
  const answer = answerLocalLedgerQuestion({
    question: "为什么本月余额变了？",
    snapshot: analyticsSnapshot,
    now,
  });
  assert.equal(answer.intent, "cashflow_explanation");
  assert.match(answer.answer, /收入 ¥5,000\.00/);
  assert.match(answer.answer, /支出 ¥1,568\.00/);
  assert.match(answer.answer, /净现金流为 ¥3,432\.00/);
  assert.equal(answer.sourceCount, 3);
  assert.deepEqual(answer.metrics.map((item) => item.value), [
    "¥5,000.00",
    "¥1,568.00",
    "¥3,432.00",
  ]);
});

test("local ledger QA groups current-month expenses and cites the underlying events", () => {
  const answer = answerLocalLedgerQuestion({
    question: "本月哪类支出最多？",
    snapshot: analyticsSnapshot,
    now,
  });
  assert.equal(answer.intent, "expense_categories");
  assert.match(answer.answer, /“餐饮”/);
  assert.match(answer.answer, /¥1,200\.00/);
  assert.deepEqual(answer.metrics.map((item) => item.label), ["餐饮", "购物"]);
  assert.equal(answer.sourceCount, 2);
});

test("local ledger QA ranks large expenses but explicitly refuses to label them anomalous", () => {
  const answer = answerLocalLedgerQuestion({
    question: "本月有哪些大额支出？",
    snapshot: analyticsSnapshot,
    now,
  });
  assert.equal(answer.intent, "largest_expenses");
  assert.match(answer.answer, /家庭聚餐.*¥1,200\.00/);
  assert.match(answer.answer, /不自动判定交易异常/);
  assert.equal(answer.citations[0].refId, "event-dining");
  assert.equal(answer.sourceCount, 2);
});

test("cross-month analytics handles a zero prior period without invalid percentages", () => {
  const answer = answerLocalLedgerQuestion({
    question: "本月收入和上月相比怎么样？",
    snapshot: {
      ...snapshot,
      transactions: snapshot.transactions.filter((item) => item.id === "event-income"),
    },
    now,
  });
  assert.equal(answer.intent, "income_month_comparison");
  assert.match(answer.answer, /上月为零/);
  assert.doesNotMatch(answer.answer, /Infinity|NaN/);
});

test("aggregate answers disclose partial citation coverage while totaling every source row", () => {
  const transactions = Array.from({ length: 15 }, (_, index) => ({
    id: `coverage-${index}`,
    kind: "expense",
    accountName: "日常账户",
    amountMinor: 10_000,
    currency: "CNY",
    occurredAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    createdAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:01:00.000Z`,
    description: `餐饮 ${index + 1}`,
    category: "餐饮",
    reversed: false,
  }));
  const answer = answerLocalLedgerQuestion({
    question: "本月支出分类",
    snapshot: { vault: { baseCurrency: "CNY" }, transactions },
    now,
  });
  assert.match(answer.answer, /¥1,500\.00/);
  assert.equal(answer.sourceCount, 15);
  assert.equal(answer.citations.length, 12);
});

test("month comparison crosses a calendar year boundary exactly", () => {
  const answer = answerLocalLedgerQuestion({
    question: "本月支出和上月比较",
    snapshot: {
      vault: { baseCurrency: "CNY" },
      transactions: [
        {
          id: "january",
          kind: "expense",
          amountMinor: 20_000,
          currency: "CNY",
          occurredAt: "2027-01-02T00:00:00.000Z",
          reversed: false,
        },
        {
          id: "december",
          kind: "expense",
          amountMinor: 10_000,
          currency: "CNY",
          occurredAt: "2026-12-31T00:00:00.000Z",
          reversed: false,
        },
      ],
    },
    now: new Date("2027-01-15T08:00:00+08:00"),
  });
  assert.match(answer.answer, /本月支出 ¥200\.00/);
  assert.match(answer.answer, /上月支出 ¥100\.00/);
  assert.deepEqual(new Set(answer.citations.map((item) => item.refId)), new Set(["january", "december"]));
});
