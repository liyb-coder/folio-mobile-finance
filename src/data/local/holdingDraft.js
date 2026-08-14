import { todayForDateInput } from "./accountDraft.js";

export const HOLDING_TYPE_OPTIONS = Object.freeze([
  { value: "cash_management", label: "现金管理" },
  { value: "fixed_income", label: "固收理财" },
  { value: "fund", label: "基金" },
  { value: "security", label: "股票/证券" },
  { value: "insurance", label: "保险" },
  { value: "other", label: "其他" },
]);

function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isMoney(value) {
  return /^\d+(?:\.\d{1,2})?$/.test(value?.trim() ?? "");
}

function isUnits(value) {
  return /^\d+(?:\.\d{1,6})?$/.test(value?.trim() ?? "");
}

export function formatUnitsMicros(value) {
  if (!Number.isSafeInteger(value) || value < 0) return "数量超出显示范围";
  const major = Math.floor(value / 1_000_000);
  const fraction = String(value % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${major}.${fraction}` : String(major);
}

export function holdingTypeLabel(value) {
  return HOLDING_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? "其他";
}

export function createEmptyHoldingForm(accounts = [], now = new Date()) {
  const account = accounts[0] ?? null;
  return {
    accountId: account?.id ?? "",
    name: "",
    productType: "fund",
    currency: account?.currency ?? "CNY",
    maskedIdentifier: "",
    units: "0",
    costBasis: "0.00",
    marketValue: "0.00",
    asOfDate: todayForDateInput(now),
    notes: "",
  };
}

export function createHoldingValuationForm(holding, now = new Date()) {
  return {
    holdingId: holding?.id ?? "",
    units: formatUnitsMicros(holding?.unitsMicros ?? 0),
    costBasis: Number.isSafeInteger(holding?.costBasisMinor)
      ? (holding.costBasisMinor / 100).toFixed(2)
      : "0.00",
    marketValue: Number.isSafeInteger(holding?.marketValueMinor)
      ? (holding.marketValueMinor / 100).toFixed(2)
      : "0.00",
    asOfDate: todayForDateInput(now),
  };
}

export function createHoldingProfileForm(holding) {
  return {
    holdingId: holding?.id ?? "",
    name: holding?.name ?? "",
    productType: holding?.productType ?? "other",
    maskedIdentifier: holding?.maskedIdentifier ?? "",
    notes: holding?.notes ?? "",
  };
}

export function validateHoldingProfileForm(form) {
  if (!form?.holdingId?.trim()) return "持仓标识无效";
  if (!form.name?.trim()) return "请填写产品名称";
  if (form.name.trim().length > 120) return "产品名称不能超过 120 个字符";
  if (!HOLDING_TYPE_OPTIONS.some((option) => option.value === form.productType)) {
    return "请选择有效的产品类型";
  }
  if (
    form.maskedIdentifier
    && !/^[A-Za-z0-9-]{1,16}$/.test(form.maskedIdentifier.trim())
  ) {
    return "产品尾号最多 16 位，只能包含字母、数字或连字符";
  }
  if ((form.notes ?? "").trim().length > 1000) return "备注不能超过 1000 个字符";
  return "";
}

export function validateHoldingForm(form, accounts = []) {
  const account = accounts.find((item) => item.id === form?.accountId);
  if (!account) return "请选择有效的所属账户";
  if (!form?.name?.trim()) return "请填写产品名称";
  if (form.name.trim().length > 120) return "产品名称不能超过 120 个字符";
  if (!HOLDING_TYPE_OPTIONS.some((option) => option.value === form.productType)) {
    return "请选择有效的产品类型";
  }
  if (form.currency !== account.currency) return "持仓币种必须与所属账户一致";
  if (
    form.maskedIdentifier
    && !/^[A-Za-z0-9-]{1,16}$/.test(form.maskedIdentifier.trim())
  ) {
    return "产品尾号最多 16 位，只能包含字母、数字或连字符";
  }
  if (!isUnits(form.units)) return "持有数量需为非负数字，最多保留六位小数";
  if (!isMoney(form.costBasis)) return "累计成本需为非负金额，最多保留两位小数";
  if (!isMoney(form.marketValue)) return "当前市值需为非负金额，最多保留两位小数";
  if (!isRealDate(form.asOfDate)) return "请选择有效的估值日期";
  if ((form.notes ?? "").trim().length > 1000) return "备注不能超过 1000 个字符";
  return "";
}

export function validateHoldingValuationForm(form) {
  if (!form?.holdingId?.trim()) return "持仓标识无效";
  if (!isUnits(form.units)) return "持有数量需为非负数字，最多保留六位小数";
  if (!isMoney(form.costBasis)) return "累计成本需为非负金额，最多保留两位小数";
  if (!isMoney(form.marketValue)) return "当前市值需为非负金额，最多保留两位小数";
  if (!isRealDate(form.asOfDate)) return "请选择有效的估值日期";
  return "";
}

export function toHoldingDraftInput(form, accounts = []) {
  const issue = validateHoldingForm(form, accounts);
  if (issue) throw new TypeError(issue);
  return {
    accountId: form.accountId,
    name: form.name.trim(),
    productType: form.productType,
    currency: form.currency,
    maskedIdentifier: form.maskedIdentifier.trim() || null,
    units: form.units.trim(),
    costBasis: form.costBasis.trim(),
    marketValue: form.marketValue.trim(),
    asOfDate: form.asOfDate,
    notes: form.notes.trim() || null,
  };
}

export function toHoldingValuationDraftInput(form) {
  const issue = validateHoldingValuationForm(form);
  if (issue) throw new TypeError(issue);
  return {
    holdingId: form.holdingId.trim(),
    units: form.units.trim(),
    costBasis: form.costBasis.trim(),
    marketValue: form.marketValue.trim(),
    asOfDate: form.asOfDate,
  };
}

export function toHoldingUpdateDraftInput(form) {
  const issue = validateHoldingProfileForm(form);
  if (issue) throw new TypeError(issue);
  return {
    holdingId: form.holdingId.trim(),
    name: form.name.trim(),
    productType: form.productType,
    maskedIdentifier: form.maskedIdentifier.trim() || null,
    notes: form.notes.trim() || null,
  };
}

export function toHoldingArchiveDraftInput(holdingId) {
  if (!holdingId?.trim()) throw new TypeError("持仓标识无效");
  return { holdingId: holdingId.trim() };
}

export function presentHoldingError(error) {
  const message = typeof error === "string" ? error : error?.message;
  if (!message) return "持仓操作失败，请稍后重试";
  if (/same account and name already exists/i.test(message)) {
    return "该账户下已存在同名持仓";
  }
  if (/currency must match/i.test(message)) {
    return "持仓币种必须与所属账户一致";
  }
  if (/changed after review/i.test(message)) {
    return "持仓在核对后发生变化，请重新生成核对草稿";
  }
  if (/No holding profile changes were provided/i.test(message)) {
    return "持仓资料没有变化";
  }
  if (/does not exist or is archived/i.test(message)) {
    return "持仓不存在或已归档";
  }
  if (/Vault is locked/i.test(message)) return "应用已锁定，请重新解锁后再试";
  if (/Explicit user confirmation/i.test(message)) {
    return "必须明确确认后才能保存持仓";
  }
  return message;
}
