import { parseChineseInteger, parseLocalProposal } from "./localProposal.js";

const MAX_REVIEW_ITEMS = 8;

function normalizeText(value) {
  return typeof value === "string" ? value.trim().slice(0, 40_000) : "";
}

function scaleAmount(value, multiplier = 1) {
  const normalized = String(value ?? "").replaceAll(",", "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [major, fraction = ""] = normalized.split(".");
  const cents = (BigInt(major) * 100n + BigInt(fraction.padEnd(2, "0")))
    * BigInt(multiplier);
  const whole = cents / 100n;
  const remainder = cents % 100n;
  if (whole > 90_000_000_000_000n) return null;
  return remainder === 0n
    ? whole.toString()
    : `${whole}.${remainder.toString().padStart(2, "0")}`;
}

function amountFromMatch(value, unit = "") {
  if (/^[0-9]/.test(value)) {
    return scaleAmount(value, unit === "万" ? 10_000 : unit === "千" ? 1_000 : 1);
  }
  const parsed = parseChineseInteger(value);
  return parsed == null ? null : String(parsed);
}

function extractSpokenAmount(text) {
  const explicitNumeric = /([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(万|千)?\s*(?:元|块|人民币)/.exec(text);
  if (explicitNumeric) return amountFromMatch(explicitNumeric[1], explicitNumeric[2]);
  const explicitChinese = /([零〇一二两三四五六七八九十百千万亿]+)\s*(?:元|块|人民币)/.exec(text);
  if (explicitChinese) return amountFromMatch(explicitChinese[1]);

  const cue = "(?:收入|到账|收到|租金|工资|报销|支出|支付|付款|消费|花了|缴纳|需要交|交|缴|金额(?:是|为)?)";
  const numeric = new RegExp(`${cue}[^0-9零〇一二两三四五六七八九十百千万亿]{0,6}([0-9][0-9,]*(?:\\.[0-9]{1,2})?)\\s*(万|千)?(?!\\s*[年月日])`).exec(text);
  if (numeric) return amountFromMatch(numeric[1], numeric[2]);
  const chinese = new RegExp(`${cue}[^零〇一二两三四五六七八九十百千万亿]{0,6}([零〇一二两三四五六七八九十百千万亿]+)(?![年月日])`).exec(text);
  return chinese ? amountFromMatch(chinese[1]) : null;
}

function splitSpokenChanges(transcript) {
  const normalized = normalizeText(transcript)
    .replace(/[。！？!?；;]+/g, "\n")
    .replace(/，\s*(?=(?:再|另外|同时|然后|补充|还要|还有|顺便))/g, "\n");
  const clauses = normalized
    .split(/\n+/)
    .map((item) => item.replace(/^[，、,\s]+|[，、,\s]+$/g, "").trim())
    .filter(Boolean);
  if (clauses.length <= MAX_REVIEW_ITEMS) return clauses;
  return [
    ...clauses.slice(0, MAX_REVIEW_ITEMS - 1),
    clauses.slice(MAX_REVIEW_ITEMS - 1).join("，"),
  ];
}

function fieldMap(proposal) {
  return new Map((proposal?.fields ?? []).map((item) => [item.key, item]));
}

function formatMajorAmount(value, currency = "CNY") {
  if (value == null || value === "" || value === "待补充" || value === "未设置") {
    return "金额待补充";
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${value} ${currency === "CNY" ? "元" : currency}`;
  const formatted = new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${formatted} ${currency === "CNY" ? "元" : currency}`;
}

function formatMinorAmount(minor, currency = "CNY") {
  const major = Number(minor) / 100;
  const formatted = new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(major);
  return `${formatted} ${currency === "CNY" ? "元" : currency}`;
}

function amountToMinor(value) {
  if (value == null || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) return null;
  const [major, fraction = ""] = String(value).split(".");
  const minor = BigInt(major) * 100n + BigInt(fraction.padEnd(2, "0"));
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

function proposalTitle(proposal) {
  if (proposal.kind === "reminder") return "提醒新增";
  if (proposal.kind === "account") return "账户新增";
  if (proposal.kind === "holding_operation") return "持仓变更";
  if (proposal.kind === "planning") return "规划调整";
  const kind = fieldMap(proposal).get("transactionKind")?.value;
  return kind === "income"
    ? "收入新增"
    : kind === "expense"
      ? "支出新增"
      : kind === "transfer"
        ? "账户转账"
        : "流水新增";
}

function reviewLines(proposal, amount, accountById, runningBalances, baseCurrency) {
  const fields = fieldMap(proposal);
  if (proposal.kind === "transaction") {
    const kind = fields.get("transactionKind")?.value;
    const accountName = fields.get("accountId")?.value ?? "账户待确认";
    const destinationName = fields.get("destinationAccountId")?.value;
    const category = fields.get("category")?.value ?? "分类待确认";
    const occurredOn = fields.get("occurredOn")?.value ?? "日期待确认";
    const dateIssue = fields.get("occurredOn")?.issue;
    const currency = proposal.draftRequest?.currency ?? baseCurrency;
    const summary = [
      destinationName ? `${accountName} → ${destinationName}` : accountName,
      category,
      formatMajorAmount(amount ?? fields.get("amount")?.value, currency),
      dateIssue === "默认今天" ? `${occurredOn}（未说日期，暂按今天）` : occurredOn,
    ].join(" · ");
    const accountId = proposal.draftRequest?.accountId;
    const currentMinor = accountId ? runningBalances.get(accountId) : null;
    const amountMinor = amountToMinor(amount ?? fields.get("amount")?.value);
    if (
      Number.isSafeInteger(currentMinor)
      && Number.isSafeInteger(amountMinor)
      && (kind === "income" || kind === "expense")
    ) {
      const nextMinor = kind === "income" ? currentMinor + amountMinor : currentMinor - amountMinor;
      runningBalances.set(accountId, nextMinor);
      const accountCurrency = accountById.get(accountId)?.currency ?? currency;
      return [
        summary,
        `预计余额：${formatMinorAmount(currentMinor, accountCurrency)} → ${formatMinorAmount(nextMinor, accountCurrency)}`,
      ];
    }
    return [summary];
  }
  if (proposal.kind === "reminder") {
    const title = fields.get("title")?.value ?? "事项待确认";
    const dueOn = fields.get("dueOn")?.value ?? "日期待补充";
    const reminderAmount = fields.get("amount")?.value;
    const advance = fields.get("advanceDays")?.value ?? "提前时间待确认";
    const account = fields.get("linkedAccountId")?.value;
    return [[
      title,
      dueOn,
      formatMajorAmount(amount ?? reminderAmount, baseCurrency),
      `提前 ${String(advance).replace(/^提前\s*/, "")}`,
      account && account !== "不关联" ? `关联 ${account}` : null,
    ].filter(Boolean).join(" · ")];
  }
  const essentials = (proposal.fields ?? [])
    .filter((item) => item.required || ["displayName", "amount", "occurredOn", "dueOn"].includes(item.key))
    .slice(0, 5)
    .map((item) => `${item.label}：${item.value}`);
  return [essentials.length ? essentials.join(" · ") : proposal.transcript];
}

export function organizeVoiceReview({
  transcript,
  context = "overview",
  accounts = [],
  holdings = [],
  planning = null,
  balances = [],
  baseCurrency = "CNY",
  now = new Date(),
} = {}) {
  const clauses = splitSpokenChanges(transcript);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const runningBalances = new Map(
    balances
      .map((item) => [item.accountId ?? item.account_id, item.balanceMinor ?? item.balance_minor])
      .filter(([accountId, amount]) => accountId && Number.isSafeInteger(Number(amount)))
      .map(([accountId, amount]) => [accountId, Number(amount)]),
  );
  const items = clauses.map((sourceText, index) => {
    const amount = extractSpokenAmount(sourceText);
    const parseText = amount ? `${sourceText}；金额 ${amount} 元` : sourceText;
    const proposal = parseLocalProposal({
      transcript: parseText,
      context,
      accounts,
      holdings,
      planning,
      now,
    });
    const lines = reviewLines(proposal, amount, accountById, runningBalances, baseCurrency);
    return {
      index,
      kind: proposal.kind,
      sourceText,
      title: proposalTitle(proposal),
      reviewText: `${index + 1}、${proposalTitle(proposal)}：${lines[0]}${lines[1] ? `\n   ${lines[1]}` : ""}`,
    };
  });
  return {
    sourceText: normalizeText(transcript),
    itemCount: items.length,
    items,
    reviewText: items.map((item) => item.reviewText).join("\n\n"),
  };
}

export function splitVoiceReviewItems(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  const blocks = normalized
    .split(/\n(?=\s*\d+\s*[、.]\s*)/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (blocks.length === 1 && !/^\d+\s*[、.]\s*/.test(blocks[0])) return [blocks[0]];
  return blocks
    .map((item) => item.replace(/^\d+\s*[、.]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, MAX_REVIEW_ITEMS);
}

