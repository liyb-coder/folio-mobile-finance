export function summarizeBaseBalances({
  balances = [],
  accounts = [],
  holdings = [],
  baseCurrency = "CNY",
} = {}) {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const baseBalances = balances.flatMap((item) => {
    if ((item.currency ?? baseCurrency) !== baseCurrency) return [];
    const account = accountById.get(item.accountId ?? item.account_id);
    const amountMinor = Number(item.balanceMinor ?? item.balance_minor ?? 0);
    if (!account || !Number.isSafeInteger(amountMinor)) return [];
    return [{ account, amountMinor }];
  });
  const cashHoldingsByAccount = new Map();
  for (const holding of holdings) {
    if (holding.archivedAt || holding.productType !== "cash_management") continue;
    if ((holding.currency ?? baseCurrency) !== baseCurrency) continue;
    const amountMinor = Number(holding.marketValueMinor ?? holding.market_value_minor ?? 0);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) continue;
    const accountId = holding.accountId ?? holding.account_id;
    cashHoldingsByAccount.set(
      accountId,
      (cashHoldingsByAccount.get(accountId) ?? 0) + amountMinor,
    );
  }
  const availableCashBalances = baseBalances.flatMap((item) => {
    const accountId = item.account.id;
    if (cashHoldingsByAccount.has(accountId)) {
      return [{ ...item, amountMinor: cashHoldingsByAccount.get(accountId) }];
    }
    return ["cash", "savings"].includes(item.account.accountType) && item.amountMinor > 0
      ? [item]
      : [];
  });
  return {
    netMinor: baseBalances.reduce((sum, item) => sum + item.amountMinor, 0),
    assetMinor: baseBalances
      .filter((item) => item.account.accountType !== "liability")
      .reduce((sum, item) => sum + Math.max(0, item.amountMinor), 0),
    availableCashMinor: availableCashBalances
      .reduce((sum, item) => sum + item.amountMinor, 0),
    availableCashAccountCount: availableCashBalances.length,
  };
}
