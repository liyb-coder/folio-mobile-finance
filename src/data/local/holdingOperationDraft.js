import { todayForDateInput } from "./accountDraft.js";
import { formatUnitsMicros } from "./holdingDraft.js";

export const HOLDING_OPERATION_OPTIONS = Object.freeze([
  { value: "purchase", label: "申购" },
  { value: "redeem", label: "赎回" },
  { value: "dividend", label: "分红" },
  { value: "fee", label: "费用" },
]);

const DEFAULT_DESCRIPTIONS = Object.freeze({
  purchase: "产品申购",
  redeem: "产品赎回",
  dividend: "产品分红",
  fee: "产品费用",
});

function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseFixed(value, decimals) {
  const normalized = value?.trim() ?? "";
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(normalized)) return null;
  const [major, fraction = ""] = normalized.split(".");
  return BigInt(major) * (10n ** BigInt(decimals))
    + BigInt(fraction.padEnd(decimals, "0") || "0");
}

function formatMoneyMinor(value) {
  return Number.isSafeInteger(value) ? (value / 100).toFixed(2) : "0.00";
}

export function holdingOperationLabel(kind) {
  return HOLDING_OPERATION_OPTIONS.find((option) => option.value === kind)?.label ?? "产品操作";
}

export function holdingOperationDefaultDescription(kind) {
  return DEFAULT_DESCRIPTIONS[kind] ?? "产品操作";
}

export function createHoldingOperationForm(holding, accounts = [], now = new Date()) {
  const sameCurrencyAccounts = accounts.filter((account) => (
    account.currency === holding?.currency && !account.archivedAt
  ));
  return {
    holdingId: holding?.id ?? "",
    operationKind: "purchase",
    settlementAccountId: "",
    amount: "",
    occurredOn: todayForDateInput(now),
    description: DEFAULT_DESCRIPTIONS.purchase,
    notes: "",
    resultingUnits: formatUnitsMicros(holding?.unitsMicros ?? 0),
    resultingCostBasis: formatMoneyMinor(holding?.costBasisMinor),
    resultingMarketValue: formatMoneyMinor(holding?.marketValueMinor),
    valuationDate: todayForDateInput(now),
    availableSettlementAccounts: sameCurrencyAccounts,
  };
}

export function changeHoldingOperationKind(form, operationKind, holding) {
  const affectsPosition = operationKind === "purchase" || operationKind === "redeem";
  return {
    ...form,
    operationKind,
    description: DEFAULT_DESCRIPTIONS[operationKind] ?? form.description,
    settlementAccountId: affectsPosition ? "" : holding?.accountId ?? "",
    resultingUnits: affectsPosition
      ? formatUnitsMicros(holding?.unitsMicros ?? 0)
      : "",
    resultingCostBasis: affectsPosition
      ? formatMoneyMinor(holding?.costBasisMinor)
      : "",
    resultingMarketValue: affectsPosition
      ? formatMoneyMinor(holding?.marketValueMinor)
      : "",
    valuationDate: affectsPosition ? form.valuationDate : "",
  };
}

export function validateHoldingOperationForm(form, holding, accounts = []) {
  if (!holding || holding.archivedAt || form?.holdingId !== holding.id) return "持仓不存在或已归档";
  if (!HOLDING_OPERATION_OPTIONS.some((option) => option.value === form.operationKind)) {
    return "请选择有效的产品操作类型";
  }
  const amountMinor = parseFixed(form.amount, 2);
  if (amountMinor == null || amountMinor <= 0n) return "操作金额需大于 0，最多保留两位小数";
  if (!isRealDate(form.occurredOn)) return "请选择有效的操作日期";
  if (!form.description?.trim()) return "请填写操作说明";
  if (form.description.trim().length > 120) return "操作说明不能超过 120 个字符";
  if ((form.notes ?? "").trim().length > 1000) return "备注不能超过 1000 个字符";

  if (form.settlementAccountId) {
    const settlement = accounts.find((account) => account.id === form.settlementAccountId);
    if (!settlement || settlement.archivedAt) return "请选择有效的结算账户";
    if (settlement.currency !== holding.currency) return "结算账户币种必须与持仓一致";
  } else if (form.operationKind === "dividend" || form.operationKind === "fee") {
    return "请选择分红或费用的结算账户";
  }

  if (form.operationKind === "purchase" || form.operationKind === "redeem") {
    const units = parseFixed(form.resultingUnits, 6);
    const cost = parseFixed(form.resultingCostBasis, 2);
    const market = parseFixed(form.resultingMarketValue, 2);
    if (units == null) return "操作后数量需为非负数字，最多保留六位小数";
    if (cost == null) return "操作后累计成本需为非负金额，最多保留两位小数";
    if (market == null) return "操作后市值需为非负金额，最多保留两位小数";
    if (!isRealDate(form.valuationDate)) return "请选择有效的操作后估值日期";
    const beforeUnits = BigInt(holding.unitsMicros ?? 0);
    const beforeCost = BigInt(holding.costBasisMinor ?? 0);
    if (form.operationKind === "purchase" && (units <= beforeUnits || cost < beforeCost)) {
      return "申购后数量必须增加，累计成本不能减少";
    }
    if (form.operationKind === "redeem" && (units >= beforeUnits || cost > beforeCost)) {
      return "赎回后数量必须减少，累计成本不能增加";
    }
    if (form.operationKind === "redeem" && units === 0n && cost !== 0n) {
      return "全部赎回后累计成本必须为 0";
    }
  }
  return "";
}

export function toHoldingOperationDraftInput(form, holding, accounts = []) {
  const issue = validateHoldingOperationForm(form, holding, accounts);
  if (issue) throw new TypeError(issue);
  const affectsPosition = form.operationKind === "purchase" || form.operationKind === "redeem";
  return {
    holdingId: form.holdingId,
    operationKind: form.operationKind,
    settlementAccountId: form.settlementAccountId || null,
    amount: form.amount.trim(),
    occurredOn: form.occurredOn,
    description: form.description.trim(),
    notes: form.notes.trim() || null,
    resultingUnits: affectsPosition ? form.resultingUnits.trim() : null,
    resultingCostBasis: affectsPosition ? form.resultingCostBasis.trim() : null,
    resultingMarketValue: affectsPosition ? form.resultingMarketValue.trim() : null,
    valuationDate: affectsPosition ? form.valuationDate : null,
  };
}

export function presentHoldingOperationError(error) {
  const message = typeof error === "string" ? error : error?.message;
  if (!message) return "产品操作失败，请稍后重试";
  if (/changed after review|latest valuation/i.test(message)) return "持仓估值在核对后发生变化，请重新生成操作草稿";
  if (/settlement currency must match/i.test(message)) return "结算账户币种必须与持仓一致";
  if (/purchase must increase/i.test(message)) return "申购后数量必须增加，累计成本不能减少";
  if (/redemption must reduce/i.test(message)) return "赎回后数量必须减少，累计成本不能增加";
  if (/Vault is locked/i.test(message)) return "应用已锁定，请重新解锁后再试";
  if (/Explicit user confirmation/i.test(message)) return "必须明确确认后才能写入产品操作";
  if (/already been corrected/i.test(message)) return "这条产品操作已经冲销，不能重复处理";
  if (/Only the latest position-changing/i.test(message)) {
    return "该操作之后已有新的持仓估值；为避免覆盖后续历史，当前不能直接冲销";
  }
  if (/changed after correction review/i.test(message)) {
    return "持仓或关联流水在核对后发生变化，请重新生成冲销草稿";
  }
  return message;
}

export function createHoldingOperationCorrectionForm(operation, now = new Date()) {
  return {
    operationId: operation?.id ?? "",
    reason: "",
    occurredOn: todayForDateInput(now),
  };
}

export function validateHoldingOperationCorrectionForm(form, operation) {
  if (!operation?.id || form?.operationId !== operation.id) return "产品操作标识无效";
  if (operation.reversed || operation.isReversal) return "该产品操作不能重复冲销";
  if (!form.reason?.trim()) return "请填写冲销原因";
  if (form.reason.trim().length > 240) return "冲销原因不能超过 240 个字符";
  if (!isRealDate(form.occurredOn)) return "请选择有效的冲销日期";
  return "";
}

export function toHoldingOperationCorrectionDraftInput(form, operation) {
  const issue = validateHoldingOperationCorrectionForm(form, operation);
  if (issue) throw new TypeError(issue);
  return {
    operationId: operation.id,
    reason: form.reason.trim(),
    occurredOn: form.occurredOn,
  };
}
