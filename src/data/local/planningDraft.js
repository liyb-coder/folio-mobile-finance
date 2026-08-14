export const PLANNING_ALLOCATIONS = Object.freeze([
  { category: "cash", label: "现金", color: "#c9f66f" },
  { category: "stable", label: "稳健", color: "#9789c8" },
  { category: "equity", label: "权益", color: "#514c67" },
  { category: "gold", label: "黄金", color: "#d7bd72" },
  { category: "insurance", label: "保险", color: "#8bb6a5" },
  { category: "other", label: "其他", color: "#aaa6b5" },
]);

export function createPlanningForm(planning) {
  const current = new Map(
    (planning?.allocations ?? []).map((item) => [item.category, item.targetBps / 100]),
  );
  return {
    name: planning?.name ?? "长期资产规划",
    cashBuffer: Number.isInteger(planning?.cashBufferMinor)
      ? String(planning.cashBufferMinor / 100)
      : "80000",
    notes: planning?.notes ?? "",
    allocations: Object.fromEntries(
      PLANNING_ALLOCATIONS.map(({ category }, index) => [
        category,
        String(current.get(category) ?? [20, 30, 20, 10, 15, 5][index]),
      ]),
    ),
  };
}

export function validatePlanningForm(form) {
  if (!form.name?.trim() || form.name.trim().length > 80) {
    return "规划名称需要填写，且不能超过 80 个字符。";
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(form.cashBuffer ?? "")) {
    return "现金安全垫需要填写非负金额，最多保留两位小数。";
  }
  const values = PLANNING_ALLOCATIONS.map(({ category }) => Number(form.allocations?.[category]));
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
    return "每一类目标占比都需要在 0% 到 100% 之间。";
  }
  const totalBps = values.reduce((sum, value) => sum + Math.round(value * 100), 0);
  if (totalBps !== 10_000) {
    return `六类目标合计必须为 100%，当前为 ${(totalBps / 100).toFixed(2)}%。`;
  }
  if ((form.notes ?? "").trim().length > 1000) return "规划备注不能超过 1000 个字符。";
  return "";
}

export function toPlanningDraftInput(form) {
  return {
    name: form.name.trim(),
    cashBuffer: form.cashBuffer,
    allocations: PLANNING_ALLOCATIONS.map(({ category }) => ({
      category,
      targetBps: Math.round(Number(form.allocations[category]) * 100),
    })),
    notes: form.notes.trim() || null,
  };
}
