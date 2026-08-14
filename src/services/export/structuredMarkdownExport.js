const ACCOUNT_TYPE_LABELS = Object.freeze({
  cash: "活期账户",
  savings: "储蓄账户",
  investment: "投资账户",
  fund: "基金账户",
  insurance: "保险账户",
  property: "房产",
  liability: "负债账户",
  credit_card: "负债账户",
  other: "其他",
});

const HOLDING_TYPE_LABELS = Object.freeze({
  cash_management: "现金管理",
  fixed_income: "固收理财",
  fund: "基金",
  security: "股票/证券",
  insurance: "保险",
  other: "其他",
});

const TRANSACTION_TYPE_LABELS = Object.freeze({
  income: "收入",
  expense: "支出",
  transfer: "转账",
});

const REMINDER_TYPE_LABELS = Object.freeze({
  rent: "租金",
  insurance: "保险",
  maturity: "理财到期",
  repayment: "还款",
  investment: "定投",
  idle_cash: "闲置资金",
  custom: "自定义",
});

const RECURRENCE_LABELS = Object.freeze({
  monthly: "每月",
  yearly: "每年",
});

const ALLOCATION_LABELS = Object.freeze({
  cash: "现金",
  stable: "稳健",
  equity: "权益",
  gold: "黄金",
  insurance: "保险",
  other: "其他",
});

function cell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .trim();
}

function decimalFromMinor(value) {
  const minor = Number(value ?? 0);
  const sign = minor < 0 ? "-" : "";
  const absolute = Math.abs(Math.trunc(minor));
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function decimalFromMicros(value) {
  const micros = Math.max(0, Math.trunc(Number(value ?? 0)));
  const major = Math.floor(micros / 1_000_000);
  const fraction = String(micros % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${major}.${fraction}` : String(major);
}

function dateOnly(value, fallback) {
  const match = /^\d{4}-\d{2}-\d{2}/.exec(String(value ?? ""));
  return match?.[0] ?? fallback;
}

function table(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
}

function currentBalanceByAccount(snapshot) {
  const result = new Map();
  for (const balance of snapshot.balances ?? []) {
    result.set(balance.accountId, Number(balance.balanceMinor ?? balance.balance_minor ?? 0));
  }
  for (const account of snapshot.accounts ?? []) {
    if (!result.has(account.id)) {
      result.set(account.id, Number(account.balanceMinor ?? 0));
    }
  }
  return result;
}

function transactionEffectByAccount(transactions) {
  const effects = new Map();
  const add = (accountId, value) => {
    if (!accountId) return;
    effects.set(accountId, (effects.get(accountId) ?? 0) + value);
  };
  for (const transaction of transactions) {
    if (transaction.reversed) continue;
    const amount = Math.abs(Number(transaction.amountMinor ?? 0));
    const kind = transaction.kind ?? transaction.transactionKind;
    if (kind === "income") add(transaction.accountId, amount);
    if (kind === "expense") add(transaction.accountId, -amount);
    if (kind === "transfer") {
      add(transaction.accountId, -amount);
      add(transaction.destinationAccountId, amount);
    }
  }
  return effects;
}

function latestSnapshotDate(snapshot, fallback) {
  const dates = [
    ...(snapshot.accounts ?? []).flatMap((item) => [item.lastEventAt, item.updatedAt]),
    ...(snapshot.holdings ?? []).flatMap((item) => [item.asOfDate, item.updatedAt]),
    ...(snapshot.transactions ?? []).flatMap((item) => [item.occurredAt, item.createdAt]),
    ...(snapshot.reminders ?? []).flatMap((item) => [item.dueOn, item.updatedAt]),
  ].map((value) => dateOnly(value, "")).filter(Boolean).sort();
  return dates.at(-1) ?? fallback;
}

export function serializeStructuredFolioMarkdown(snapshot, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const today = now.toISOString().slice(0, 10);
  const asOfDate = options.asOfDate ?? latestSnapshotDate(snapshot, today);
  const accounts = (snapshot.accounts ?? []).filter((item) => !item.archivedAt);
  const accountKeys = new Map(accounts.map((item, index) => [item.id, `account_${index + 1}`]));
  const holdings = (snapshot.holdings ?? []).filter(
    (item) => !item.archivedAt && accountKeys.has(item.accountId),
  );
  const transactions = (snapshot.transactions ?? []).filter(
    (item) => !item.reversed && accountKeys.has(item.accountId),
  );
  const reminders = (snapshot.reminders ?? []).filter((item) => item.status !== "archived");
  const balances = currentBalanceByAccount(snapshot);
  const effects = transactionEffectByAccount(transactions);
  const openingDates = transactions
    .map((item) => dateOnly(item.occurredAt, ""))
    .filter(Boolean)
    .sort();
  const openingBalanceDate = openingDates[0] ?? asOfDate;

  const accountRows = accounts.map((account) => {
    const currentMinor = balances.get(account.id) ?? 0;
    const openingMinor = currentMinor - (effects.get(account.id) ?? 0);
    return [
      accountKeys.get(account.id),
      account.institutionName || "未填写机构",
      account.displayName || "未命名账户",
      ACCOUNT_TYPE_LABELS[account.accountType] ?? "其他",
      account.currency || snapshot.vault?.baseCurrency || "CNY",
      account.maskedIdentifier || "",
      decimalFromMinor(openingMinor),
      account.notes || "",
    ];
  });

  const holdingRows = holdings.map((holding, index) => [
    `holding_${index + 1}`,
    accountKeys.get(holding.accountId),
    holding.name || "未命名持仓",
    HOLDING_TYPE_LABELS[holding.productType] ?? "其他",
    holding.currency || "CNY",
    decimalFromMicros(holding.unitsMicros),
    decimalFromMinor(holding.costBasisMinor),
    decimalFromMinor(holding.marketValueMinor),
  ]);

  const transactionRows = transactions.map((transaction) => [
    dateOnly(transaction.occurredAt, asOfDate),
    TRANSACTION_TYPE_LABELS[transaction.kind ?? transaction.transactionKind] ?? "支出",
    accountKeys.get(transaction.accountId),
    accountKeys.get(transaction.destinationAccountId) ?? "",
    decimalFromMinor(Math.abs(Number(transaction.amountMinor ?? 0))),
    transaction.category || "",
    transaction.description || "未填写说明",
    "Folio Markdown 导出",
  ]);

  const reminderRows = reminders.map((reminder) => [
    REMINDER_TYPE_LABELS[reminder.category] ?? "自定义",
    reminder.title || "未命名事项",
    accountKeys.get(reminder.linkedAccountId) ?? "",
    reminder.amountMinor == null ? "" : decimalFromMinor(Math.abs(Number(reminder.amountMinor))),
    dateOnly(reminder.dueOn, asOfDate),
    Number(reminder.advanceDays ?? 0),
    RECURRENCE_LABELS[reminder.recurrenceRule] ?? "不重复",
    reminder.notes || "",
  ]);

  const planning = snapshot.planning;
  const planningSection = planning
    ? [
        "## 5. 长期规划",
        "",
        `- 规划名称：${cell(planning.name || "长期规划")}`,
        `- 现金安全垫：${decimalFromMinor(planning.cashBufferMinor)} ${cell(planning.baseCurrency || snapshot.vault?.baseCurrency || "CNY")}`,
        `- 目标配置：${(planning.allocations ?? []).map((item) => `${ALLOCATION_LABELS[item.category] ?? "其他"} ${Math.round(Number(item.targetBps ?? 0) / 100)}%`).join("，")}`,
        "- 约束：模拟与真实数据分离；不得自动调仓。",
      ].join("\n")
    : "";

  return [
    "---",
    "folio_import_version: 1",
    `dataset_id: folio-export-${today.replaceAll("-", "")}`,
    "dataset_name: Folio Markdown 数据",
    "data_classification: personal",
    `base_currency: ${cell(snapshot.vault?.baseCurrency || "CNY")}`,
    `as_of_date: ${asOfDate}`,
    `opening_balance_date: ${openingBalanceDate}`,
    "---",
    "",
    "# Folio Markdown 数据",
    "",
    "> 此文档由 Folio 导出。再次导入时，所有内容仍需先核对并明确确认。",
    "",
    "## 1. 账户",
    "",
    table(["key", "机构", "账户名", "类型", "币种", "尾号", "期初余额", "备注"], accountRows),
    "",
    "## 2. 账户内持仓",
    "",
    table(["key", "所属账户", "产品", "类型", "币种", "数量", "累计成本", "市值"], holdingRows),
    "",
    "## 3. 已确认流水",
    "",
    table(["日期", "类型", "账户", "去向账户", "金额", "分类", "说明", "来源"], transactionRows),
    "",
    "## 4. 财务事项",
    "",
    table(["类型", "标题", "关联账户", "金额", "日期", "提前", "重复", "备注"], reminderRows),
    planningSection,
    "",
  ].filter((part, index, list) => part !== "" || list[index - 1] !== "").join("\n");
}

export function downloadStructuredFolioMarkdown(content, fileName = "Folio-data.md") {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  return { status: "exported", fileName, byteCount: blob.size };
}
