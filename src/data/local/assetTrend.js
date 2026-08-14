function monthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthEnd(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

function addMonths(date, offset) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function numericMinor(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) ? amount : null;
}

export function deriveAssetTrendYAxisDomain(trend = []) {
  const values = trend
    .map((item) => numericMinor(item?.totalMinor))
    .filter((value) => value != null && value >= 0);
  if (values.length === 0) return [0, 1];

  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const variation = maximum - minimum;
  const padding = variation > 0
    ? Math.max(Math.round(variation * 0.18), Math.round(maximum * 0.004), 10_000)
    : Math.max(Math.round(maximum * 0.01), 10_000);

  return [
    Math.max(0, minimum - padding),
    Math.max(maximum + padding, 1),
  ];
}

export function deriveConfirmedAssetTrend({
  now = new Date(),
  months = 6,
  baseCurrency = "CNY",
  accounts = [],
  balances = [],
  transactions = [],
} = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime()) || !Number.isSafeInteger(months) || months < 2) {
    return [];
  }
  const assetAccountIds = new Set(
    accounts
      .filter((account) => (
        !account.archivedAt
        && account.accountType !== "liability"
        && (account.currency ?? baseCurrency) === baseCurrency
      ))
      .map((account) => account.id),
  );
  const currentAssetMinor = balances.reduce((sum, balance) => {
    const accountId = balance.accountId ?? balance.account_id;
    const currency = balance.currency ?? baseCurrency;
    const amount = numericMinor(balance.balanceMinor ?? balance.balance_minor);
    if (!assetAccountIds.has(accountId) || currency !== baseCurrency || amount == null) return sum;
    return sum + Math.max(0, amount);
  }, 0);
  const confirmedDeltas = transactions.flatMap((transaction) => {
    if (
      transaction.reversed
      || transaction.kind === "transfer"
      || !assetAccountIds.has(transaction.accountId)
      || (transaction.currency ?? baseCurrency) !== baseCurrency
    ) return [];
    const amount = numericMinor(transaction.amountMinor);
    const occurredAt = new Date(transaction.occurredAt ?? transaction.createdAt);
    if (amount == null || amount < 0 || Number.isNaN(occurredAt.getTime())) return [];
    if (transaction.kind === "income") return [{ occurredAt, deltaMinor: amount }];
    if (transaction.kind === "expense") return [{ occurredAt, deltaMinor: -amount }];
    return [];
  });
  const firstMonth = addMonths(monthStart(now), -(months - 1));
  return Array.from({ length: months }, (_, index) => {
    const monthDate = addMonths(firstMonth, index);
    const cutoff = monthEnd(monthDate);
    const laterDelta = confirmedDeltas.reduce(
      (sum, event) => event.occurredAt >= cutoff ? sum + event.deltaMinor : sum,
      0,
    );
    return Object.freeze({
      month: `${monthDate.getMonth() + 1}月`,
      monthKey: `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`,
      totalMinor: Math.max(0, currentAssetMinor - laterDelta),
      source: "confirmed_ledger",
    });
  });
}
