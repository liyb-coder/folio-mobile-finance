import assert from "node:assert/strict";
import test from "node:test";
import {
  changeHoldingOperationKind,
  createHoldingOperationCorrectionForm,
  createHoldingOperationForm,
  holdingOperationLabel,
  presentHoldingOperationError,
  toHoldingOperationCorrectionDraftInput,
  toHoldingOperationDraftInput,
  validateHoldingOperationCorrectionForm,
  validateHoldingOperationForm,
} from "../src/data/local/holdingOperationDraft.js";

const holding = {
  id: "holding-1",
  accountId: "investment",
  accountName: "投资账户",
  currency: "CNY",
  unitsMicros: 10_000_000,
  costBasisMinor: 100_000,
  marketValueMinor: 112_000,
};
const accounts = [
  { id: "investment", displayName: "投资账户", currency: "CNY" },
  { id: "cash", displayName: "现金账户", currency: "CNY" },
  { id: "usd", displayName: "美元账户", currency: "USD" },
];

test("purchase form preserves exact position fields and optional internal settlement", () => {
  const form = {
    ...createHoldingOperationForm(holding, accounts, new Date("2026-07-27T08:00:00+08:00")),
    amount: "500.25",
    resultingUnits: "12.500000",
    resultingCostBasis: "1500.25",
    resultingMarketValue: "1620.00",
  };
  assert.equal(validateHoldingOperationForm(form, holding, accounts), "");
  assert.deepEqual(toHoldingOperationDraftInput(form, holding, accounts), {
    holdingId: "holding-1",
    operationKind: "purchase",
    settlementAccountId: null,
    amount: "500.25",
    occurredOn: "2026-07-27",
    description: "产品申购",
    notes: null,
    resultingUnits: "12.500000",
    resultingCostBasis: "1500.25",
    resultingMarketValue: "1620.00",
    valuationDate: "2026-07-27",
  });
});

test("dividend requires a same-currency settlement account and cannot change valuation", () => {
  let form = createHoldingOperationForm(holding, accounts);
  form = changeHoldingOperationKind(form, "dividend", holding);
  form.amount = "128.00";
  assert.equal(form.settlementAccountId, "investment");
  assert.equal(validateHoldingOperationForm(form, holding, accounts), "");
  assert.equal(toHoldingOperationDraftInput(form, holding, accounts).resultingUnits, null);
  form.settlementAccountId = "usd";
  assert.match(validateHoldingOperationForm(form, holding, accounts), /币种必须与持仓一致/);
});

test("purchase and redemption direction checks fail closed", () => {
  let purchase = createHoldingOperationForm(holding, accounts);
  purchase.amount = "100.00";
  assert.match(validateHoldingOperationForm(purchase, holding, accounts), /申购后数量必须增加/);

  let redeem = changeHoldingOperationKind(purchase, "redeem", holding);
  redeem.amount = "100.00";
  redeem.resultingUnits = "0";
  redeem.resultingCostBasis = "1.00";
  assert.match(validateHoldingOperationForm(redeem, holding, accounts), /全部赎回后累计成本必须为 0/);
});

test("operation labels and stale-review errors remain product-specific", () => {
  assert.equal(holdingOperationLabel("fee"), "费用");
  assert.match(
    presentHoldingOperationError(new Error("Holding latest valuation changed after review.")),
    /重新生成操作草稿/,
  );
});

test("holding operation correction requires a dated reason and preserves the original id", () => {
  const operation = {
    id: "operation-1",
    operationKind: "purchase",
    reversed: false,
    isReversal: false,
  };
  const form = createHoldingOperationCorrectionForm(
    operation,
    new Date("2026-07-27T08:00:00+08:00"),
  );
  assert.equal(validateHoldingOperationCorrectionForm(form, operation), "请填写冲销原因");
  form.reason = "误将测试申购记入真实持仓";
  assert.deepEqual(toHoldingOperationCorrectionDraftInput(form, operation), {
    operationId: "operation-1",
    reason: "误将测试申购记入真实持仓",
    occurredOn: "2026-07-27",
  });
});

test("holding operation correction fails closed for reversed and compensating records", () => {
  const reversed = { id: "operation-1", reversed: true, isReversal: false };
  const reversal = { id: "operation-2", reversed: false, isReversal: true };
  const form = {
    operationId: "operation-1",
    reason: "重复记录",
    occurredOn: "2026-07-27",
  };
  assert.match(validateHoldingOperationCorrectionForm(form, reversed), /不能重复冲销/);
  assert.match(
    validateHoldingOperationCorrectionForm(
      { ...form, operationId: "operation-2" },
      reversal,
    ),
    /不能重复冲销/,
  );
  assert.match(
    presentHoldingOperationError(new Error("Holding operation has already been corrected.")),
    /已经冲销/,
  );
});
