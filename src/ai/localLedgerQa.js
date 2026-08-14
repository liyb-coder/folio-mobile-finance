export const LOCAL_LEDGER_QA_PROVIDER = "local_ledger_qa_v2";

const MAX_QUESTION_CHARS = 500;
const MAX_ANALYTIC_CITATIONS = 12;

function normalizedQuestion(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION_CHARS)
    : "";
}

function formatMoney(minor, currency = "CNY") {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(Number(minor) / 100);
}

function latestTimestamp(values) {
  return values
    .filter((value) => typeof value === "string" && value)
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
}

function citation({
  refType,
  refId,
  label,
  summary,
  dataAt,
}) {
  return { refType, refId, label, summary, dataAt: dataAt ?? null };
}

function baseResult(question, now) {
  return {
    status: "unsupported",
    intent: "unknown",
    providerId: LOCAL_LEDGER_QA_PROVIDER,
    question,
    answer: "",
    citations: [],
    sourceCount: 0,
    metrics: [],
    dataUpdatedAt: null,
    computedAt: now.toISOString(),
    privacy: "local_only",
  };
}

function activeTransactions(transactions) {
  return (transactions ?? []).filter((item) => !item.reversed);
}

function transactionDate(item) {
  return item.occurredAt ?? item.createdAt ?? "";
}

function monthKey(now, offset = 0) {
  const date = new Date(now.getFullYear(), now.getMonth() + offset, 1, 12, 0, 0);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function analyticPeriodForQuestion(question, now) {
  const explicit = periodForQuestion(question, now);
  if (explicit.label !== "全部已确认记录") return explicit;
  const month = monthKey(now);
  return {
    label: "本月",
    accepts: (value) => value?.slice(0, 7) === month,
  };
}

function baseCurrencyRows(snapshot, predicate = () => true) {
  const baseCurrency = snapshot.vault?.baseCurrency ?? "CNY";
  return activeTransactions(snapshot.transactions).filter((item) => (
    (item.currency ?? baseCurrency) === baseCurrency && predicate(item)
  ));
}

function sumMinor(rows) {
  return rows.reduce((sum, item) => sum + Number(item.amountMinor ?? 0), 0);
}

function sortedByAmount(rows) {
  return rows.slice().sort((left, right) => (
    Number(right.amountMinor ?? 0) - Number(left.amountMinor ?? 0)
    || transactionDate(right).localeCompare(transactionDate(left))
  ));
}

function transactionCitation(item, baseCurrency, prefix = "") {
  const kindLabel = item.kind === "income"
    ? "收入"
    : item.kind === "expense" ? "支出" : "转账";
  return citation({
    refType: "ledger_event",
    refId: item.id,
    label: `${prefix}${item.description || `${kindLabel}流水`}`,
    summary: `${item.accountName ?? "账户"} · ${kindLabel} ${formatMoney(item.amountMinor ?? 0, item.currency ?? baseCurrency)}`,
    dataAt: transactionDate(item),
  });
}

function changeDescription(currentMinor, previousMinor, currency) {
  const delta = currentMinor - previousMinor;
  if (delta === 0) return "与上月持平";
  const direction = delta > 0 ? "增加" : "减少";
  if (previousMinor === 0) {
    return `上月为零，本月${direction} ${formatMoney(Math.abs(delta), currency)}`;
  }
  const percentage = Math.abs(delta / previousMinor) * 100;
  return `${direction} ${formatMoney(Math.abs(delta), currency)}（${percentage.toFixed(1)}%）`;
}

function setAnalyticSources(result, rows, baseCurrency, prefixForRow = () => "") {
  const unique = [...new Map(rows.map((item) => [item.id, item])).values()];
  const ranked = sortedByAmount(unique);
  result.sourceCount = unique.length;
  result.citations = ranked
    .slice(0, MAX_ANALYTIC_CITATIONS)
    .map((item) => transactionCitation(item, baseCurrency, prefixForRow(item)));
  result.dataUpdatedAt = latestTimestamp(
    unique.map((item) => item.createdAt ?? transactionDate(item)),
  );
}

function matchingAccount(question, accounts) {
  return (accounts ?? []).find((account) => {
    const names = [account.displayName, account.institutionName]
      .filter((value) => typeof value === "string" && value.length >= 2);
    return names.some((name) => (
      question.includes(name)
      || question.includes(name.replace(/银行|账户|证券|保险|基金/g, ""))
    ));
  }) ?? null;
}

function periodForQuestion(question, now) {
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  if (/今天|今日/.test(question)) {
    return { label: "今天", accepts: (value) => value?.slice(0, 10) === today };
  }
  if (/本月|这个月|当月/.test(question)) {
    const month = today.slice(0, 7);
    return { label: "本月", accepts: (value) => value?.slice(0, 7) === month };
  }
  return { label: "全部已确认记录", accepts: () => true };
}

function answerAccountBalance(result, question, snapshot) {
  const account = matchingAccount(question, snapshot.accounts);
  if (!account) return false;
  const balance = (snapshot.balances ?? []).find((item) => item.accountId === account.id);
  const balanceMinor = Number(balance?.balanceMinor ?? account.balanceMinor ?? 0);
  const dataAt = balance?.lastEventAt ?? account.lastEventAt ?? account.createdAt ?? null;
  result.status = "answered";
  result.intent = "account_balance";
  result.answer = `${account.displayName}当前已确认账本余额为 ${formatMoney(balanceMinor, account.currency)}。`;
  result.citations = [citation({
    refType: "account_balance",
    refId: account.id,
    label: account.displayName,
    summary: `${account.institutionName} · ${formatMoney(balanceMinor, account.currency)}`,
    dataAt,
  })];
  result.sourceCount = 1;
  result.dataUpdatedAt = dataAt;
  return true;
}

function answerTotalBalance(result, snapshot) {
  const baseCurrency = snapshot.vault?.baseCurrency ?? "CNY";
  const matching = (snapshot.balances ?? []).filter(
    (item) => (item.currency ?? baseCurrency) === baseCurrency,
  );
  const totalMinor = matching.reduce(
    (sum, item) => sum + Number(item.balanceMinor ?? 0),
    0,
  );
  const accountsById = new Map((snapshot.accounts ?? []).map((item) => [item.id, item]));
  result.status = "answered";
  result.intent = "total_balance";
  result.answer = matching.length
    ? `当前 ${baseCurrency} 已确认账户余额合计为 ${formatMoney(totalMinor, baseCurrency)}。草稿、其他币种和未建模持仓不计入这个数字。`
    : "当前还没有可汇总的已确认账户余额。";
  result.citations = matching.slice(0, 8).map((item) => {
    const account = accountsById.get(item.accountId);
    return citation({
      refType: "account_balance",
      refId: item.accountId,
      label: account?.displayName ?? "账户余额",
      summary: formatMoney(item.balanceMinor ?? 0, item.currency ?? baseCurrency),
      dataAt: item.lastEventAt ?? account?.lastEventAt ?? account?.createdAt,
    });
  });
  result.sourceCount = matching.length;
  result.dataUpdatedAt = latestTimestamp(result.citations.map((item) => item.dataAt));
  return true;
}

function answerFlowTotal(result, question, snapshot, now, kind) {
  const period = periodForQuestion(question, now);
  const rows = activeTransactions(snapshot.transactions)
    .filter((item) => item.kind === kind && period.accepts(item.occurredAt));
  const baseCurrency = snapshot.vault?.baseCurrency ?? "CNY";
  const matching = rows.filter((item) => (item.currency ?? baseCurrency) === baseCurrency);
  const totalMinor = matching.reduce((sum, item) => sum + Number(item.amountMinor ?? 0), 0);
  const kindLabel = kind === "income" ? "收入" : "支出";
  result.status = "answered";
  result.intent = `${kind}_total`;
  result.answer = matching.length
    ? `${period.label}${kindLabel}合计 ${formatMoney(totalMinor, baseCurrency)}，来自 ${matching.length} 笔未冲销的已确认流水。`
    : `${period.label}没有找到未冲销的已确认${kindLabel}流水。`;
  result.citations = matching.slice(0, 8).map((item) => citation({
    refType: "ledger_event",
    refId: item.id,
    label: item.description || `${kindLabel}流水`,
    summary: `${item.accountName ?? "账户"} · ${formatMoney(item.amountMinor ?? 0, item.currency ?? baseCurrency)}`,
    dataAt: item.occurredAt ?? item.createdAt,
  }));
  result.sourceCount = matching.length;
  result.dataUpdatedAt = latestTimestamp(
    matching.map((item) => item.createdAt ?? item.occurredAt),
  );
  return true;
}

function answerRecentTransactions(result, snapshot) {
  const rows = activeTransactions(snapshot.transactions)
    .slice()
    .sort((left, right) => (
      (right.occurredAt ?? right.createdAt ?? "")
        .localeCompare(left.occurredAt ?? left.createdAt ?? "")
    ))
    .slice(0, 5);
  result.status = "answered";
  result.intent = "recent_transactions";
  result.answer = rows.length
    ? `最近有 ${rows.length} 笔未冲销的已确认流水，最新一笔是“${rows[0].description || "未命名流水"}”。`
    : "当前还没有可引用的已确认流水。";
  result.citations = rows.map((item) => citation({
    refType: "ledger_event",
    refId: item.id,
    label: item.description || "未命名流水",
    summary: `${item.accountName ?? "账户"} · ${formatMoney(item.amountMinor ?? 0, item.currency ?? "CNY")}`,
    dataAt: item.occurredAt ?? item.createdAt,
  }));
  result.sourceCount = rows.length;
  result.dataUpdatedAt = latestTimestamp(
    rows.map((item) => item.createdAt ?? item.occurredAt),
  );
  return true;
}

function answerReminders(result, snapshot) {
  const rows = (snapshot.reminders ?? [])
    .filter((item) => item.status === "active" || item.status === "snoozed")
    .slice()
    .sort((left, right) => left.dueOn.localeCompare(right.dueOn))
    .slice(0, 5);
  result.status = "answered";
  result.intent = "upcoming_reminders";
  result.answer = rows.length
    ? `接下来有 ${rows.length} 项待处理财务事项，最近的是“${rows[0].title}”，关注日期 ${rows[0].dueOn}。`
    : "当前没有待处理的财务事项。";
  result.citations = rows.map((item) => citation({
    refType: "reminder",
    refId: item.id,
    label: item.title,
    summary: `${item.dueOn}${item.amountMinor == null ? "" : ` · ${formatMoney(item.amountMinor, item.currency ?? snapshot.vault?.baseCurrency ?? "CNY")}`}`,
    dataAt: item.updatedAt ?? item.createdAt,
  }));
  result.sourceCount = rows.length;
  result.dataUpdatedAt = latestTimestamp(
    rows.map((item) => item.updatedAt ?? item.createdAt),
  );
  return true;
}

function answerMonthComparison(result, question, snapshot, now) {
  if (!/上月|上个月|环比|相比|比较/.test(question)) return false;
  if (!/收入|支出|收支|花了|消费|现金流/.test(question)) return false;
  const baseCurrency = snapshot.vault?.baseCurrency ?? "CNY";
  const currentMonth = monthKey(now);
  const previousMonth = monthKey(now, -1);
  const rows = baseCurrencyRows(snapshot, (item) => (
    (item.kind === "income" || item.kind === "expense")
    && [currentMonth, previousMonth].includes(transactionDate(item).slice(0, 7))
  ));
  const currentRows = rows.filter((item) => transactionDate(item).slice(0, 7) === currentMonth);
  const previousRows = rows.filter((item) => transactionDate(item).slice(0, 7) === previousMonth);
  const totals = (values) => ({
    income: sumMinor(values.filter((item) => item.kind === "income")),
    expense: sumMinor(values.filter((item) => item.kind === "expense")),
  });
  const current = totals(currentRows);
  const previous = totals(previousRows);
  const wantsExpense = /支出|花了|消费/.test(question);
  const wantsIncome = /收入|到账|赚了/.test(question);
  let sourceRows = rows;

  result.status = "answered";
  if (wantsExpense && !wantsIncome) {
    sourceRows = rows.filter((item) => item.kind === "expense");
    result.intent = "expense_month_comparison";
    result.answer = `本月支出 ${formatMoney(current.expense, baseCurrency)}，上月支出 ${formatMoney(previous.expense, baseCurrency)}；${changeDescription(current.expense, previous.expense, baseCurrency)}。`;
    result.metrics = [
      { label: "本月支出", value: formatMoney(current.expense, baseCurrency) },
      { label: "上月支出", value: formatMoney(previous.expense, baseCurrency) },
      {
        label: "环比变化",
        value: formatMoney(current.expense - previous.expense, baseCurrency),
        tone: current.expense > previous.expense ? "warning" : "positive",
      },
    ];
  } else if (wantsIncome && !wantsExpense) {
    sourceRows = rows.filter((item) => item.kind === "income");
    result.intent = "income_month_comparison";
    result.answer = `本月收入 ${formatMoney(current.income, baseCurrency)}，上月收入 ${formatMoney(previous.income, baseCurrency)}；${changeDescription(current.income, previous.income, baseCurrency)}。`;
    result.metrics = [
      { label: "本月收入", value: formatMoney(current.income, baseCurrency) },
      { label: "上月收入", value: formatMoney(previous.income, baseCurrency) },
      {
        label: "环比变化",
        value: formatMoney(current.income - previous.income, baseCurrency),
        tone: current.income >= previous.income ? "positive" : "warning",
      },
    ];
  } else {
    const currentNet = current.income - current.expense;
    const previousNet = previous.income - previous.expense;
    result.intent = "cashflow_month_comparison";
    result.answer = `本月收入 ${formatMoney(current.income, baseCurrency)}、支出 ${formatMoney(current.expense, baseCurrency)}，净现金流 ${formatMoney(currentNet, baseCurrency)}；上月净现金流 ${formatMoney(previousNet, baseCurrency)}，${changeDescription(currentNet, previousNet, baseCurrency)}。`;
    result.metrics = [
      { label: "本月净现金流", value: formatMoney(currentNet, baseCurrency) },
      { label: "上月净现金流", value: formatMoney(previousNet, baseCurrency) },
      {
        label: "净变化",
        value: formatMoney(currentNet - previousNet, baseCurrency),
        tone: currentNet >= previousNet ? "positive" : "warning",
      },
    ];
  }
  setAnalyticSources(
    result,
    sourceRows,
    baseCurrency,
    (item) => (transactionDate(item).slice(0, 7) === currentMonth ? "本月 · " : "上月 · "),
  );
  return true;
}

function answerExpenseCategories(result, question, snapshot, now) {
  if (!/哪类|分类|花在哪|花到哪|支出结构|支出去向|最多的支出/.test(question)) {
    return false;
  }
  const period = analyticPeriodForQuestion(question, now);
  const baseCurrency = snapshot.vault?.baseCurrency ?? "CNY";
  const rows = baseCurrencyRows(snapshot, (item) => (
    item.kind === "expense" && period.accepts(transactionDate(item))
  ));
  const grouped = new Map();
  for (const row of rows) {
    const category = row.category?.trim() || "未分类";
    const current = grouped.get(category) ?? { category, totalMinor: 0, count: 0 };
    current.totalMinor += Number(row.amountMinor ?? 0);
    current.count += 1;
    grouped.set(category, current);
  }
  const categories = [...grouped.values()].sort((left, right) => (
    right.totalMinor - left.totalMinor || left.category.localeCompare(right.category, "zh-CN")
  ));
  result.status = "answered";
  result.intent = "expense_categories";
  result.answer = categories.length
    ? `${period.label}支出最多的是“${categories[0].category}”，共 ${formatMoney(categories[0].totalMinor, baseCurrency)}；前三类为 ${categories.slice(0, 3).map((item) => `${item.category} ${formatMoney(item.totalMinor, baseCurrency)}`).join("、")}。`
    : `${period.label}没有可用于分类分析的未冲销已确认支出。`;
  result.metrics = categories.slice(0, 3).map((item) => ({
    label: item.category,
    value: formatMoney(item.totalMinor, baseCurrency),
    detail: `${item.count} 笔`,
  }));
  setAnalyticSources(result, rows, baseCurrency);
  return true;
}

function answerLargestExpenses(result, question, snapshot, now) {
  if (!/大额|最大|最高|最贵|异常支出/.test(question) || !/支出|消费|花/.test(question)) {
    return false;
  }
  const period = analyticPeriodForQuestion(question, now);
  const baseCurrency = snapshot.vault?.baseCurrency ?? "CNY";
  const rows = sortedByAmount(baseCurrencyRows(snapshot, (item) => (
    item.kind === "expense" && period.accepts(transactionDate(item))
  ))).slice(0, 5);
  result.status = "answered";
  result.intent = "largest_expenses";
  result.answer = rows.length
    ? `${period.label}金额最大的支出是“${rows[0].description || "未命名支出"}” ${formatMoney(rows[0].amountMinor ?? 0, baseCurrency)}。这里仅按已确认金额排序，不自动判定交易异常。`
    : `${period.label}没有未冲销的已确认支出。`;
  result.metrics = rows.slice(0, 3).map((item, index) => ({
    label: `第 ${index + 1} 笔`,
    value: formatMoney(item.amountMinor ?? 0, baseCurrency),
    detail: item.description || "未命名支出",
  }));
  setAnalyticSources(result, rows, baseCurrency);
  return true;
}

function answerCashflowExplanation(result, question, snapshot, now) {
  if (!/净现金流|现金流|为什么.*(?:余额|钱)|余额.*为什么|资产变化|余额变化/.test(question)) {
    return false;
  }
  const period = analyticPeriodForQuestion(question, now);
  const baseCurrency = snapshot.vault?.baseCurrency ?? "CNY";
  const rows = baseCurrencyRows(snapshot, (item) => (
    (item.kind === "income" || item.kind === "expense")
    && period.accepts(transactionDate(item))
  ));
  const income = sumMinor(rows.filter((item) => item.kind === "income"));
  const expense = sumMinor(rows.filter((item) => item.kind === "expense"));
  const net = income - expense;
  result.status = "answered";
  result.intent = "cashflow_explanation";
  result.answer = rows.length
    ? `${period.label}已确认收入 ${formatMoney(income, baseCurrency)}，支出 ${formatMoney(expense, baseCurrency)}，因此净现金流为 ${formatMoney(net, baseCurrency)}。转账、其他币种和未建模持仓变化不计入这项解释。`
    : `${period.label}没有可解释余额变化的基础币种收入或支出流水；转账和未建模持仓也不会被猜测为收益。`;
  result.metrics = [
    { label: "收入", value: formatMoney(income, baseCurrency), tone: "positive" },
    { label: "支出", value: formatMoney(expense, baseCurrency), tone: "warning" },
    {
      label: "净现金流",
      value: formatMoney(net, baseCurrency),
      tone: net >= 0 ? "positive" : "warning",
    },
  ];
  setAnalyticSources(result, rows, baseCurrency);
  return true;
}

export function answerLocalLedgerQuestion({
  question: rawQuestion,
  snapshot = {},
  now = new Date(),
}) {
  const question = normalizedQuestion(rawQuestion);
  const result = baseResult(question, now);
  if (!question) {
    result.status = "needs_input";
    result.answer = "请输入一个关于余额、收支、近期流水或财务事项的问题。";
    return result;
  }

  if (
    /预测|收益率|推荐|买什么|该不该买|涨跌|投资建议|诊断/.test(question)
  ) {
    result.answer = "本地账本问答只陈述已确认事实，不提供收益预测、买卖建议或未建模持仓判断。";
    return result;
  }
  if (/提醒|事项|到期|要做什么|待处理/.test(question)) {
    answerReminders(result, snapshot);
    return result;
  }
  if (answerMonthComparison(result, question, snapshot, now)) return result;
  if (answerExpenseCategories(result, question, snapshot, now)) return result;
  if (answerLargestExpenses(result, question, snapshot, now)) return result;
  if (answerCashflowExplanation(result, question, snapshot, now)) return result;
  if (
    /(余额|有多少钱|还有多少钱)/.test(question)
    && answerAccountBalance(result, question, snapshot)
  ) {
    return result;
  }
  if (/总余额|账户余额|有多少钱|还有多少钱|净资产|总资产/.test(question)) {
    answerTotalBalance(result, snapshot);
    return result;
  }
  if (/支出|花了|消费/.test(question)) {
    answerFlowTotal(result, question, snapshot, now, "expense");
    return result;
  }
  if (/收入|赚了|到账/.test(question)) {
    answerFlowTotal(result, question, snapshot, now, "income");
    return result;
  }
  if (/最近|流水|交易|发生了什么/.test(question)) {
    answerRecentTransactions(result, snapshot);
    return result;
  }

  result.answer = "我目前可以在本机回答：账户/总余额、今日或本月收支、本月与上月比较、支出分类、金额最大的支出、现金流解释、最近流水和待处理事项。这个问题不会发送到云端，也没有产生写入。";
  return result;
}
