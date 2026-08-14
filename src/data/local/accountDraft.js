export const ACCOUNT_TYPE_OPTIONS = Object.freeze([
  { value: "cash", label: "活期账户" },
  { value: "savings", label: "储蓄账户" },
  { value: "investment", label: "理财账户" },
  { value: "fund", label: "基金账户" },
  { value: "insurance", label: "保险账户" },
  { value: "property", label: "房产" },
  { value: "liability", label: "负债账户" },
  { value: "other", label: "其他" },
]);

const SUPPORTED_CURRENCIES = new Set(["CNY", "USD", "HKD"]);

export function todayForDateInput(now = new Date()) {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function createEmptyAccountForm(now) {
  return {
    institutionName: "",
    displayName: "",
    accountType: "cash",
    currency: "CNY",
    maskedIdentifier: "",
    openingBalance: "0.00",
    balanceDate: todayForDateInput(now),
    notes: "",
  };
}

export function createAccountProfileForm(account) {
  return {
    institutionName: account?.institutionName ?? "",
    displayName: account?.displayName ?? "",
    accountType: account?.accountType ?? "cash",
    currency: account?.currency ?? "CNY",
    maskedIdentifier: account?.maskedIdentifier ?? "",
    notes: account?.notes ?? "",
  };
}

function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateAccountForm(form) {
  if (!form?.institutionName?.trim()) return "请填写机构名称";
  if (form.institutionName.trim().length > 80) return "机构名称不能超过 80 个字符";
  if (!form?.displayName?.trim()) return "请填写账户名称";
  if (form.displayName.trim().length > 80) return "账户名称不能超过 80 个字符";
  if (!ACCOUNT_TYPE_OPTIONS.some((option) => option.value === form.accountType)) {
    return "请选择有效的账户类型";
  }
  if (!SUPPORTED_CURRENCIES.has(form.currency)) return "请选择支持的币种";
  if (
    form.maskedIdentifier
    && (!/^[A-Za-z0-9-]{1,8}$/.test(form.maskedIdentifier.trim()))
  ) {
    return "账户尾号最多 8 位，只能包含字母、数字或连字符";
  }
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(form.openingBalance?.trim() ?? "")) {
    return "期初余额需为最多两位小数的数字";
  }
  if (!isRealDate(form.balanceDate)) return "请选择有效的余额日期";
  if ((form.notes ?? "").trim().length > 1000) return "备注不能超过 1000 个字符";
  return "";
}

export function validateAccountProfileForm(form) {
  if (!form?.institutionName?.trim()) return "请填写机构名称";
  if (form.institutionName.trim().length > 80) return "机构名称不能超过 80 个字符";
  if (!form?.displayName?.trim()) return "请填写账户名称";
  if (form.displayName.trim().length > 80) return "账户名称不能超过 80 个字符";
  if (!ACCOUNT_TYPE_OPTIONS.some((option) => option.value === form.accountType)) {
    return "请选择有效的账户类型";
  }
  if (!SUPPORTED_CURRENCIES.has(form.currency)) return "账户币种无效";
  if (
    form.maskedIdentifier
    && (!/^[A-Za-z0-9-]{1,8}$/.test(form.maskedIdentifier.trim()))
  ) {
    return "账户尾号最多 8 位，只能包含字母、数字或连字符";
  }
  if ((form.notes ?? "").trim().length > 1000) return "备注不能超过 1000 个字符";
  return "";
}

export function toAccountDraftInput(form) {
  const issue = validateAccountForm(form);
  if (issue) throw new TypeError(issue);
  return {
    institutionName: form.institutionName.trim(),
    displayName: form.displayName.trim(),
    accountType: form.accountType,
    currency: form.currency,
    maskedIdentifier: form.maskedIdentifier.trim() || null,
    openingBalance: form.openingBalance.trim(),
    balanceDate: form.balanceDate,
    notes: form.notes.trim() || null,
  };
}

export function toAccountUpdateDraftInput(accountId, form) {
  const issue = validateAccountProfileForm(form);
  if (issue) throw new TypeError(issue);
  if (!accountId?.trim()) throw new TypeError("账户标识无效");
  return {
    accountId: accountId.trim(),
    institutionName: form.institutionName.trim(),
    displayName: form.displayName.trim(),
    accountType: form.accountType,
    maskedIdentifier: form.maskedIdentifier.trim() || null,
    notes: form.notes.trim() || null,
  };
}

export function accountTypeLabel(value) {
  return ACCOUNT_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? "其他";
}

export function formatMinorAmount(minor, currency = "CNY") {
  const value = Number(minor);
  if (!Number.isSafeInteger(value)) return "金额超出显示范围";
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value / 100);
}

export function presentAccountError(error) {
  const message = typeof error === "string" ? error : error?.message;
  if (!message) return "账户操作失败，请稍后重试";
  if (/(?:same|this) institution and name already exists/i.test(message)) {
    return "同一机构下已存在同名账户";
  }
  if (/Vault is locked/i.test(message)) {
    return "应用已锁定，请重新解锁后再试";
  }
  if (/Opening balance/i.test(message)) {
    return "期初余额格式不正确，请检查后重试";
  }
  if (/Balance date/i.test(message)) {
    return "余额日期无效，请检查后重试";
  }
  if (/Explicit user confirmation/i.test(message)) {
    return "必须明确确认后才能写入真实账本";
  }
  if (/non-zero account cannot be archived/i.test(message)) {
    return "账户仍有余额，请先通过转账或结清流水把余额处理为 0";
  }
  if (/account with active holdings cannot be archived/i.test(message)) {
    return "账户仍有有效持仓，请先在资产页归档这些持仓";
  }
  if (/No account changes were provided/i.test(message)) {
    return "账户信息没有变化";
  }
  if (/changed after review/i.test(message)) {
    return "账户在核对后发生变化，请重新生成核对草稿";
  }
  if (/does not exist or is already archived/i.test(message)) {
    return "账户不存在或已归档";
  }
  return message;
}
