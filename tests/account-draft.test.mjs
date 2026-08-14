import assert from "node:assert/strict";
import test from "node:test";
import {
  accountTypeLabel,
  createAccountProfileForm,
  createEmptyAccountForm,
  formatMinorAmount,
  presentAccountError,
  toAccountDraftInput,
  toAccountUpdateDraftInput,
  validateAccountForm,
  validateAccountProfileForm,
} from "../src/data/local/accountDraft.js";

test("manual account form normalizes only reviewable non-secret fields", () => {
  const form = {
    ...createEmptyAccountForm(new Date(2026, 6, 26, 10, 0, 0)),
    institutionName: "  招商银行  ",
    displayName: " 日常账户 ",
    accountType: "cash",
    maskedIdentifier: "3619",
    openingBalance: "128500.32",
    balanceDate: "2026-07-25",
    notes: "  日常收支  ",
  };
  assert.equal(validateAccountForm(form), "");
  assert.deepEqual(toAccountDraftInput(form), {
    institutionName: "招商银行",
    displayName: "日常账户",
    accountType: "cash",
    currency: "CNY",
    maskedIdentifier: "3619",
    openingBalance: "128500.32",
    balanceDate: "2026-07-25",
    notes: "日常收支",
  });
});

test("manual account form rejects imprecise money and full identifiers", () => {
  const form = {
    ...createEmptyAccountForm(),
    institutionName: "测试银行",
    displayName: "测试账户",
  };
  assert.match(
    validateAccountForm({ ...form, openingBalance: "0.001" }),
    /两位小数/,
  );
  assert.match(
    validateAccountForm({ ...form, maskedIdentifier: "6225888888888888" }),
    /最多 8 位/,
  );
  assert.throws(
    () => toAccountDraftInput({ ...form, balanceDate: "2026-02-30" }),
    /有效/,
  );
});

test("account presentation uses exact minor units and safe labels", () => {
  assert.equal(formatMinorAmount(12_850_032, "CNY"), "¥128,500.32");
  assert.equal(accountTypeLabel("insurance"), "保险账户");
  assert.equal(accountTypeLabel("unknown"), "其他");
  assert.equal(
    presentAccountError(new Error("An account with this institution and name already exists.")),
    "同一机构下已存在同名账户",
  );
});

test("account profile edits exclude immutable currency and balance fields", () => {
  const form = {
    ...createAccountProfileForm({
      institutionName: "演示银行",
      displayName: "日常账户",
      accountType: "cash",
      currency: "CNY",
      maskedIdentifier: "3619",
      notes: "虚构账户",
    }),
    displayName: " 家庭日常账户 ",
    accountType: "savings",
  };
  assert.equal(validateAccountProfileForm(form), "");
  assert.deepEqual(toAccountUpdateDraftInput("account-1", form), {
    accountId: "account-1",
    institutionName: "演示银行",
    displayName: "家庭日常账户",
    accountType: "savings",
    maskedIdentifier: "3619",
    notes: "虚构账户",
  });
});

test("account archive safety errors are presented without leaking backend details", () => {
  assert.equal(
    presentAccountError(new Error("A non-zero account cannot be archived.")),
    "账户仍有余额，请先通过转账或结清流水把余额处理为 0",
  );
  assert.equal(
    presentAccountError(new Error("An account with active holdings cannot be archived.")),
    "账户仍有有效持仓，请先在资产页归档这些持仓",
  );
  assert.equal(
    presentAccountError(new Error("The account changed after review.")),
    "账户在核对后发生变化，请重新生成核对草稿",
  );
});
