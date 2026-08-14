import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveAssetTrendYAxisDomain,
  deriveConfirmedAssetTrend,
} from "../src/data/local/assetTrend.js";

test("derives a six-month asset trend by reversing only confirmed asset-account cashflow", () => {
  const result = deriveConfirmedAssetTrend({
    now: new Date("2026-08-12T10:00:00+08:00"),
    baseCurrency: "CNY",
    accounts: [
      { id: "cash", accountType: "cash", currency: "CNY" },
      { id: "loan", accountType: "liability", currency: "CNY" },
    ],
    balances: [
      { accountId: "cash", currency: "CNY", balanceMinor: 1_280_000 },
      { accountId: "loan", currency: "CNY", balanceMinor: -200_000 },
    ],
    transactions: [
      { id: "june-income", kind: "income", accountId: "cash", amountMinor: 500_000, currency: "CNY", occurredAt: "2026-06-10T08:00:00+08:00", reversed: false },
      { id: "july-expense", kind: "expense", accountId: "cash", amountMinor: 120_000, currency: "CNY", occurredAt: "2026-07-10T08:00:00+08:00", reversed: false },
      { id: "ignored-transfer", kind: "transfer", accountId: "cash", amountMinor: 80_000, currency: "CNY", occurredAt: "2026-07-11T08:00:00+08:00", reversed: false },
      { id: "ignored-reversal", kind: "income", accountId: "cash", amountMinor: 900_000, currency: "CNY", occurredAt: "2026-08-01T08:00:00+08:00", reversed: true },
      { id: "ignored-liability", kind: "expense", accountId: "loan", amountMinor: 50_000, currency: "CNY", occurredAt: "2026-07-12T08:00:00+08:00", reversed: false },
    ],
  });

  assert.equal(result.length, 6);
  assert.deepEqual(result.map((item) => item.month), ["3月", "4月", "5月", "6月", "7月", "8月"]);
  assert.deepEqual(result.map((item) => item.totalMinor), [900_000, 900_000, 900_000, 1_400_000, 1_280_000, 1_280_000]);
  assert.ok(result.every((item) => item.source === "confirmed_ledger"));
});

test("fails closed to an empty trend when there are fewer than two valid month points", () => {
  assert.deepEqual(deriveConfirmedAssetTrend({ months: 1 }), []);
});

test("asset trend y-axis magnifies real month-to-month variation without changing values", () => {
  const values = [286_356_027, 288_636_027, 291_056_027, 294_006_027, 296_986_052, 299_949_252];
  const domain = deriveAssetTrendYAxisDomain(values.map((totalMinor, index) => ({
    month: `${index + 3}月`,
    totalMinor,
  })));

  assert.ok(domain[0] > 0, "large portfolios must not be compressed against a zero baseline");
  assert.ok(domain[0] < Math.min(...values));
  assert.ok(domain[1] > Math.max(...values));
  const visibleVariation = (Math.max(...values) - Math.min(...values)) / (domain[1] - domain[0]);
  assert.ok(visibleVariation >= 0.6, "the confirmed 4.5% change should remain clearly visible");
  assert.deepEqual(values, [286_356_027, 288_636_027, 291_056_027, 294_006_027, 296_986_052, 299_949_252]);
});

test("flat or invalid asset history keeps a safe deterministic axis", () => {
  assert.deepEqual(deriveAssetTrendYAxisDomain([]), [0, 1]);
  const [lower, upper] = deriveAssetTrendYAxisDomain([
    { totalMinor: 1_000_000 },
    { totalMinor: 1_000_000 },
    { totalMinor: Number.NaN },
  ]);
  assert.ok(lower < 1_000_000);
  assert.ok(upper > 1_000_000);
});
