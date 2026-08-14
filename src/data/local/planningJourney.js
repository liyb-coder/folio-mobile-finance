const DAY_MS = 24 * 60 * 60 * 1_000;

export const PLANNING_HORIZON_CATEGORIES = Object.freeze([
  { category: "cash", label: "现金类", color: "#c9ef5b" },
  { category: "stable", label: "固收类", color: "#9789c8" },
  { category: "equity", label: "权益类", color: "#514c67" },
  { category: "gold", label: "黄金 / 商品", color: "#d7bd72" },
]);

function minorAmount(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : 0;
}

function dateAtLocalStart(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function holdingHorizonCategory(holding) {
  if (["fixed_income", "wealth_management"].includes(holding.productType)) return "stable";
  if (["fund", "security"].includes(holding.productType)) return "equity";
  if (holding.productType === "other" && /黄金|商品|gold|commodity/iu.test(holding.name ?? "")) {
    return "gold";
  }
  return null;
}

export function derivePlanningJourney({
  planning = null,
  accounts = [],
  balances = [],
  holdings = [],
  reminders = [],
  baseCurrency = "CNY",
  now = new Date(),
} = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const validNow = !Number.isNaN(nowDate.getTime()) ? nowDate : new Date();
  const today = new Date(validNow.getFullYear(), validNow.getMonth(), validNow.getDate());
  const horizonEnd = new Date(today.getTime() + 365 * DAY_MS);
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  const liquidMinor = balances.reduce((sum, balance) => {
    const account = accountById.get(balance.accountId ?? balance.account_id);
    const currency = balance.currency ?? account?.currency ?? baseCurrency;
    if (
      !account
      || account.archivedAt
      || !["cash", "savings"].includes(account.accountType)
      || currency !== baseCurrency
    ) return sum;
    return sum + minorAmount(balance.balanceMinor ?? balance.balance_minor);
  }, 0);

  const liabilityMinor = balances.reduce((sum, balance) => {
    const account = accountById.get(balance.accountId ?? balance.account_id);
    const currency = balance.currency ?? account?.currency ?? baseCurrency;
    const amount = Number(balance.balanceMinor ?? balance.balance_minor ?? 0);
    if (
      !account
      || account.archivedAt
      || account.accountType !== "liability"
      || currency !== baseCurrency
      || !Number.isSafeInteger(amount)
    ) return sum;
    return sum + Math.max(0, -amount);
  }, 0);

  const safetyTargetMinor = Number.isSafeInteger(planning?.cashBufferMinor)
    ? Math.max(0, planning.cashBufferMinor)
    : null;
  let goalCoverageMinor = Math.max(0, liquidMinor - (safetyTargetMinor ?? 0) - liabilityMinor);
  const goals = reminders
    .flatMap((reminder) => {
      const due = dateAtLocalStart(reminder.dueOn);
      const amount = minorAmount(reminder.amountMinor);
      if (
        !due
        || due < today
        || due > horizonEnd
        || !["active", "snoozed"].includes(reminder.status)
        || (reminder.currency ?? baseCurrency) !== baseCurrency
        || reminder.recurrenceRule === "monthly"
        || amount <= 0
      ) return [];
      return [{ ...reminder, due, amountMinor: amount }];
    })
    .sort((left, right) => left.due - right.due)
    .map((goal) => {
      const coveredMinor = Math.min(goal.amountMinor, goalCoverageMinor);
      goalCoverageMinor -= coveredMinor;
      return Object.freeze({
        ...goal,
        coveredMinor,
        coverageBps: goal.amountMinor > 0
          ? Math.round((coveredMinor / goal.amountMinor) * 10_000)
          : 0,
      });
    });
  const futureNeedMinor = goals.reduce((sum, goal) => sum + goal.amountMinor, 0);
  const longTermAvailableMinor = safetyTargetMinor == null
    ? null
    : Math.max(0, liquidMinor - safetyTargetMinor - futureNeedMinor - liabilityMinor);

  const holdingValues = Object.fromEntries(
    PLANNING_HORIZON_CATEGORIES.map(({ category }) => [category, 0]),
  );
  for (const holding of holdings) {
    if (
      holding.archivedAt
      || (holding.currency ?? baseCurrency) !== baseCurrency
      || holding.productType === "insurance"
    ) continue;
    const category = holdingHorizonCategory(holding);
    if (!category) continue;
    holdingValues[category] += minorAmount(holding.marketValueMinor ?? holding.market_value_minor);
  }
  holdingValues.cash = longTermAvailableMinor ?? 0;
  const allocationTotalMinor = Object.values(holdingValues).reduce((sum, value) => sum + value, 0);
  const targets = new Map((planning?.allocations ?? []).map((item) => [item.category, item.targetBps]));
  const allocationRows = PLANNING_HORIZON_CATEGORIES.map((meta) => ({
    ...meta,
    amountMinor: holdingValues[meta.category],
    currentBps: allocationTotalMinor > 0
      ? Math.round((holdingValues[meta.category] / allocationTotalMinor) * 10_000)
      : 0,
    targetBps: minorAmount(targets.get(meta.category)),
  }));

  return Object.freeze({
    liquidMinor,
    liabilityMinor,
    safetyTargetMinor,
    safetyGapMinor: safetyTargetMinor == null ? null : Math.max(0, safetyTargetMinor - liquidMinor),
    safetyComplete: safetyTargetMinor != null && safetyTargetMinor > 0,
    goals,
    futureNeedMinor,
    futureComplete: goals.length > 0,
    longTermAvailableMinor,
    allocationTotalMinor,
    allocationRows,
  });
}
