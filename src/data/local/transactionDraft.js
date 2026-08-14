import { todayForDateInput } from "./accountDraft.js";

export const TRANSACTION_KIND_OPTIONS = Object.freeze([
  { value: "income", label: "收入" },
  { value: "expense", label: "支出" },
  { value: "transfer", label: "转账" },
]);

export const TRANSACTION_CATEGORIES = Object.freeze({
  income: ["工资", "租金", "理财收益", "报销", "其他收入"],
  expense: ["餐饮", "居住", "交通", "保险", "教育", "购物", "其他支出"],
  transfer: ["账户调拨"],
});

const MAX_SAFE_MINOR = 9_000_000_000_000_000n;

export function createEmptyTransactionForm(accounts = [], now) {
  return {
    transactionKind: "expense",
    accountId: accounts[0]?.id ?? "",
    destinationAccountId: accounts[1]?.id ?? "",
    amount: "",
    occurredOn: todayForDateInput(now),
    description: "",
    category: TRANSACTION_CATEGORIES.expense[0],
    notes: "",
  };
}

export function createTransactionFormFromTransaction(transaction, accounts = []) {
  const amountMinor = Number(transaction?.amountMinor ?? 0);
  const amount = Number.isSafeInteger(amountMinor)
    ? `${Math.trunc(amountMinor / 100)}.${String(Math.abs(amountMinor % 100)).padStart(2, "0")}`
    : "";
  const fallback = createEmptyTransactionForm(accounts);
  return {
    transactionKind: transaction?.kind ?? fallback.transactionKind,
    accountId: transaction?.accountId ?? fallback.accountId,
    destinationAccountId: transaction?.destinationAccountId ?? "",
    amount,
    occurredOn: transaction?.occurredAt?.slice(0, 10) ?? fallback.occurredOn,
    description: transaction?.description ?? "",
    category: transaction?.category
      ?? TRANSACTION_CATEGORIES[transaction?.kind ?? fallback.transactionKind]?.[0]
      ?? "",
    notes: transaction?.notes ?? "",
  };
}

function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parsePositiveMinor(value) {
  const normalized = value?.trim() ?? "";
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [major, fraction = ""] = normalized.split(".");
  const minor = BigInt(major) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (minor <= 0n || minor > MAX_SAFE_MINOR) return null;
  return minor;
}

export function validateTransactionForm(form, accounts = []) {
  if (!TRANSACTION_KIND_OPTIONS.some((option) => option.value === form?.transactionKind)) {
    return "请选择有效的流水类型";
  }
  const account = accounts.find((item) => item.id === form.accountId);
  if (!account) return "请选择有效的账户";
  if (form.transactionKind === "transfer") {
    const destination = accounts.find((item) => item.id === form.destinationAccountId);
    if (!destination) return "请选择有效的转入账户";
    if (destination.id === account.id) return "转出与转入账户不能相同";
    if (destination.currency !== account.currency) {
      return "跨币种转账需要单独的汇率核对流程";
    }
  }
  if (!parsePositiveMinor(form.amount)) return "金额必须大于 0，且最多保留两位小数";
  if (!isRealDate(form.occurredOn)) return "请选择有效的流水日期";
  if (!form.description?.trim()) return "请填写流水说明";
  if (form.description.trim().length > 120) return "流水说明不能超过 120 个字符";
  if ((form.category ?? "").trim().length > 60) return "分类不能超过 60 个字符";
  if ((form.notes ?? "").trim().length > 1000) return "备注不能超过 1000 个字符";
  return "";
}

export function toTransactionDraftInput(form, accounts = []) {
  const issue = validateTransactionForm(form, accounts);
  if (issue) throw new TypeError(issue);
  return {
    transactionKind: form.transactionKind,
    accountId: form.accountId,
    destinationAccountId: form.transactionKind === "transfer"
      ? form.destinationAccountId
      : null,
    amount: form.amount.trim(),
    occurredOn: form.occurredOn,
    description: form.description.trim(),
    category: form.category?.trim() || null,
    notes: form.notes?.trim() || null,
  };
}

export function validateTransactionCorrection(correctionKind, reason, form, accounts = []) {
  if (correctionKind !== "reverse" && correctionKind !== "revise") {
    return "请选择冲销或修订操作";
  }
  const normalizedReason = reason?.trim() ?? "";
  if (!normalizedReason) return "请填写冲销或修订原因";
  if (normalizedReason.length > 240) return "修正原因不能超过 240 个字符";
  if (correctionKind === "revise") {
    return validateTransactionForm(form, accounts);
  }
  return "";
}

export function toTransactionCorrectionDraftInput({
  transactionId,
  correctionKind,
  reason,
  form,
  accounts = [],
}) {
  const issue = validateTransactionCorrection(correctionKind, reason, form, accounts);
  if (issue) throw new TypeError(issue);
  return {
    transactionId,
    correctionKind,
    reason: reason.trim(),
    replacement: correctionKind === "revise"
      ? toTransactionDraftInput(form, accounts)
      : null,
  };
}

export function transactionKindLabel(value) {
  return TRANSACTION_KIND_OPTIONS.find((option) => option.value === value)?.label ?? "流水";
}

export function formatTransactionAmount(kind, minor, currency = "CNY") {
  const amount = Number(minor);
  if (!Number.isSafeInteger(amount)) return "金额超出显示范围";
  const formatted = new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount / 100);
  if (kind === "income") return `+${formatted}`;
  if (kind === "expense") return `-${formatted}`;
  return formatted;
}

export function presentTransactionError(error) {
  const message = typeof error === "string" ? error : error?.message;
  if (!message) return "流水操作失败，请稍后重试";
  if (/Explicit user confirmation/i.test(message)) {
    return "必须明确确认后才能写入真实账本";
  }
  if (/Cross-currency transfers/i.test(message)) {
    return "跨币种转账需要单独核对汇率，当前版本不会自动换算";
  }
  if (/Transfer accounts must be different/i.test(message)) {
    return "转出与转入账户不能相同";
  }
  if (/does not exist or is archived/i.test(message)) {
    return "账户不存在或已归档，请刷新后重试";
  }
  if (/Amount/i.test(message)) {
    return "金额格式不正确，请输入大于 0 且最多两位小数的金额";
  }
  if (/Transaction date/i.test(message)) {
    return "流水日期无效，请检查后重试";
  }
  if (/already been reversed or revised/i.test(message)) {
    return "这笔流水已经冲销或修订，不能重复操作";
  }
  if (/Holding-linked transactions/i.test(message)) {
    return "这笔流水由产品操作生成，不能单独冲销；请在对应持仓中记录反向产品操作";
  }
  if (/original transaction changed after review/i.test(message)) {
    return "原流水在核对后发生变化，请重新打开并核对";
  }
  if (/archived account cannot be corrected/i.test(message)) {
    return "已归档账户上的流水不能修正";
  }
  if (/Correction reason/i.test(message)) {
    return "请填写冲销或修订原因";
  }
  return message;
}
