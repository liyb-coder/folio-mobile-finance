import { todayForDateInput } from "../data/local/accountDraft.js";

export const LOCAL_PROPOSAL_PROVIDER = "local_rules_v1";
export const LOCAL_PROPOSAL_PARSER_VERSION = "zh-finance-rules-3";

const CHINESE_DIGITS = Object.freeze({
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
});

const SMALL_UNITS = Object.freeze({ 十: 10, 百: 100, 千: 1000 });
const LARGE_UNITS = Object.freeze({ 万: 10_000, 亿: 100_000_000 });

function normalizeTranscript(value) {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .slice(0, 40_000);
}

export function parseChineseInteger(value) {
  const text = normalizeTranscript(value);
  if (!text || !/^[零〇一二两三四五六七八九十百千万亿]+$/.test(text)) return null;
  let total = 0;
  let section = 0;
  let digit = null;
  let lastSmallUnit = 1;
  for (const character of text) {
    if (Object.hasOwn(CHINESE_DIGITS, character)) {
      digit = CHINESE_DIGITS[character];
      continue;
    }
    if (Object.hasOwn(SMALL_UNITS, character)) {
      const unit = SMALL_UNITS[character];
      section += (digit ?? 1) * unit;
      digit = null;
      lastSmallUnit = unit;
      continue;
    }
    const unit = LARGE_UNITS[character];
    section += digit ?? 0;
    total += section * unit;
    section = 0;
    digit = null;
    lastSmallUnit = unit;
  }
  if (digit != null) {
    const colloquialPlace = lastSmallUnit >= 100 ? lastSmallUnit / 10 : 1;
    section += digit * colloquialPlace;
  }
  const result = total + section;
  return Number.isSafeInteger(result) ? result : null;
}

function scaleDecimalString(value, multiplier) {
  const normalized = value.replaceAll(",", "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [major, fraction = ""] = normalized.split(".");
  const hundredths = BigInt(major) * 100n + BigInt(fraction.padEnd(2, "0"));
  const scaled = hundredths * BigInt(multiplier);
  const whole = scaled / 100n;
  const cents = scaled % 100n;
  if (whole > 90_000_000_000_000n) return null;
  return cents === 0n ? whole.toString() : `${whole}.${cents.toString().padStart(2, "0")}`;
}

function moneyEvidence(transcript) {
  const patterns = [
    /([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(万|千)?\s*(?:元|块|人民币)/g,
    /([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(万|千)(?![年月日])/g,
    /([零〇一二两三四五六七八九十百千万亿]+)\s*(?:元|块|人民币)/g,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(transcript);
    if (!match) continue;
    let amount;
    if (/^[0-9]/.test(match[1])) {
      amount = scaleDecimalString(match[1], match[2] === "万" ? 10_000 : match[2] === "千" ? 1_000 : 1);
    } else {
      const parsed = parseChineseInteger(match[1]);
      amount = parsed == null ? null : String(parsed);
    }
    if (amount) {
      return {
        amount,
        evidence: {
          field: "amount",
          text: match[0],
          range: [match.index, match.index + match[0].length],
        },
      };
    }
  }
  return null;
}

function dateEvidence(transcript, now) {
  const localToday = todayForDateInput(now);
  const relative = [
    ["后天", 2],
    ["明天", 1],
    ["今天", 0],
  ].find(([word]) => transcript.includes(word));
  if (relative) {
    const date = new Date(`${localToday}T12:00:00`);
    date.setDate(date.getDate() + relative[1]);
    const value = todayForDateInput(date);
    const index = transcript.indexOf(relative[0]);
    return {
      value,
      confidence: 0.98,
      evidence: { field: "date", text: relative[0], range: [index, index + relative[0].length] },
    };
  }
  const full = /(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})日?/.exec(transcript);
  const partial = /(?:^|[^\d])(\d{1,2})月(\d{1,2})日?/.exec(transcript);
  const chinese = /([一二三四五六七八九十]{1,3})月([一二三四五六七八九十]{1,3})日/.exec(transcript);
  const match = full ?? partial ?? chinese;
  if (match) {
    const year = full ? Number(match[1]) : Number(localToday.slice(0, 4));
    const month = chinese
      ? parseChineseInteger(chinese[1])
      : Number(full ? match[2] : match[1]);
    const day = chinese
      ? parseChineseInteger(chinese[2])
      : Number(full ? match[3] : match[2]);
    const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value) {
      const text = match[0].trim();
      const index = transcript.indexOf(text);
      return {
        value,
        confidence: 0.96,
        evidence: { field: "date", text, range: [index, index + text.length] },
      };
    }
  }
  return {
    value: localToday,
    confidence: 0.62,
    evidence: null,
  };
}

function accountMentions(transcript, accounts) {
  const mentions = [];
  for (const account of accounts ?? []) {
    const institution = account.institutionName ?? "";
    const bankShort = institution.endsWith("银行")
      ? `${institution.replace(/银行$/, "").slice(0, 1)}行`
      : "";
    const names = [account.displayName, institution, bankShort]
      .filter((value) => typeof value === "string" && value.trim().length >= 2);
    let best = null;
    for (const name of names) {
      const exactIndex = transcript.indexOf(name);
      const short = name.replace(/银行|账户|证券|保险|基金/g, "");
      const shortIndex = short.length >= 2 ? transcript.indexOf(short) : -1;
      const index = exactIndex >= 0 ? exactIndex : shortIndex;
      if (index >= 0 && (!best || index < best.index)) {
        const text = exactIndex >= 0 ? name : short;
        best = { account, index, text, confidence: exactIndex >= 0 ? 0.98 : 0.84 };
      }
    }
    if (best) mentions.push(best);
  }
  return mentions.sort((left, right) => left.index - right.index);
}

function holdingMentions(transcript, holdings) {
  const mentions = [];
  for (const holding of holdings ?? []) {
    const name = typeof holding?.name === "string" ? holding.name.trim() : "";
    if (!name || holding.archivedAt) continue;
    const aliases = [
      name,
      name.replace(/基金|理财|产品|持仓/g, "").trim(),
    ].filter((value, index, values) => value.length >= 2 && values.indexOf(value) === index);
    let best = null;
    for (const alias of aliases) {
      const index = transcript.indexOf(alias);
      if (index >= 0 && (!best || index < best.index || alias.length > best.text.length)) {
        best = {
          holding,
          index,
          text: alias,
          confidence: alias === name ? 0.99 : 0.84,
        };
      }
    }
    if (best) mentions.push(best);
  }
  return mentions.sort((left, right) => left.index - right.index);
}

function numericToken(value, multiplier = "", maxFraction = 2) {
  if (!value) return null;
  if (/^[0-9]/.test(value)) {
    const normalized = value.replaceAll(",", "");
    if (maxFraction > 2 && !multiplier) {
      const pattern = new RegExp(`^\\d+(?:\\.\\d{1,${maxFraction}})?$`);
      return pattern.test(normalized) ? normalized : null;
    }
    return scaleDecimalString(
      value,
      multiplier === "万" ? 10_000 : multiplier === "千" ? 1_000 : 1,
    );
  }
  const parsed = parseChineseInteger(value);
  if (parsed == null) return null;
  const scale = multiplier === "万" ? 10_000 : multiplier === "千" ? 1_000 : 1;
  return String(parsed * scale);
}

const SPOKEN_NUMBER = "[0-9][0-9,]*(?:\\.[0-9]{1,6})?|[零〇一二两三四五六七八九十百千万亿]+";

function labeledNumberEvidence(
  transcript,
  labels,
  fieldName,
  suffixPattern,
  maxFraction = 2,
) {
  const pattern = new RegExp(
    `(?:${labels.join("|")})\\s*(?:为|是|到|变为|剩余|：|:)?\\s*(${SPOKEN_NUMBER})\\s*(万|千)?\\s*${suffixPattern}`,
  );
  const match = pattern.exec(transcript);
  if (!match) return null;
  const value = numericToken(match[1], match[2], maxFraction);
  if (value == null) return null;
  return {
    value,
    evidence: {
      field: fieldName,
      text: match[0],
      range: [match.index, match.index + match[0].length],
    },
  };
}

function holdingOperationKind(transcript) {
  const matches = [
    ["purchase", /申购|买入|购买|买了/],
    ["redeem", /赎回|卖出|卖了/],
    ["dividend", /分红|派息/],
    ["fee", /手续费|管理费|产品费用|收取费用/],
  ].filter(([, pattern]) => pattern.test(transcript));
  return matches.length === 1 ? matches[0][0] : null;
}

function holdingOperationProposal(transcript, context, accounts, holdings, now) {
  const proposal = proposalBase(transcript, context, "holding_operation");
  const operationKind = holdingOperationKind(transcript);
  const holdingMatches = holdingMentions(transcript, holdings);
  const holding = holdingMatches.length === 1 ? holdingMatches[0].holding : null;
  const date = dateEvidence(transcript, now);
  const amount = labeledNumberEvidence(
    transcript,
    ["申购(?:金额)?", "买入(?:金额)?", "购买(?:金额)?", "买了", "赎回(?:金额)?", "卖出(?:金额)?", "卖了", "分红(?:金额)?", "派息(?:金额)?", "手续费", "管理费", "产品费用", "收取费用"],
    "amount",
    "(?:元|块|人民币)",
  );
  const resultingUnits = labeledNumberEvidence(
    transcript,
    ["(?:操作后|完成后|剩余|变为)?(?:持仓)?(?:数量|份额|份数)"],
    "resultingUnits",
    "(?:份|单位)?",
    6,
  );
  const resultingCostBasis = labeledNumberEvidence(
    transcript,
    ["(?:操作后|完成后|剩余|变为)?(?:累计)?成本"],
    "resultingCostBasis",
    "(?:元|块|人民币)",
  );
  const resultingMarketValue = labeledNumberEvidence(
    transcript,
    ["(?:操作后|完成后|剩余|变为)?(?:当前)?市值"],
    "resultingMarketValue",
    "(?:元|块|人民币)",
  );
  const accountMatches = accountMentions(transcript, accounts);
  const explicitSettlement = accountMatches[0]?.account ?? null;
  const positionChanging = operationKind === "purchase" || operationKind === "redeem";
  const settlement = positionChanging
    ? explicitSettlement
    : explicitSettlement
      ?? accounts.find((account) => account.id === holding?.accountId)
      ?? null;

  if (!operationKind) {
    proposal.unresolved.push(
      /调仓/.test(transcript)
        ? "调仓必须拆成单笔申购或赎回，并分别明确结果持仓"
        : "一次只能口述一种产品操作：申购、赎回、分红或费用",
    );
  }
  if (holdingMatches.length === 0) proposal.unresolved.push("未匹配到现有持仓名称");
  if (holdingMatches.length > 1) proposal.unresolved.push("同时匹配到多个持仓，请只说一个完整持仓名称");
  if (!amount) proposal.unresolved.push("未识别到紧跟产品操作的明确金额");
  if (!date.evidence) proposal.warnings.push("没有说日期，暂按今天生成草稿，请核对。");
  if (positionChanging) {
    if (!resultingUnits) proposal.unresolved.push("申购或赎回必须明确操作后份额");
    if (!resultingCostBasis) proposal.unresolved.push("申购或赎回必须明确操作后累计成本");
    if (!resultingMarketValue) proposal.unresolved.push("申购或赎回必须明确操作后当前市值");
  }
  if (!positionChanging && !settlement) {
    proposal.unresolved.push("分红或费用必须能确定同币种入账账户");
  }
  if (holding && settlement && holding.currency !== settlement.currency) {
    proposal.unresolved.push("结算账户币种必须与持仓一致");
  }

  const parsedUnits = resultingUnits ? Number(resultingUnits.value) : null;
  const parsedCost = resultingCostBasis ? Number(resultingCostBasis.value) : null;
  const currentUnits = holding ? Number(holding.unitsMicros ?? 0) / 1_000_000 : null;
  const currentCost = holding ? Number(holding.costBasisMinor ?? 0) / 100 : null;
  if (
    operationKind === "purchase"
    && holding
    && resultingUnits
    && resultingCostBasis
    && (!(parsedUnits > currentUnits) || parsedCost < currentCost)
  ) {
    proposal.unresolved.push("申购后份额必须增加，累计成本不能减少");
  }
  if (
    operationKind === "redeem"
    && holding
    && resultingUnits
    && resultingCostBasis
    && (!(parsedUnits < currentUnits) || parsedCost > currentCost)
  ) {
    proposal.unresolved.push("赎回后份额必须减少，累计成本不能增加");
  }

  const operationLabels = {
    purchase: "申购",
    redeem: "赎回",
    dividend: "分红",
    fee: "费用",
  };
  proposal.fields = [
    field("holdingId", "持仓", holding?.name ?? "待选择", holdingMatches[0]?.confidence ?? 0, true, holding ? "" : "必填"),
    field("operationKind", "产品操作", operationLabels[operationKind] ?? "待选择", operationKind ? 0.98 : 0, true, operationKind ? "" : "必填"),
    field("amount", "操作金额", amount?.value ?? "待补充", amount ? 0.98 : 0, true, amount ? "" : "必填"),
    field(
      "settlementAccountId",
      "结算账户",
      settlement?.displayName ?? (positionChanging ? "持仓内部" : "待选择"),
      explicitSettlement ? accountMatches[0]?.confidence ?? 0.9 : settlement ? 0.86 : 0.72,
      !positionChanging,
      !explicitSettlement && positionChanging ? "未说账户，按持仓内部操作" : "",
    ),
    ...(positionChanging ? [
      field("resultingUnits", "操作后份额", resultingUnits?.value ?? "待补充", resultingUnits ? 0.98 : 0, true, resultingUnits ? "" : "必填"),
      field("resultingCostBasis", "操作后累计成本", resultingCostBasis?.value ?? "待补充", resultingCostBasis ? 0.98 : 0, true, resultingCostBasis ? "" : "必填"),
      field("resultingMarketValue", "操作后当前市值", resultingMarketValue?.value ?? "待补充", resultingMarketValue ? 0.98 : 0, true, resultingMarketValue ? "" : "必填"),
    ] : []),
    field("occurredOn", "发生日期", date.value, date.confidence, true, date.evidence ? "" : "默认今天"),
  ];
  proposal.evidence = [
    ...holdingMatches.slice(0, 1).map((mention) => ({
      field: "holding",
      text: mention.text,
      range: [mention.index, mention.index + mention.text.length],
      holdingId: mention.holding.id,
    })),
    ...(explicitSettlement ? [{
      field: "settlementAccount",
      text: accountMatches[0].text,
      range: [
        accountMatches[0].index,
        accountMatches[0].index + accountMatches[0].text.length,
      ],
      accountId: explicitSettlement.id,
    }] : []),
    ...(amount ? [amount.evidence] : []),
    ...(resultingUnits ? [resultingUnits.evidence] : []),
    ...(resultingCostBasis ? [resultingCostBasis.evidence] : []),
    ...(resultingMarketValue ? [resultingMarketValue.evidence] : []),
    ...(date.evidence ? [date.evidence] : []),
  ];
  proposal.warnings.push("语音只生成产品操作核对草稿；正式持仓与账本必须再次明确确认。");
  if (positionChanging && !explicitSettlement) {
    proposal.warnings.push("未说结算账户，本次按持仓内部申购/赎回处理，不生成资金流水。");
  }
  if (proposal.unresolved.length === 0) {
    proposal.status = "reviewable";
    proposal.confidence = positionChanging ? 0.93 : 0.9;
    proposal.draftRequest = {
      holdingId: holding.id,
      operationKind,
      settlementAccountId: positionChanging
        ? explicitSettlement?.id ?? null
        : settlement.id,
      amount: amount.value,
      occurredOn: date.value,
      description: `语音${operationLabels[operationKind]} · ${holding.name}`,
      notes: "由本地口述提案生成；所有数值来自原文证据，确认前请逐项核对。",
      resultingUnits: positionChanging ? resultingUnits.value : null,
      resultingCostBasis: positionChanging ? resultingCostBasis.value : null,
      resultingMarketValue: positionChanging ? resultingMarketValue.value : null,
      valuationDate: positionChanging ? date.value : null,
    };
  }
  return proposal;
}

function field(key, label, value, confidence, required = true, issue = "") {
  return { key, label, value, confidence, required, issue };
}

function proposalBase(transcript, context, kind) {
  return {
    status: "needs_input",
    kind,
    context,
    inputKind: "text",
    providerId: LOCAL_PROPOSAL_PROVIDER,
    parserVersion: LOCAL_PROPOSAL_PARSER_VERSION,
    transcript,
    confidence: 0,
    fields: [],
    evidence: [],
    warnings: [],
    unresolved: [],
    draftRequest: null,
  };
}

function transactionProposal(transcript, context, accounts, now) {
  const proposal = proposalBase(transcript, context, "transaction");
  const mentions = accountMentions(transcript, accounts);
  const money = moneyEvidence(transcript);
  const date = dateEvidence(transcript, now);
  const transfer = /转账|转到|转入|划转|调拨/.test(transcript);
  const income = !transfer && /收到|收入|到账|工资|租金|报销|收益/.test(transcript);
  const expense = !transfer && /花了|支出|支付|付款|消费|买了|购买|缴费|扣款/.test(transcript);
  const kind = transfer ? "transfer" : income ? "income" : expense ? "expense" : null;
  const account = mentions[0]?.account ?? null;
  const destination = transfer ? mentions.find((mention) => mention.account.id !== account?.id)?.account ?? null : null;
  const category = transfer
    ? "账户调拨"
    : income
      ? (/租金/.test(transcript) ? "租金" : /工资/.test(transcript) ? "工资" : /收益/.test(transcript) ? "理财收益" : "其他收入")
      : /餐|饭|外卖/.test(transcript)
        ? "餐饮"
        : /交通|打车|地铁/.test(transcript)
          ? "交通"
          : /保险|保费/.test(transcript)
            ? "保险"
            : /买|购物|日用品/.test(transcript)
              ? "购物"
              : "其他支出";
  if (!kind) proposal.unresolved.push("无法判断这是收入、支出还是转账");
  if (!money) proposal.unresolved.push("未识别到明确金额");
  if (!account) proposal.unresolved.push("未匹配到现有账户");
  if (transfer && !destination) proposal.unresolved.push("未匹配到转入账户");
  if (transfer && account && destination && account.currency !== destination.currency) {
    proposal.unresolved.push("跨币种转账需要单独核对汇率");
  }
  proposal.fields = [
    field("transactionKind", "流水类型", kind ?? "待选择", kind ? 0.95 : 0, true, kind ? "" : "必填"),
    field("accountId", transfer ? "转出账户" : "账户", account?.displayName ?? "待选择", mentions[0]?.confidence ?? 0, true, account ? "" : "必填"),
    ...(transfer ? [field("destinationAccountId", "转入账户", destination?.displayName ?? "待选择", mentions[1]?.confidence ?? 0, true, destination ? "" : "必填")] : []),
    field("amount", "金额", money?.amount ?? "待补充", money ? 0.96 : 0, true, money ? "" : "必填"),
    field("occurredOn", "发生日期", date.value, date.confidence, true, date.evidence ? "" : "默认今天"),
    field("category", "分类", category, 0.78, false),
  ];
  proposal.evidence = [
    ...(mentions.map((mention) => ({
      field: "account",
      text: mention.text,
      range: [mention.index, mention.index + mention.text.length],
      accountId: mention.account.id,
    }))),
    ...(money ? [money.evidence] : []),
    ...(date.evidence ? [date.evidence] : []),
  ];
  if (!date.evidence) proposal.warnings.push("没有说日期，暂按今天生成草稿，请核对。");
  if (proposal.unresolved.length === 0) {
    proposal.status = "reviewable";
    proposal.confidence = Math.min(
      0.96,
      (mentions[0]?.confidence ?? 0.8) * 0.34 + 0.38 + date.confidence * 0.28,
    );
    proposal.draftRequest = {
      transactionKind: kind,
      accountId: account.id,
      destinationAccountId: transfer ? destination.id : null,
      amount: money.amount,
      occurredOn: date.value,
      description: transcript.slice(0, 120),
      category,
      notes: "由本地口述提案生成，确认前请核对原文与证据。",
    };
  }
  return proposal;
}

function reminderProposal(transcript, context, accounts, now) {
  const proposal = proposalBase(transcript, context, "reminder");
  const date = dateEvidence(transcript, now);
  const money = moneyEvidence(transcript);
  const mentions = accountMentions(transcript, accounts);
  const advanceMatch = /提前\s*([0-9]+|[零〇一二两三四五六七八九十百]+)\s*天/.exec(transcript);
  const advanceDays = advanceMatch
    ? (/^\d+$/.test(advanceMatch[1]) ? Number(advanceMatch[1]) : parseChineseInteger(advanceMatch[1]))
    : 3;
  const category = /保险|保费|续保/.test(transcript)
    ? "insurance"
    : /租金|房租/.test(transcript)
      ? "rent"
      : /到期|赎回/.test(transcript)
        ? "maturity"
        : /还款|贷款|信用卡/.test(transcript)
          ? "repayment"
          : /定投/.test(transcript)
            ? "investment"
            : /闲置|活期/.test(transcript)
              ? "idle_cash"
              : "custom";
  const title = {
    insurance: /续/.test(transcript)
      ? "保险续缴"
      : /缴|交/.test(transcript)
        ? "缴纳保费"
        : "保险事项",
    rent: "租金事项",
    maturity: "产品到期",
    repayment: "还款事项",
    investment: "定投事项",
    idle_cash: "闲置资金检查",
    custom: "财务事项",
  }[category];
  const hasExplicitDate = Boolean(date.evidence);
  if (!hasExplicitDate) proposal.unresolved.push("事项必须说出明确日期");
  if (!Number.isSafeInteger(advanceDays) || advanceDays < 0 || advanceDays > 3650) {
    proposal.unresolved.push("提前提醒天数无效");
  }
  proposal.fields = [
    field("title", "事项标题", title, 0.78),
    field("category", "事项类型", category, 0.9),
    field("dueOn", "关注日期", hasExplicitDate ? date.value : "待补充", hasExplicitDate ? date.confidence : 0, true, hasExplicitDate ? "" : "必填"),
    field("amount", "金额", money?.amount ?? "未设置", money ? 0.96 : 0.7, false),
    field("advanceDays", "提前提醒", `${advanceDays} 天`, advanceMatch ? 0.95 : 0.62, false, advanceMatch ? "" : "默认 3 天"),
    field("linkedAccountId", "关联账户", mentions[0]?.account.displayName ?? "不关联", mentions[0]?.confidence ?? 0.7, false),
  ];
  proposal.evidence = [
    ...(money ? [money.evidence] : []),
    ...(date.evidence ? [date.evidence] : []),
    ...(advanceMatch ? [{
      field: "advanceDays",
      text: advanceMatch[0],
      range: [advanceMatch.index, advanceMatch.index + advanceMatch[0].length],
    }] : []),
    ...(mentions.slice(0, 1).map((mention) => ({
      field: "account",
      text: mention.text,
      range: [mention.index, mention.index + mention.text.length],
      accountId: mention.account.id,
    }))),
  ];
  if (!advanceMatch) proposal.warnings.push("没有说提前多久提醒，暂按 3 天生成草稿。");
  if (proposal.unresolved.length === 0) {
    proposal.status = "reviewable";
    proposal.confidence = money ? 0.9 : 0.82;
    proposal.draftRequest = {
      title,
      category,
      linkedAccountId: mentions[0]?.account.id ?? null,
      amount: money?.amount ?? null,
      dueOn: date.value,
      advanceDays,
      recurrenceRule: /每月|每个月/.test(transcript) ? "monthly" : /每年/.test(transcript) ? "yearly" : null,
      notes: "由本地口述提案生成，确认前请核对原文与证据。",
    };
  }
  return proposal;
}

function accountProposal(transcript, context, now) {
  const proposal = proposalBase(transcript, context, "account");
  if (/买入|购买|卖出|赎回|调仓|基金|理财/.test(transcript) && !/开户|添加账户|新账户/.test(transcript)) {
    proposal.status = "unsupported";
    proposal.unresolved.push("当前真实账本尚未建立产品持仓交易模型，不能把买卖口述降级成普通账户余额");
    proposal.warnings.push("可先在流水页记录资金收支；持仓买卖将在产品事件模型完成后开放。");
    return proposal;
  }
  const accountPhrase = transcript
    .split(/[,，。；;]/, 1)[0]
    .replace(/^(?:请|帮我|我要|想要)*/, "")
    .replace(/^(?:添加|新增|新建)(?:一个|一张)?/, "");
  const institutionMatch = /([\u4e00-\u9fffA-Za-z0-9]{2,16}(?:银行|证券|保险|基金))/.exec(accountPhrase);
  const afterInstitution = institutionMatch
    ? accountPhrase.slice(institutionMatch.index + institutionMatch[0].length)
    : accountPhrase;
  const explicitDisplayMatch = /(?:叫|名称是|账户名(?:是)?)([\u4e00-\u9fffA-Za-z0-9-]{2,20}(?:账户|卡)?)/.exec(transcript);
  const trailingDisplayMatch = /^([\u4e00-\u9fffA-Za-z0-9-]{1,16})(账户|卡)/.exec(afterInstitution);
  const money = moneyEvidence(transcript);
  const date = dateEvidence(transcript, now);
  const institutionName = institutionMatch?.[1] ?? "";
  const displayName = explicitDisplayMatch?.[1]
    ?? (trailingDisplayMatch
      ? `${trailingDisplayMatch[1]}${trailingDisplayMatch[2]}`
      : institutionName
        ? `${institutionName.replace(/银行|证券|保险|基金/g, "")}账户`
        : "");
  const accountType = /基金/.test(transcript)
    ? "fund"
    : /保险/.test(transcript)
      ? "insurance"
      : /理财|投资|证券/.test(transcript)
        ? "investment"
        : /储蓄|定期/.test(transcript)
          ? "savings"
          : "cash";
  if (!institutionName) proposal.unresolved.push("未识别到机构名称");
  if (!displayName) proposal.unresolved.push("未识别到账户名称");
  proposal.fields = [
    field("institutionName", "机构", institutionName || "待补充", institutionName ? 0.9 : 0, true, institutionName ? "" : "必填"),
    field("displayName", "账户名称", displayName || "待补充", displayName ? 0.76 : 0, true, displayName ? "" : "必填"),
    field("accountType", "账户类型", accountType, 0.78),
    field("openingBalance", "期初余额", money?.amount ?? "0", money ? 0.94 : 0.65, false, money ? "" : "默认 0"),
    field("balanceDate", "余额日期", date.value, date.confidence, true, date.evidence ? "" : "默认今天"),
  ];
  proposal.evidence = [
    ...(institutionMatch ? [{
      field: "institutionName",
      text: institutionMatch[0],
      range: [institutionMatch.index, institutionMatch.index + institutionMatch[0].length],
    }] : []),
    ...(money ? [money.evidence] : []),
    ...(date.evidence ? [date.evidence] : []),
  ];
  if (!money) proposal.warnings.push("没有说期初余额，暂按 0 生成草稿。");
  if (!date.evidence) proposal.warnings.push("没有说余额日期，暂按今天生成草稿。");
  if (proposal.unresolved.length === 0) {
    proposal.status = "reviewable";
    proposal.confidence = money ? 0.84 : 0.74;
    proposal.draftRequest = {
      institutionName,
      displayName,
      accountType,
      currency: "CNY",
      maskedIdentifier: null,
      openingBalance: money?.amount ?? "0",
      balanceDate: date.value,
      notes: "由本地口述提案生成，确认前请核对原文与证据。",
    };
  }
  return proposal;
}

const PLANNING_CATEGORIES = Object.freeze([
  ["cash", "现金", ["现金", "活期"]],
  ["stable", "稳健", ["稳健", "固收", "债券"]],
  ["equity", "权益", ["权益", "股票", "基金"]],
  ["gold", "黄金", ["黄金", "贵金属"]],
  ["insurance", "保险", ["保险", "保障"]],
  ["other", "其他", ["其他", "另类"]],
]);

function planningPercentEvidence(transcript, aliases) {
  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `${escaped}\\s*(?:目标|配置|占比|为|是|到|调到|调整到)?\\s*(?:百分之\\s*)?([0-9]+(?:\\.[0-9]{1,2})?|[零〇一二两三四五六七八九十百]+)\\s*(?:%|％)?`,
    );
    const match = pattern.exec(transcript);
    if (!match) continue;
    const numeric = /^\d/.test(match[1])
      ? Number(match[1])
      : parseChineseInteger(match[1]);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return null;
    const bps = Math.round(numeric * 100);
    if (Math.abs(bps / 100 - numeric) > 0.0001) return null;
    return {
      bps,
      evidence: {
        field: "allocation",
        text: match[0],
        range: [match.index, match.index + match[0].length],
      },
    };
  }
  return null;
}

function planningProposal(transcript, context, currentPlanning) {
  const proposal = proposalBase(transcript, context, "planning");
  const currentByCategory = new Map(
    (currentPlanning?.allocations ?? []).map((allocation) => [
      allocation.category,
      Number(allocation.targetBps),
    ]),
  );
  const explicit = PLANNING_CATEGORIES.map(([category, label, aliases]) => ({
    category,
    label,
    parsed: planningPercentEvidence(transcript, aliases),
  }));
  const hasAllocationIntent = explicit.some((item) => item.parsed);
  const hasCashBufferIntent = /安全垫|备用金|应急金/.test(transcript);
  const cashBuffer = hasCashBufferIntent ? moneyEvidence(transcript) : null;
  if (!hasAllocationIntent && !hasCashBufferIntent) {
    proposal.status = "unsupported";
    proposal.unresolved.push("未识别到安全垫或资产配置目标");
    proposal.warnings.push("本次文字不会保存，也不会改变规划或余额。");
    return proposal;
  }
  if (hasCashBufferIntent && !cashBuffer) {
    proposal.unresolved.push("安全垫需要明确金额");
  }
  const allocations = explicit.map(({ category, label, parsed }) => {
    const targetBps = parsed?.bps ?? currentByCategory.get(category);
    if (!Number.isInteger(targetBps)) {
      proposal.unresolved.push(`首次设置规划时需要明确“${label}”目标`);
    }
    return { category, label, targetBps, parsed };
  });
  const totalBps = allocations.reduce(
    (sum, item) => sum + (Number.isInteger(item.targetBps) ? item.targetBps : 0),
    0,
  );
  if (allocations.every((item) => Number.isInteger(item.targetBps)) && totalBps !== 10_000) {
    proposal.unresolved.push(`六类配置目标合计必须为 100%，当前为 ${(totalBps / 100).toFixed(2)}%`);
  }
  const nextCashBuffer = cashBuffer?.amount
    ?? (Number.isInteger(currentPlanning?.cashBufferMinor)
      ? String(currentPlanning.cashBufferMinor / 100)
      : null);
  if (!nextCashBuffer) proposal.unresolved.push("首次设置规划时需要明确安全垫金额");
  proposal.fields = [
    field(
      "cashBuffer",
      "现金安全垫",
      nextCashBuffer ?? "待补充",
      cashBuffer ? 0.96 : currentPlanning ? 0.82 : 0,
      true,
      nextCashBuffer ? (cashBuffer ? "" : "沿用当前值") : "必填",
    ),
    ...allocations.map((item) => field(
      item.category,
      `${item.label}目标`,
      Number.isInteger(item.targetBps) ? `${item.targetBps / 100}%` : "待补充",
      item.parsed ? 0.94 : currentPlanning ? 0.82 : 0,
      true,
      item.parsed ? "" : currentPlanning ? "沿用当前值" : "必填",
    )),
  ];
  proposal.evidence = [
    ...(cashBuffer ? [cashBuffer.evidence] : []),
    ...allocations.flatMap((item) => item.parsed ? [item.parsed.evidence] : []),
  ];
  proposal.warnings.push("规划目标只用于分析和模拟，不会自动调仓或修改真实余额。");
  if (proposal.unresolved.length === 0) {
    proposal.status = "reviewable";
    proposal.confidence = hasAllocationIntent && cashBuffer ? 0.94 : 0.86;
    proposal.draftRequest = {
      name: currentPlanning?.name ?? "长期资产规划",
      cashBuffer: nextCashBuffer,
      allocations: allocations.map(({ category, targetBps }) => ({ category, targetBps })),
      notes: currentPlanning?.notes ?? "由本地口述提案生成；规划模拟与真实账本严格分离。",
    };
  }
  return proposal;
}

export function parseLocalProposal({
  transcript: rawTranscript,
  context = "overview",
  accounts = [],
  holdings = [],
  planning = null,
  now = new Date(),
  intentHint = null,
}) {
  const transcript = normalizeTranscript(rawTranscript);
  if (!transcript) {
    const proposal = proposalBase("", context, "transaction");
    proposal.unresolved.push("请输入一段口述稿");
    return proposal;
  }
  if (context === "planning") {
    return planningProposal(transcript, context, planning);
  }
  if (["settings", "sources"].includes(context)) {
    const proposal = proposalBase(transcript, context, "transaction");
    proposal.status = "unsupported";
    proposal.unresolved.push("这个模块的真实可写领域模型尚未完成");
    proposal.warnings.push("本次文字不会保存，也不会改变规划、设置或余额。");
    return proposal;
  }
  const supportedIntentHints = [
    "transaction",
    "account",
    "holding_operation",
    "reminder",
    "planning",
    "unsupported",
  ];
  const normalizedIntentHint = supportedIntentHints.includes(intentHint) ? intentHint : null;
  if (normalizedIntentHint === "unsupported") {
    const proposal = proposalBase(transcript, context, "transaction");
    proposal.status = "unsupported";
    proposal.unresolved.push("Codex 没有识别到可写入的财务信息");
    proposal.warnings.push("本次输入不会生成草稿或改变余额。");
    return proposal;
  }
  const reminderIntent = /提醒|到期|续保|续缴|还款日|缴费日/.test(transcript);
  const accountIntent = /开户|添加.{0,24}账户|新(?:建|增)?.{0,20}账户/.test(transcript);
  if (context === "reminders" || reminderIntent) {
    return reminderProposal(transcript, context, accounts, now);
  }
  if (normalizedIntentHint === "transaction") {
    return transactionProposal(transcript, context, accounts, now);
  }
  if (normalizedIntentHint === "account") {
    return accountProposal(transcript, context, now);
  }
  if (normalizedIntentHint === "holding_operation") {
    return holdingOperationProposal(transcript, context, accounts, holdings, now);
  }
  if (normalizedIntentHint === "reminder") {
    return reminderProposal(transcript, context, accounts, now);
  }
  if (normalizedIntentHint === "planning") {
    return planningProposal(transcript, context, planning);
  }
  if (accountIntent && (context === "assets" || accounts.length === 0)) {
    return accountProposal(transcript, context, now);
  }
  if (
    context === "assets"
    && /申购|买入|购买|买了|赎回|卖出|卖了|分红|派息|手续费|管理费|产品费用|收取费用|调仓/.test(transcript)
  ) {
    return holdingOperationProposal(transcript, context, accounts, holdings, now);
  }
  if (context === "assets" && /基金|理财|持仓/.test(transcript)) {
    return accountProposal(transcript, context, now);
  }
  return transactionProposal(transcript, context, accounts, now);
}

export function proposalConfidenceBps(proposal) {
  const confidence = Number(proposal?.confidence ?? 0);
  return Number.isFinite(confidence)
    ? Math.max(0, Math.min(10_000, Math.round(confidence * 10_000)))
    : 0;
}
