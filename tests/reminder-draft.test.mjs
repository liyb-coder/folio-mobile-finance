import assert from "node:assert/strict";
import test from "node:test";
import {
  createReminderForm,
  formatReminderAmount,
  presentReminderError,
  reminderCategoryLabel,
  reminderRecurrenceLabel,
  reminderStatusLabel,
  toReminderDraftInput,
  toReminderUpdateDraftInput,
  validateReminderForm,
} from "../src/data/local/reminderDraft.js";

const accounts = [
  { id: "account-1", currency: "CNY", displayName: "日常账户" },
];

test("manual reminder form creates only normalized review fields", () => {
  const form = {
    ...createReminderForm(null, new Date(2026, 6, 27, 9, 0, 0)),
    title: " 虚构保险续缴 ",
    category: "insurance",
    linkedAccountId: "account-1",
    amount: "12800.50",
    dueOn: "2026-08-02",
    advanceDays: "3",
    recurrenceRule: "yearly",
    notes: " 仅用于测试 ",
  };
  assert.equal(validateReminderForm(form, accounts), "");
  assert.deepEqual(toReminderDraftInput(form, accounts), {
    title: "虚构保险续缴",
    category: "insurance",
    linkedAccountId: "account-1",
    amount: "12800.50",
    dueOn: "2026-08-02",
    advanceDays: 3,
    recurrenceRule: "yearly",
    notes: "仅用于测试",
  });
  assert.deepEqual(toReminderUpdateDraftInput("reminder-1", form, accounts), {
    reminderId: "reminder-1",
    ...toReminderDraftInput(form, accounts),
  });
});

test("reminder amount is optional but rejects unsafe values", () => {
  const base = {
    ...createReminderForm(),
    title: "测试事项",
  };
  assert.equal(validateReminderForm({ ...base, amount: "" }, accounts), "");
  for (const amount of ["0", "-1", "1.001", "1e3"]) {
    assert.match(validateReminderForm({ ...base, amount }, accounts), /金额/);
  }
});

test("reminder validation rejects invalid dates, accounts and intervals", () => {
  const base = {
    ...createReminderForm(),
    title: "测试事项",
  };
  assert.match(validateReminderForm({ ...base, dueOn: "2026-02-30" }, accounts), /日期/);
  assert.match(validateReminderForm({ ...base, linkedAccountId: "missing" }, accounts), /账户/);
  assert.match(validateReminderForm({ ...base, advanceDays: "-1" }, accounts), /天数/);
});

test("reminder presentation keeps product semantics", () => {
  assert.equal(reminderCategoryLabel("insurance"), "保险");
  assert.equal(reminderRecurrenceLabel("monthly"), "每月");
  assert.equal(reminderStatusLabel("completed"), "已完成");
  assert.equal(formatReminderAmount(1_280_050, "CNY"), "¥12,800.50");
  assert.equal(
    presentReminderError(new Error("The reminder changed after review.")),
    "事项在核对后发生变化，请重新打开并核对",
  );
});
