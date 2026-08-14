import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const documentPath = resolve(root, "docs/demo/Folio_冷启动全量演示数据.md");
const source = readFileSync(documentPath, "utf8");

function tableRows(section, nextSection) {
  const start = source.indexOf(section);
  const end = nextSection ? source.indexOf(nextSection, start) : source.length;
  return source
    .slice(start, end)
    .split("\n")
    .filter((line) => line.startsWith("|") && !line.includes("---"))
    .slice(1)
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
}

test("cold-start demo document is explicit, fictional, and fully extractable", () => {
  assert.match(source, /folio_import_version: 1/);
  assert.match(source, /fictional_data: true/);
  assert.match(source, /全部为虚构数据/);
  assert.ok([...source].length <= 40_000, "document must fit the local structured-import limit");
  assert.doesNotMatch(source, /@qq\.com|邮箱密码|授权码[:：]\s*\S+/);
});

test("cold-start demo covers every MVP data domain", () => {
  for (const heading of [
    "## 1. 账户",
    "## 2. 账户内持仓",
    "## 3. 已确认流水",
    "## 4. 财务事项",
    "## 5. 长期规划",
    "## 6. QQ 邮箱信用卡通知测试规则",
    "## 7. 应隔离而非自动写入的测试项",
  ]) {
    assert.match(source, new RegExp(heading.replace(".", "\\.")));
  }

  const accounts = tableRows("## 1. 账户", "## 2. 账户内持仓");
  assert.deepEqual(
    new Set(accounts.map((row) => row[4])),
    new Set(["CNY", "USD"]),
  );
  assert.ok(accounts.some((row) => row[3] === "负债账户"));
  assert.ok(accounts.some((row) => row[3] === "房产"));

  const transactions = tableRows("## 3. 已确认流水", "## 4. 财务事项");
  assert.ok(transactions.some((row) => row[1] === "收入"));
  assert.ok(transactions.some((row) => row[1] === "支出"));
  assert.ok(transactions.some((row) => row[1] === "转账"));
  assert.ok(transactions.some((row) => row[7] === "QQ 邮箱"));

  const reminders = tableRows("## 4. 财务事项", "## 5. 长期规划");
  assert.deepEqual(
    new Set(reminders.map((row) => row[0])),
    new Set(["租金", "保险", "理财到期", "还款", "定投", "闲置资金", "自定义"]),
  );
});

test("holding values reconcile to the investment account without double counting", () => {
  const accounts = tableRows("## 1. 账户", "## 2. 账户内持仓");
  const holdings = tableRows("## 2. 账户内持仓", "## 3. 已确认流水");
  const transactions = tableRows("## 3. 已确认流水", "## 4. 财务事项");
  const investmentOpeningBalance = Number(
    accounts.find((row) => row[0] === "invest")[6],
  );
  const investmentTransactionEffect = transactions
    .filter((row) => row[2] === "invest")
    .reduce((sum, row) => sum + (row[1] === "收入" ? 1 : -1) * Number(row[4]), 0);
  const investmentHoldingValue = holdings
    .filter((row) => row[1] === "invest")
    .reduce((sum, row) => sum + Number(row[7]), 0);

  assert.equal(investmentHoldingValue, investmentOpeningBalance + investmentTransactionEffect);
  assert.match(source, /持仓只用于账户内部拆分/);
});

test("planning totals one hundred percent and email cases fail closed", () => {
  const percentages = [...source.matchAll(/(?:现金|稳健|权益|黄金|保险|其他) (\d+)%/g)]
    .map((match) => Number(match[1]));
  assert.equal(percentages.reduce((sum, value) => sum + value, 0), 100);
  assert.match(source, /只生成待核对流水/);
  assert.match(source, /重复.*不得生成第二笔流水/);
  assert.match(source, /跨币种且无汇率.*必须拒绝/);
});

test("demo history spans six months so overview trend is visibly non-flat", () => {
  const transactions = tableRows("## 3. 已确认流水", "## 4. 财务事项");
  const months = new Set(transactions.map((row) => row[0].slice(0, 7)));
  assert.deepEqual(
    months,
    new Set(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]),
  );
  const netByMonth = new Map();
  for (const row of transactions) {
    if (row[1] === "转账") continue;
    const month = row[0].slice(0, 7);
    const signed = row[1] === "收入" ? Number(row[4]) : -Number(row[4]);
    netByMonth.set(month, (netByMonth.get(month) ?? 0) + signed);
  }
  assert.ok(new Set(netByMonth.values()).size >= 4, "trend coverage should not collapse to a flat line");
});
