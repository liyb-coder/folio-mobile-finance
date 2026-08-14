import { todayForDateInput } from "./accountDraft.js";

export const REMINDER_CATEGORIES = Object.freeze([
  { value: "rent", label: "租金" },
  { value: "insurance", label: "保险" },
  { value: "maturity", label: "理财到期" },
  { value: "repayment", label: "还款" },
  { value: "investment", label: "定投" },
  { value: "idle_cash", label: "闲置资金" },
  { value: "custom", label: "自定义" },
]);

export const REMINDER_RECURRENCES = Object.freeze([
  { value: "none", label: "不重复" },
  { value: "monthly", label: "每月" },
  { value: "yearly", label: "每年" },
]);

const MAX_SAFE_MINOR = 9_000_000_000_000_000n;

function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseOptionalPositiveMinor(value) {
  const normalized = value?.trim() ?? "";
  if (!normalized) return 0n;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [major, fraction = ""] = normalized.split(".");
  const minor = BigInt(major) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (minor <= 0n || minor > MAX_SAFE_MINOR) return null;
  return minor;
}

export function createReminderForm(reminder = null, now) {
  return {
    title: reminder?.title ?? "",
    category: reminder?.category ?? REMINDER_CATEGORIES[0].value,
    linkedAccountId: reminder?.linkedAccountId ?? "",
    amount: reminder?.amountMinor == null
      ? ""
      : (Number(reminder.amountMinor) / 100).toFixed(2),
    dueOn: reminder?.dueOn ?? todayForDateInput(now),
    advanceDays: String(reminder?.advanceDays ?? 3),
    recurrenceRule: reminder?.recurrenceRule ?? "none",
    notes: reminder?.notes ?? "",
  };
}

export function validateReminderForm(form, accounts = []) {
  if (!form?.title?.trim()) return "请填写事项标题";
  if (form.title.trim().length > 120) return "事项标题不能超过 120 个字符";
  if (!REMINDER_CATEGORIES.some((item) => item.value === form.category)) {
    return "请选择有效的事项类型";
  }
  if (form.linkedAccountId && !accounts.some((item) => item.id === form.linkedAccountId)) {
    return "请选择有效的关联账户";
  }
  if (parseOptionalPositiveMinor(form.amount) === null) {
    return "金额留空或输入大于 0、最多两位小数的数字";
  }
  if (!isRealDate(form.dueOn)) return "请选择有效的关注日期";
  if (!/^\d+$/.test(String(form.advanceDays))) return "提前提醒天数必须是整数";
  const advanceDays = Number(form.advanceDays);
  if (!Number.isSafeInteger(advanceDays) || advanceDays < 0 || advanceDays > 3650) {
    return "提前提醒天数必须在 0 到 3650 之间";
  }
  if (!REMINDER_RECURRENCES.some((item) => item.value === form.recurrenceRule)) {
    return "请选择有效的重复规则";
  }
  if ((form.notes ?? "").trim().length > 1000) return "备注不能超过 1000 个字符";
  return "";
}

export function toReminderDraftInput(form, accounts = []) {
  const issue = validateReminderForm(form, accounts);
  if (issue) throw new TypeError(issue);
  return {
    title: form.title.trim(),
    category: form.category,
    linkedAccountId: form.linkedAccountId || null,
    amount: form.amount?.trim() || null,
    dueOn: form.dueOn,
    advanceDays: Number(form.advanceDays),
    recurrenceRule: form.recurrenceRule === "none" ? null : form.recurrenceRule,
    notes: form.notes?.trim() || null,
  };
}

export function toReminderUpdateDraftInput(reminderId, form, accounts = []) {
  return {
    reminderId,
    ...toReminderDraftInput(form, accounts),
  };
}

export function reminderCategoryLabel(value) {
  return REMINDER_CATEGORIES.find((item) => item.value === value)?.label ?? "事项";
}

export function reminderRecurrenceLabel(value) {
  return REMINDER_RECURRENCES.find((item) => item.value === (value ?? "none"))?.label ?? "不重复";
}

export function reminderStatusLabel(value) {
  return {
    active: "待处理",
    snoozed: "已稍后",
    completed: "已完成",
    ignored: "已忽略",
  }[value] ?? "未知状态";
}

export function formatReminderAmount(minor, currency = "CNY") {
  if (minor == null) return "未设置金额";
  const amount = Number(minor);
  if (!Number.isSafeInteger(amount)) return "金额超出显示范围";
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount / 100);
}

export function presentReminderError(error) {
  const message = typeof error === "string" ? error : error?.message;
  if (!message) return "事项操作失败，请稍后重试";
  if (/Explicit user confirmation/i.test(message)) return "必须明确确认后才能保存事项";
  if (/changed after review/i.test(message)) return "事项在核对后发生变化，请重新打开并核对";
  if (/archived/i.test(message)) return "事项已经归档，无法继续修改";
  if (/Only an active reminder/i.test(message)) return "只有待处理事项可以编辑或完成";
  if (/linked reminder account/i.test(message)) return "关联账户不存在或已归档";
  if (/Amount/i.test(message)) return "金额格式不正确，请留空或输入大于 0 且最多两位小数的金额";
  if (/Reminder date/i.test(message)) return "关注日期无效，请检查后重试";
  return message;
}
