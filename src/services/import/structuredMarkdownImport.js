const MAX_DOCUMENT_CHARS = 40_000;
const MONEY_PATTERN = /^-?\d+(?:\.\d{1,2})?$/;
const POSITIVE_MONEY_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const UNITS_PATTERN = /^\d+(?:\.\d{1,6})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const ACCOUNT_TYPES = Object.freeze({
  活期账户: "cash",
  储蓄账户: "savings",
  投资账户: "investment",
  理财账户: "investment",
  基金账户: "fund",
  保险账户: "insurance",
  房产: "property",
  负债账户: "liability",
  其他: "other",
});

const HOLDING_TYPES = Object.freeze({
  现金管理: "cash_management",
  固收理财: "fixed_income",
  基金: "fund",
  "股票/证券": "security",
  保险: "insurance",
  其他: "other",
});

const TRANSACTION_TYPES = Object.freeze({
  收入: "income",
  支出: "expense",
  转账: "transfer",
});

const REMINDER_TYPES = Object.freeze({
  租金: "rent",
  保险: "insurance",
  理财到期: "maturity",
  还款: "repayment",
  定投: "investment",
  闲置资金: "idle_cash",
  自定义: "custom",
});

const RECURRENCES = Object.freeze({
  不重复: null,
  每月: "monthly",
  每年: "yearly",
});

const ALLOCATION_TYPES = Object.freeze({
  现金: "cash",
  稳健: "stable",
  权益: "equity",
  黄金: "gold",
  保险: "insurance",
  其他: "other",
});

function normalizeSource(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").replaceAll("\r\n", "\n").trim();
}

function lineNumberAt(source, index) {
  return source.slice(0, Math.max(0, index)).split("\n").length;
}

function evidence(source, line, section) {
  const start = source.indexOf(line);
  return {
    section,
    line: lineNumberAt(source, start),
    quote: line,
    range: [Math.max(0, start), Math.max(0, start) + line.length],
  };
}

function parseFrontmatter(source) {
  if (!source.startsWith("---\n")) return {};
  const end = source.indexOf("\n---", 4);
  if (end < 0) return {};
  return Object.fromEntries(
    source
      .slice(4, end)
      .split("\n")
      .map((line) => {
        const separator = line.indexOf(":");
        return separator < 0
          ? null
          : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      })
      .filter(Boolean),
  );
}

function sectionSlice(source, heading, nextHeading) {
  const start = source.indexOf(heading);
  if (start < 0) return "";
  const end = nextHeading ? source.indexOf(nextHeading, start + heading.length) : source.length;
  return source.slice(start, end < 0 ? source.length : end);
}

function parseTable(source, heading, nextHeading) {
  const section = sectionSlice(source, heading, nextHeading);
  const lines = section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"));
  if (lines.length < 2) return { headers: [], rows: [] };
  const split = (line) => line.split("|").slice(1, -1).map((cell) => cell.trim());
  const headers = split(lines[0]);
  const dataLines = lines.slice(1).filter((line) => !/^\|(?:\s*:?-+:?\s*\|)+$/.test(line));
  return {
    headers,
    rows: dataLines.map((line) => ({
      line,
      values: split(line),
      evidence: evidence(source, line, heading),
    })),
  };
}

function validDate(value) {
  if (!DATE_PATTERN.test(value ?? "")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function safeKey(value) {
  return /^[a-z][a-z0-9_-]{0,39}$/.test(value ?? "");
}

function pushError(errors, scope, row, message) {
  errors.push({
    scope,
    key: row?.values?.[0] ?? null,
    line: row?.evidence?.line ?? null,
    message,
  });
}

function parseAccounts(source, asOfDate, errors) {
  const { rows } = parseTable(source, "## 1. 账户", "## 2. 账户内持仓");
  const keys = new Set();
  return rows.flatMap((row) => {
    const [key, institutionName, displayName, typeLabel, currency, maskedIdentifier, balance, notes] = row.values;
    if (!safeKey(key) || keys.has(key)) {
      pushError(errors, "account", row, "账户 key 无效或重复");
      return [];
    }
    if (!institutionName || !displayName || !ACCOUNT_TYPES[typeLabel]) {
      pushError(errors, "account", row, "账户机构、名称或类型无效");
      return [];
    }
    if (!/^[A-Z]{3}$/.test(currency) || !MONEY_PATTERN.test(balance)) {
      pushError(errors, "account", row, "账户币种或余额格式无效");
      return [];
    }
    if (maskedIdentifier && !/^[A-Za-z0-9-]{1,8}$/.test(maskedIdentifier)) {
      pushError(errors, "account", row, "账户尾号格式无效");
      return [];
    }
    keys.add(key);
    return [{
      key,
      request: {
        institutionName,
        displayName,
        accountType: ACCOUNT_TYPES[typeLabel],
        currency,
        maskedIdentifier: maskedIdentifier || null,
        openingBalance: balance,
        balanceDate: asOfDate,
        notes: notes || null,
      },
      evidence: row.evidence,
    }];
  });
}

function parseHoldings(source, accountMap, asOfDate, errors) {
  const { rows } = parseTable(source, "## 2. 账户内持仓", "## 3. 已确认流水");
  const keys = new Set();
  return rows.flatMap((row) => {
    const [key, accountKey, name, typeLabel, currency, units, costBasis, marketValue] = row.values;
    if (!safeKey(key) || keys.has(key)) {
      pushError(errors, "holding", row, "持仓 key 无效或重复");
      return [];
    }
    if (!accountMap.has(accountKey)) {
      pushError(errors, "holding", row, "持仓引用了不存在的账户");
      return [];
    }
    if (!name || !HOLDING_TYPES[typeLabel]) {
      pushError(errors, "holding", row, "持仓名称或类型无效");
      return [];
    }
    if (!/^[A-Z]{3}$/.test(currency) || !UNITS_PATTERN.test(units)
      || !POSITIVE_MONEY_PATTERN.test(costBasis) || !POSITIVE_MONEY_PATTERN.test(marketValue)) {
      pushError(errors, "holding", row, "持仓币种、数量、成本或市值格式无效");
      return [];
    }
    if (accountMap.get(accountKey).request.currency !== currency) {
      pushError(errors, "holding", row, "持仓币种与所属账户不一致");
      return [];
    }
    keys.add(key);
    return [{
      key,
      accountKey,
      request: {
        name,
        productType: HOLDING_TYPES[typeLabel],
        currency,
        maskedIdentifier: null,
        units,
        costBasis,
        marketValue,
        asOfDate,
        notes: `结构化冷启动导入 · ${key}`,
      },
      evidence: row.evidence,
    }];
  });
}

function parseTransactions(source, accountMap, errors) {
  const { rows } = parseTable(source, "## 3. 已确认流水", "## 4. 财务事项");
  return rows.flatMap((row, index) => {
    const [occurredOn, typeLabel, accountKey, destinationAccountKey, amount, category, description, sourceLabel] = row.values;
    const transactionKind = TRANSACTION_TYPES[typeLabel];
    if (!validDate(occurredOn) || !transactionKind) {
      pushError(errors, "transaction", row, "流水日期或类型无效");
      return [];
    }
    if (!accountMap.has(accountKey)) {
      pushError(errors, "transaction", row, "流水引用了不存在的账户");
      return [];
    }
    if (!POSITIVE_MONEY_PATTERN.test(amount) || Number(amount) <= 0 || !description) {
      pushError(errors, "transaction", row, "流水金额或说明无效");
      return [];
    }
    if (transactionKind === "transfer") {
      if (!accountMap.has(destinationAccountKey) || destinationAccountKey === accountKey) {
        pushError(errors, "transaction", row, "转账去向账户无效");
        return [];
      }
      if (accountMap.get(destinationAccountKey).request.currency !== accountMap.get(accountKey).request.currency) {
        pushError(errors, "transaction", row, "跨币种转账必须隔离核对");
        return [];
      }
    }
    return [{
      key: `transaction-${index + 1}`,
      accountKey,
      destinationAccountKey: transactionKind === "transfer" ? destinationAccountKey : null,
      request: {
        transactionKind,
        amount,
        occurredOn,
        description,
        category: category || null,
        notes: sourceLabel ? `来源：${sourceLabel}` : null,
      },
      evidence: row.evidence,
    }];
  });
}

function parseReminders(source, accountMap, errors) {
  const { rows } = parseTable(source, "## 4. 财务事项", "## 5. 长期规划");
  return rows.flatMap((row, index) => {
    const [typeLabel, title, accountKey, amount, dueOn, advanceDays, recurrenceLabel, notes] = row.values;
    if (!REMINDER_TYPES[typeLabel] || !title || !validDate(dueOn)) {
      pushError(errors, "reminder", row, "事项类型、标题或日期无效");
      return [];
    }
    if (accountKey && !accountMap.has(accountKey)) {
      pushError(errors, "reminder", row, "事项引用了不存在的账户");
      return [];
    }
    if (amount && (!POSITIVE_MONEY_PATTERN.test(amount) || Number(amount) <= 0)) {
      pushError(errors, "reminder", row, "事项金额格式无效");
      return [];
    }
    if (!/^\d+$/.test(advanceDays) || Number(advanceDays) > 3650
      || !Object.hasOwn(RECURRENCES, recurrenceLabel)) {
      pushError(errors, "reminder", row, "提前天数或重复规则无效");
      return [];
    }
    return [{
      key: `reminder-${index + 1}`,
      accountKey: accountKey || null,
      request: {
        title,
        category: REMINDER_TYPES[typeLabel],
        amount: amount || null,
        dueOn,
        advanceDays: Number(advanceDays),
        recurrenceRule: RECURRENCES[recurrenceLabel],
        notes: notes || null,
      },
      evidence: row.evidence,
    }];
  });
}

function parsePlanning(source, errors) {
  if (!source.includes("## 5. 长期规划")) return null;
  const section = sectionSlice(source, "## 5. 长期规划", "## 5.1 保险保单详情");
  const name = /规划名称[:：]([^\n]+)/.exec(section)?.[1]?.trim();
  const buffer = /现金安全垫[:：](\d+(?:\.\d{1,2})?)\s+([A-Z]{3})/.exec(section);
  const allocationLine = /目标配置[:：]([^\n]+)/.exec(section)?.[1] ?? "";
  const allocations = [...allocationLine.matchAll(/(现金|稳健|权益|黄金|保险|其他)\s+(\d+)%/g)]
    .map((match) => ({
      category: ALLOCATION_TYPES[match[1]],
      targetBps: Number(match[2]) * 100,
    }));
  if (!name || !buffer || allocations.length !== 6
    || allocations.reduce((sum, item) => sum + item.targetBps, 0) !== 10_000) {
    errors.push({ scope: "planning", key: "planning", line: null, message: "长期规划字段不完整或配置不等于 100%" });
    return null;
  }
  return {
    key: "planning",
    request: {
      name,
      cashBuffer: buffer[1],
      allocations,
      notes: "由结构化冷启动文档导入；模拟配置与真实账本严格分离。",
    },
    evidence: {
      section: "## 5. 长期规划",
      line: lineNumberAt(source, source.indexOf("## 5. 长期规划")),
      quote: section.trim(),
      range: [
        source.indexOf("## 5. 长期规划"),
        source.indexOf("## 5. 长期规划") + section.length,
      ],
    },
  };
}

function informationalRecords(source) {
  const sections = [
    ["insurance", "## 5.1 保险保单详情", "## 5.2 出租物业与租金"],
    ["rent", "## 5.2 出租物业与租金", "## 5.3 法律与诉讼事项"],
    ["legal", "## 5.3 法律与诉讼事项", "## 5.4 产品操作候选"],
    ["operations", "## 5.4 产品操作候选", "## 5.5 市场观察"],
    ["market", "## 5.5 市场观察", "## 6. QQ 邮箱信用卡通知测试规则"],
  ];
  return sections.flatMap(([kind, heading, nextHeading]) => {
    const content = sectionSlice(source, heading, nextHeading).trim();
    if (!content) return [];
    return [{
      kind,
      title: heading.replace(/^#+\s*\d+(?:\.\d+)?\s*/, ""),
      content,
      evidence: {
        section: heading,
        line: lineNumberAt(source, source.indexOf(heading)),
        quote: heading,
      },
      action: "informational_only",
    }];
  });
}

function quarantineRecords(source) {
  const section = sectionSlice(
    source,
    "## 7. 应隔离而非自动写入的测试项",
    "## 预期导入顺序",
  );
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line, index) => ({
      key: `quarantine-${index + 1}`,
      text: line.slice(2).trim(),
      reason: "文档明确标记为隔离测试项",
      evidence: evidence(source, line, "## 7. 应隔离而非自动写入的测试项"),
    }));
}

function reconciliation(accounts, holdings, transactions, errors, warnings) {
  const holdingTotals = new Map();
  const transactionEffects = new Map();
  for (const transaction of transactions) {
    const amountMinor = Math.round(Number(transaction.request.amount) * 100);
    const signed = transaction.request.transactionKind === "income" ? amountMinor : -amountMinor;
    transactionEffects.set(
      transaction.accountKey,
      (transactionEffects.get(transaction.accountKey) ?? 0) + signed,
    );
    if (transaction.request.transactionKind === "transfer" && transaction.destinationAccountKey) {
      transactionEffects.set(
        transaction.destinationAccountKey,
        (transactionEffects.get(transaction.destinationAccountKey) ?? 0) + amountMinor,
      );
    }
  }
  for (const holding of holdings) {
    const current = holdingTotals.get(holding.accountKey) ?? 0;
    holdingTotals.set(holding.accountKey, current + Math.round(Number(holding.request.marketValue) * 100));
  }
  for (const [accountKey, totalMinor] of holdingTotals) {
    const account = accounts.find((item) => item.key === accountKey);
    const openingMinor = Math.round(Number(account.request.openingBalance) * 100);
    const projectedBalanceMinor = openingMinor + (transactionEffects.get(accountKey) ?? 0);
    if (projectedBalanceMinor !== totalMinor) {
      errors.push({
        scope: "reconciliation",
        key: accountKey,
        line: account.evidence.line,
        message: `流水后账户余额与持仓市值不一致：${projectedBalanceMinor} != ${totalMinor}`,
      });
    } else {
      warnings.push({
        scope: "reconciliation",
        key: accountKey,
        message: "持仓市值已包含在账户余额内，不得重复计入净资产",
      });
    }
  }
}

export function isStructuredFolioMarkdown(value) {
  const source = normalizeSource(value);
  const meta = parseFrontmatter(source);
  return meta.folio_import_version === "1";
}

export function parseStructuredFolioMarkdown(value) {
  const source = normalizeSource(value);
  const errors = [];
  const warnings = [];
  if (!source || source.length > MAX_DOCUMENT_CHARS) {
    return {
      status: "invalid",
      meta: {},
      accounts: [],
      holdings: [],
      transactions: [],
      reminders: [],
      planning: null,
      informational: [],
      quarantined: [],
      errors: [{ scope: "document", key: null, line: null, message: "文档必须包含 1 到 40000 个字符" }],
      warnings,
    };
  }
  const meta = parseFrontmatter(source);
  if (meta.folio_import_version !== "1") {
    errors.push({ scope: "document", key: null, line: 1, message: "缺少受支持的 folio_import_version: 1" });
  }
  const dataClassification = meta.data_classification
    || (meta.fictional_data === "true" ? "fictional" : "");
  if (!new Set(["fictional", "personal"]).has(dataClassification)) {
    errors.push({
      scope: "document",
      key: null,
      line: 1,
      message: "批次必须明确 data_classification: personal 或 fictional",
    });
  }
  if (!validDate(meta.as_of_date)) {
    errors.push({ scope: "document", key: null, line: 1, message: "as_of_date 必须是有效日期" });
  }
  const openingBalanceDate = meta.opening_balance_date || meta.as_of_date;
  if (!validDate(openingBalanceDate) || openingBalanceDate > meta.as_of_date) {
    errors.push({ scope: "document", key: null, line: 1, message: "opening_balance_date 必须是不晚于 as_of_date 的有效日期" });
  }
  const accounts = parseAccounts(source, openingBalanceDate, errors);
  const accountMap = new Map(accounts.map((item) => [item.key, item]));
  const holdings = parseHoldings(source, accountMap, meta.as_of_date, errors);
  const transactions = parseTransactions(source, accountMap, errors);
  const reminders = parseReminders(source, accountMap, errors);
  const planning = parsePlanning(source, errors);
  const informational = informationalRecords(source);
  const quarantined = quarantineRecords(source);
  reconciliation(accounts, holdings, transactions, errors, warnings);
  if (accounts.length === 0) {
    errors.push({ scope: "account", key: null, line: null, message: "至少需要一个有效账户" });
  }
  return {
    status: errors.length === 0 ? "reviewable" : "invalid",
    meta,
    accounts,
    holdings,
    transactions,
    reminders,
    planning,
    informational,
    quarantined,
    errors,
    warnings,
    counts: {
      accounts: accounts.length,
      holdings: holdings.length,
      transactions: transactions.length,
      reminders: reminders.length,
      planning: planning ? 1 : 0,
      informational: informational.length,
      quarantined: quarantined.length,
    },
  };
}
