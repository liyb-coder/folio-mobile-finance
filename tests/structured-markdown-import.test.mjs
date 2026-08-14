import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  isStructuredFolioMarkdown,
  parseStructuredFolioMarkdown,
} from "../src/services/import/structuredMarkdownImport.js";

const root = resolve(import.meta.dirname, "..");
const source = readFileSync(
  resolve(root, "docs/demo/Folio_冷启动全量演示数据.md"),
  "utf8",
);

test("structured Folio Markdown parses every writable domain and quarantine item", () => {
  assert.equal(isStructuredFolioMarkdown(source), true);
  const batch = parseStructuredFolioMarkdown(source);
  assert.equal(batch.status, "reviewable", JSON.stringify(batch.errors));
  assert.deepEqual(batch.counts, {
    accounts: 9,
    holdings: 7,
    transactions: 26,
    reminders: 9,
    planning: 1,
    informational: 5,
    quarantined: 9,
  });
  assert.equal(batch.accounts.find((item) => item.key === "card").request.openingBalance, "-2920.25");
  assert.equal(batch.accounts.find((item) => item.key === "salary").request.openingBalance, "50780.00");
  assert.equal(batch.accounts.find((item) => item.key === "salary").request.balanceDate, "2026-02-28");
  assert.equal(batch.accounts.find((item) => item.key === "mortgage").request.accountType, "liability");
  assert.equal(batch.holdings.find((item) => item.key === "gold").request.productType, "security");
  assert.equal(batch.transactions.filter((item) => item.request.transactionKind === "transfer").length, 2);
  assert.equal(batch.reminders.find((item) => item.request.category === "rent").request.recurrenceRule, "monthly");
  assert.equal(
    batch.planning.request.allocations.reduce((sum, item) => sum + item.targetBps, 0),
    10_000,
  );
});

test("structured import preserves account dependencies and does not double count holdings", () => {
  const batch = parseStructuredFolioMarkdown(source);
  assert.equal(batch.errors.length, 0);
  assert.equal(batch.warnings.filter((item) => item.scope === "reconciliation").length, 3);
  for (const holding of batch.holdings) {
    assert.ok(batch.accounts.some((account) => account.key === holding.accountKey));
  }
  assert.ok(batch.informational.some((item) => item.kind === "legal"));
  assert.ok(batch.quarantined.some((item) => /争议金额/.test(item.text)));
});

test("structured import fails closed for an unknown account and a holding mismatch", () => {
  const broken = source
    .replace("| 2026-07-01 | 收入 | salary |", "| 2026-07-01 | 收入 | missing |")
    .replace("| moneyfund | invest | 虚构现金宝 | 现金管理 | CNY | 86400 | 86400.00 | 86400.00 |",
      "| moneyfund | invest | 虚构现金宝 | 现金管理 | CNY | 86400 | 86400.00 | 86401.00 |");
  const batch = parseStructuredFolioMarkdown(broken);
  assert.equal(batch.status, "invalid");
  assert.ok(batch.errors.some((item) => /不存在的账户/.test(item.message)));
  assert.ok(batch.errors.some((item) => /账户余额与持仓市值不一致/.test(item.message)));
});

test("only explicitly versioned structured documents enter batch mode", () => {
  const ordinaryNote = "# 财务记录\n今天买菜 88 元";
  assert.equal(isStructuredFolioMarkdown(ordinaryNote), false);
  assert.equal(parseStructuredFolioMarkdown(ordinaryNote).status, "invalid");
});

test("personal snapshot batches may omit transactions and planning without inventing data", () => {
  const personal = `---
folio_import_version: 1
dataset_name: 个人资产快照
data_classification: personal
as_of_date: 2026-07-29
---

## 1. 账户
| key | 机构 | 账户名 | 类型 | 币种 | 尾号 | 余额 | 备注 |
|---|---|---|---|---|---|---:|---|
| bank | 某银行 | 资产账户 | 理财账户 | CNY | 1028 | 1000.00 | 个人快照 |

## 2. 账户内持仓
| key | 所属账户 | 产品 | 类型 | 币种 | 数量 | 累计成本 | 市值 |
|---|---|---|---|---|---:|---:|---:|
| cash | bank | 活期 | 现金管理 | CNY | 1000 | 1000.00 | 1000.00 |

## 3. 已确认流水

## 4. 财务事项
`;
  const batch = parseStructuredFolioMarkdown(personal);
  assert.equal(batch.status, "reviewable", JSON.stringify(batch.errors));
  assert.equal(batch.meta.data_classification, "personal");
  assert.equal(batch.counts.transactions, 0);
  assert.equal(batch.counts.planning, 0);
});
