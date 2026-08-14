import assert from "node:assert/strict";
import test from "node:test";
import { serializeStructuredFolioMarkdown } from "../src/services/export/structuredMarkdownExport.js";
import { parseStructuredFolioMarkdown } from "../src/services/import/structuredMarkdownImport.js";

test("structured Markdown export can be reviewed by the cold-start importer", () => {
  const source = serializeStructuredFolioMarkdown({
    vault: { baseCurrency: "CNY" },
    accounts: [{
      id: "account-current",
      institutionName: "示例银行",
      displayName: "日常账户",
      accountType: "cash",
      currency: "CNY",
      maskedIdentifier: "1028",
      notes: "只在本机",
    }],
    balances: [{ accountId: "account-current", currency: "CNY", balanceMinor: 120_000 }],
    holdings: [],
    transactions: [{
      id: "transaction-income",
      kind: "income",
      accountId: "account-current",
      amountMinor: 20_000,
      currency: "CNY",
      occurredAt: "2026-07-30T08:00:00.000Z",
      description: "测试收入",
      category: "工资",
      reversed: false,
    }],
    reminders: [],
    planning: null,
  }, { now: new Date("2026-07-31T00:00:00.000Z") });

  assert.match(source, /data_classification: personal/);
  assert.match(source, /\| account_1 \| 示例银行 \| 日常账户/);
  assert.match(source, /\| 2026-07-30 \| 收入 \| account_1/);

  const parsed = parseStructuredFolioMarkdown(source);
  assert.equal(parsed.status, "reviewable");
  assert.equal(parsed.accounts.length, 1);
  assert.equal(parsed.accounts[0].request.openingBalance, "1000.00");
  assert.equal(parsed.transactions.length, 1);
  assert.equal(parsed.transactions[0].request.amount, "200.00");
});

test("structured Markdown export does not replay transferred balances", () => {
  const source = serializeStructuredFolioMarkdown({
    vault: { baseCurrency: "CNY" },
    accounts: [
      { id: "source", institutionName: "示例银行", displayName: "账户 A", accountType: "cash", currency: "CNY" },
      { id: "target", institutionName: "示例银行", displayName: "账户 B", accountType: "cash", currency: "CNY" },
    ],
    balances: [
      { accountId: "source", balanceMinor: 90_000, currency: "CNY" },
      { accountId: "target", balanceMinor: 60_000, currency: "CNY" },
    ],
    holdings: [],
    transactions: [{
      id: "transfer",
      kind: "transfer",
      accountId: "source",
      destinationAccountId: "target",
      amountMinor: 10_000,
      currency: "CNY",
      occurredAt: "2026-07-30T08:00:00.000Z",
      description: "内部调拨",
      reversed: false,
    }],
    reminders: [],
    planning: null,
  }, { now: new Date("2026-07-31T00:00:00.000Z") });

  const parsed = parseStructuredFolioMarkdown(source);
  assert.equal(parsed.status, "reviewable");
  assert.deepEqual(parsed.accounts.map((item) => item.request.openingBalance), ["1000.00", "500.00"]);
});
