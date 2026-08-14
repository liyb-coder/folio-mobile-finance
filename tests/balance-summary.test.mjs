import assert from "node:assert/strict";
import test from "node:test";
import { summarizeBaseBalances } from "../src/data/local/balanceSummary.js";

test("net worth, assets and available cash remain separate financial metrics", () => {
  const summary = summarizeBaseBalances({
    baseCurrency: "CNY",
    accounts: [
      { id: "salary", accountType: "cash" },
      { id: "daily", accountType: "cash" },
      { id: "fund", accountType: "fund" },
      { id: "home", accountType: "property" },
      { id: "card", accountType: "liability" },
      { id: "mortgage", accountType: "liability" },
      { id: "usd", accountType: "savings" },
    ],
    balances: [
      { accountId: "salary", currency: "CNY", balanceMinor: 12_850_000 },
      { accountId: "daily", currency: "CNY", balanceMinor: 3_268_052 },
      { accountId: "fund", currency: "CNY", balanceMinor: 38_640_000 },
      { accountId: "home", currency: "CNY", balanceMinor: 208_000_000 },
      { accountId: "card", currency: "CNY", balanceMinor: -462_835 },
      { accountId: "mortgage", currency: "CNY", balanceMinor: -68_000_000 },
      { accountId: "usd", currency: "USD", balanceMinor: 1_280_000 },
    ],
  });
  assert.deepEqual(summary, {
    netMinor: 194_295_217,
    assetMinor: 262_758_052,
    availableCashMinor: 16_118_052,
    availableCashAccountCount: 2,
  });
});

test("negative cash and unsupported or malformed balances do not inflate available cash", () => {
  assert.deepEqual(
    summarizeBaseBalances({
      accounts: [
        { id: "cash", accountType: "cash" },
        { id: "orphan", accountType: "cash" },
      ],
      balances: [
        { accountId: "cash", currency: "CNY", balanceMinor: -100 },
        { accountId: "orphan", currency: "CNY", balanceMinor: Number.MAX_VALUE },
        { accountId: "missing", currency: "CNY", balanceMinor: 50_000 },
      ],
    }),
    {
      netMinor: -100,
      assetMinor: 0,
      availableCashMinor: 0,
      availableCashAccountCount: 0,
    },
  );
});

test("available cash uses cash-management holdings inside mixed investment accounts", () => {
  const summary = summarizeBaseBalances({
    accounts: [
      { id: "mixed", accountType: "investment" },
      { id: "plain", accountType: "cash" },
    ],
    balances: [
      { accountId: "mixed", currency: "CNY", balanceMinor: 1_000_000 },
      { accountId: "plain", currency: "CNY", balanceMinor: 200_000 },
    ],
    holdings: [
      { accountId: "mixed", productType: "cash_management", currency: "CNY", marketValueMinor: 300_000 },
      { accountId: "mixed", productType: "fund", currency: "CNY", marketValueMinor: 700_000 },
    ],
    baseCurrency: "CNY",
  });
  assert.equal(summary.availableCashMinor, 500_000);
  assert.equal(summary.availableCashAccountCount, 2);
});
