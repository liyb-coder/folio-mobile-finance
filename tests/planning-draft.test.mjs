import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlanningForm,
  toPlanningDraftInput,
  validatePlanningForm,
} from "../src/data/local/planningDraft.js";
import { createLocalRepository } from "../src/data/local/localRepository.js";

test("planning form produces exact basis points totaling 100 percent", () => {
  const form = createPlanningForm(null);
  assert.equal(validatePlanningForm(form), "");
  const input = toPlanningDraftInput(form);
  assert.equal(
    input.allocations.reduce((sum, allocation) => sum + allocation.targetBps, 0),
    10_000,
  );
  assert.equal(input.cashBuffer, "80000");
});

test("planning form rejects imprecise totals and unsafe amounts", () => {
  const form = createPlanningForm(null);
  form.allocations.cash = "19.99";
  assert.match(validatePlanningForm(form), /100%/);
  form.allocations.cash = "20";
  form.cashBuffer = "-1";
  assert.match(validatePlanningForm(form), /非负金额/);
});

test("planning repository uses only explicit draft confirmation commands", async () => {
  const calls = [];
  const repository = createLocalRepository(async (command, payload) => {
    calls.push([command, payload]);
    return { status: "ok" };
  });
  await repository.savePlanningDraft({ name: "长期资产规划" });
  await repository.confirmPlanningDraft("draft-planning");
  await repository.rejectPlanningDraft("draft-rejected");
  assert.deepEqual(calls, [
    ["planning_profile_save_draft", { request: { name: "长期资产规划" } }],
    ["planning_profile_confirm_draft", {
      request: { draftId: "draft-planning", confirmedByUser: true },
    }],
    ["planning_profile_reject_draft", {
      request: { draftId: "draft-rejected" },
    }],
  ]);
});
