import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptyHoldingForm,
  createHoldingProfileForm,
  createHoldingValuationForm,
  formatUnitsMicros,
  holdingTypeLabel,
  presentHoldingError,
  toHoldingArchiveDraftInput,
  toHoldingDraftInput,
  toHoldingUpdateDraftInput,
  toHoldingValuationDraftInput,
  validateHoldingForm,
  validateHoldingProfileForm,
  validateHoldingValuationForm,
} from "../src/data/local/holdingDraft.js";

const accounts = [{
  id: "account-1",
  displayName: "投资账户",
  currency: "CNY",
}];

test("holding form creates a normalized review request without changing account balance", () => {
  const form = {
    ...createEmptyHoldingForm(accounts, new Date(2026, 6, 27, 10, 0, 0)),
    name: " 招商中证红利 A ",
    productType: "fund",
    maskedIdentifier: "FUND-1028",
    units: "1234.567890",
    costBasis: "50000.00",
    marketValue: "51880.32",
    asOfDate: "2026-07-26",
    notes: " 长期持有 ",
  };
  assert.equal(validateHoldingForm(form, accounts), "");
  assert.deepEqual(toHoldingDraftInput(form, accounts), {
    accountId: "account-1",
    name: "招商中证红利 A",
    productType: "fund",
    currency: "CNY",
    maskedIdentifier: "FUND-1028",
    units: "1234.567890",
    costBasis: "50000.00",
    marketValue: "51880.32",
    asOfDate: "2026-07-26",
    notes: "长期持有",
  });
});

test("holding validation rejects imprecise quantities, money and mismatched currencies", () => {
  const form = {
    ...createEmptyHoldingForm(accounts),
    name: "测试基金",
    marketValue: "100.00",
  };
  assert.match(validateHoldingForm({ ...form, units: "1.0000001" }, accounts), /六位/);
  assert.match(validateHoldingForm({ ...form, costBasis: "0.001" }, accounts), /两位/);
  assert.match(validateHoldingForm({ ...form, currency: "USD" }, accounts), /所属账户一致/);
  assert.match(validateHoldingForm({ ...form, asOfDate: "2026-02-30" }, accounts), /有效/);
});

test("valuation update preserves exact review fields and safe presentation", () => {
  const form = {
    ...createHoldingValuationForm({
      id: "holding-1",
      unitsMicros: 1_234_567_890,
      costBasisMinor: 5_000_000,
      marketValueMinor: 5_188_032,
    }, new Date(2026, 6, 27, 10, 0, 0)),
    marketValue: "52100.16",
  };
  assert.equal(validateHoldingValuationForm(form), "");
  assert.deepEqual(toHoldingValuationDraftInput(form), {
    holdingId: "holding-1",
    units: "1234.56789",
    costBasis: "50000.00",
    marketValue: "52100.16",
    asOfDate: "2026-07-27",
  });
  assert.equal(formatUnitsMicros(1_234_567_890), "1234.56789");
  assert.equal(holdingTypeLabel("fixed_income"), "固收理财");
});

test("holding errors stay concise and do not imply valuation changes account balance", () => {
  assert.equal(
    presentHoldingError(new Error("A holding with the same account and name already exists.")),
    "该账户下已存在同名持仓",
  );
  assert.equal(
    presentHoldingError(new Error("The holding changed after review.")),
    "持仓在核对后发生变化，请重新生成核对草稿",
  );
});

test("holding profile updates and archive requests remain review-only", () => {
  const form = {
    ...createHoldingProfileForm({
      id: "holding-1",
      name: "原产品",
      productType: "fund",
      maskedIdentifier: "1028",
      notes: "原备注",
    }),
    name: " 更新后的产品 ",
    productType: "fixed_income",
    maskedIdentifier: "NEW-1028",
    notes: " 新备注 ",
  };
  assert.equal(validateHoldingProfileForm(form), "");
  assert.deepEqual(toHoldingUpdateDraftInput(form), {
    holdingId: "holding-1",
    name: "更新后的产品",
    productType: "fixed_income",
    maskedIdentifier: "NEW-1028",
    notes: "新备注",
  });
  assert.deepEqual(toHoldingArchiveDraftInput(" holding-1 "), {
    holdingId: "holding-1",
  });
  assert.match(
    validateHoldingProfileForm({ ...form, maskedIdentifier: "完整账号/不允许" }),
    /尾号/,
  );
});
