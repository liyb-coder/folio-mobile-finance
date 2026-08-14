import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTransactionImportDraft,
  parseCsv,
  parseTsv,
} from "../src/services/import/csvImport.js";

test("CSV parser supports quoted commas and escaped quotes", () => {
  assert.deepEqual(
    parseCsv('日期,备注\n2026-07-24,"家电, 含安装"\n2026-07-25,"他说""已付"""'),
    [
      ["日期", "备注"],
      ["2026-07-24", "家电, 含安装"],
      ["2026-07-25", '他说"已付"'],
    ],
  );
});

test("TSV parser preserves spreadsheet cells copied with tabs", () => {
  assert.deepEqual(
    parseTsv("日期\t金额\t备注\n2026-07-24\t-368.50\t虚构日用品"),
    [
      ["日期", "金额", "备注"],
      ["2026-07-24", "-368.50", "虚构日用品"],
    ],
  );
});

test("CSV import produces reviewable events and row-level errors", async () => {
  const result = await buildTransactionImportDraft({
    csvText: [
      "日期,账户,金额,币种,类型,备注,外部ID",
      "2026-07-24,account-1,12800.00,CNY,income,租金,bank-001",
      "bad-date,account-1,99.00,CNY,expense,错误行,bank-002",
    ].join("\n"),
    columnMap: {
      date: "日期",
      account: "账户",
      amount: "金额",
      currency: "币种",
      type: "类型",
      description: "备注",
      externalId: "外部ID",
    },
    vaultId: "vault-1",
    sourceId: "test.csv",
  });

  assert.equal(result.rowCount, 2);
  assert.equal(result.proposedEvents.length, 1);
  assert.equal(result.proposedEvents[0].event.deltaMinor, "1280000");
  assert.equal(result.proposedEvents[0].id, "bank-001");
  assert.deepEqual(result.errors, [{ row: 3, message: "Invalid transaction date." }]);
  assert.match(result.sourceFingerprint, /^[a-f0-9]{64}$/);
});
