import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptyTransactionForm,
  createTransactionFormFromTransaction,
  formatTransactionAmount,
  presentTransactionError,
  toTransactionCorrectionDraftInput,
  toTransactionDraftInput,
  transactionKindLabel,
  validateTransactionCorrection,
  validateTransactionForm,
} from "../src/data/local/transactionDraft.js";

const accounts = [
  { id: "account-1", currency: "CNY", displayName: "日常账户" },
  { id: "account-2", currency: "CNY", displayName: "储蓄账户" },
  { id: "account-usd", currency: "USD", displayName: "美元账户" },
];

test("manual expense form creates only normalized review fields", () => {
  const form = {
    ...createEmptyTransactionForm(accounts, new Date(2026, 6, 27, 9, 0, 0)),
    amount: "368.50",
    occurredOn: "2026-07-27",
    description: " 日常用品 ",
    category: "购物",
    notes: " 虚构流水 ",
  };
  assert.equal(validateTransactionForm(form, accounts), "");
  assert.deepEqual(toTransactionDraftInput(form, accounts), {
    transactionKind: "expense",
    accountId: "account-1",
    destinationAccountId: null,
    amount: "368.50",
    occurredOn: "2026-07-27",
    description: "日常用品",
    category: "购物",
    notes: "虚构流水",
  });
});

test("transfer form enforces distinct same-currency accounts", () => {
  const form = {
    ...createEmptyTransactionForm(accounts),
    transactionKind: "transfer",
    accountId: "account-1",
    destinationAccountId: "account-2",
    amount: "1000",
    description: "资金调拨",
    category: "账户调拨",
  };
  assert.equal(validateTransactionForm(form, accounts), "");
  assert.match(
    validateTransactionForm({ ...form, destinationAccountId: "account-1" }, accounts),
    /不能相同/,
  );
  assert.match(
    validateTransactionForm({ ...form, destinationAccountId: "account-usd" }, accounts),
    /跨币种/,
  );
});

test("transaction amount rejects zero, negative and imprecise values", () => {
  const form = {
    ...createEmptyTransactionForm(accounts),
    description: "测试",
  };
  for (const amount of ["0", "-1", "1.001", "1e3"]) {
    assert.match(validateTransactionForm({ ...form, amount }, accounts), /金额/);
  }
});

test("transaction presentation preserves kind semantics", () => {
  assert.equal(formatTransactionAmount("income", 860_000, "CNY"), "+¥8,600.00");
  assert.equal(formatTransactionAmount("expense", 36_850, "CNY"), "-¥368.50");
  assert.equal(formatTransactionAmount("transfer", 100_000, "CNY"), "¥1,000.00");
  assert.equal(transactionKindLabel("transfer"), "转账");
  assert.equal(
    presentTransactionError(new Error("Cross-currency transfers require a workflow.")),
    "跨币种转账需要单独核对汇率，当前版本不会自动换算",
  );
  assert.match(
    presentTransactionError(new Error("Holding-linked transactions must be corrected from the holding operation history.")),
    /不能单独冲销/,
  );
});

test("transaction correction requires a reason and revision replacement", () => {
  const original = {
    id: "transaction-1",
    kind: "expense",
    accountId: "account-1",
    amountMinor: 36_850,
    occurredAt: "2026-07-27T00:00:00.000Z",
    description: "虚构日常用品",
    category: "购物",
    notes: "测试",
  };
  const form = createTransactionFormFromTransaction(original, accounts);
  assert.equal(form.amount, "368.50");
  assert.match(validateTransactionCorrection("reverse", "", form, accounts), /原因/);
  assert.equal(validateTransactionCorrection("revise", "金额有误", form, accounts), "");
  assert.deepEqual(toTransactionCorrectionDraftInput({
    transactionId: original.id,
    correctionKind: "revise",
    reason: " 金额有误 ",
    form: { ...form, amount: "360.00" },
    accounts,
  }), {
    transactionId: "transaction-1",
    correctionKind: "revise",
    reason: "金额有误",
    replacement: {
      transactionKind: "expense",
      accountId: "account-1",
      destinationAccountId: null,
      amount: "360.00",
      occurredOn: "2026-07-27",
      description: "虚构日常用品",
      category: "购物",
      notes: "测试",
    },
  });
});
