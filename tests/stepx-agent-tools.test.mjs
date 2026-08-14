import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_TOOL_MANIFEST,
  AgentBoundaryError,
  createFolioAgentTools,
  createStepxPublicToolRegistry,
} from "../packages/folio-agent-tools/src/index.js";

function proposalFixture() {
  return {
    proposalId: "proposal-voice-1",
    sourceKind: "voice",
    sourceId: "voice-source-1",
    state: "pending_review",
    items: [
      {
        itemId: "income-1",
        kind: "transaction",
        title: "建行新增租金收入 8,000 元",
        evidence: [{ sourceId: "voice-source-1", quote: "建行新增租金收入8000" }],
      },
      {
        itemId: "reminder-1",
        kind: "reminder",
        title: "8 月 20 日交保费 10,000 元",
        evidence: [{ sourceId: "voice-source-1", quote: "8月20日提醒我交保费10000" }],
      },
    ],
  };
}

function createHarness(now = "2026-08-12T10:00:00.000Z") {
  const calls = [];
  const proposal = proposalFixture();
  const tools = createFolioAgentTools({
    clock: () => new Date(now),
    proposals: {
      async create(input) {
        calls.push(["create", input]);
        return proposal;
      },
      async get(proposalId) {
        calls.push(["get", proposalId]);
        return proposalId === proposal.proposalId ? proposal : null;
      },
      async confirm(command) {
        calls.push(["confirm", command]);
        return { receiptId: "receipt-1", appliedItemIds: command.confirmedItemIds };
      },
    },
    reminders: {
      async listDue(input) {
        calls.push(["listDue", input]);
        return [{ id: "reminder-1", title: "交保费", dueAt: "2026-08-20" }];
      },
    },
    repository: {
      async getPlanningSnapshot(input) {
        calls.push(["getPlanningSnapshot", input]);
        return {
          asOf: "2026-08-12T09:59:00.000Z",
          availableCashMinor: "2600000",
          currency: "CNY",
          reservedMinor: "1000000",
          evidenceCoverage: 1,
          citations: ["ledger:rent-income-1", "reminder:reminder-1"],
        };
      },
    },
    navigation: {
      async openReview(input) {
        calls.push(["openReview", input]);
        return { opened: true, proposalId: input.proposalId };
      },
    },
  });
  return { calls, proposal, tools };
}

test("STEPX manifest is proposal-or-read-only and never exposes financial confirmation or transaction authority", () => {
  assert.deepEqual(
    AGENT_TOOL_MANIFEST.map((tool) => tool.name),
    [
      "folio.create_review_proposal",
      "folio.list_due_reminders",
      "folio.get_planning_snapshot",
      "folio.open_review",
      "folio.simulate_idle_cash_plan",
    ],
  );
  assert.equal(
    AGENT_TOOL_MANIFEST.some((tool) => /confirm|pay|payment|transfer|trade|buy|sell/i.test(tool.name)),
    false,
  );
  assert.ok(AGENT_TOOL_MANIFEST.every((tool) => tool.financialMutation === "forbidden"));
  const proposal = AGENT_TOOL_MANIFEST.find((tool) => tool.name === "folio.create_review_proposal");
  assert.equal(proposal.readOnly, false);
  assert.equal(proposal.mutationScope, "pending_review_only");
});

test("STEPX runtime registration cannot accidentally receive Folio foreground confirmation", () => {
  const { tools } = createHarness();
  const publicTools = createStepxPublicToolRegistry(tools);
  assert.deepEqual(Object.keys(publicTools), AGENT_TOOL_MANIFEST.map((tool) => tool.name));
  assert.equal(Object.hasOwn(publicTools, "folio.confirm_selected_items"), false);
  assert.equal(typeof tools["folio.confirm_selected_items"], "function");
});

test("agent input can only create an evidence-covered pending review proposal", async () => {
  const { calls, tools } = createHarness();
  const result = await tools["folio.create_review_proposal"]({
    sourceKind: "voice",
    sourceId: "voice-source-1",
    text: "建行新增租金收入8000，8月20日提醒我交保费10000",
  });
  assert.equal(result.state, "pending_review");
  assert.equal(result.items.length, 2);
  assert.equal(calls[0][0], "create");
  assert.equal(Object.hasOwn(result, "confirmed"), false);
});

test("agent rejects a provider response that claims a write or loses source evidence", async () => {
  const base = createHarness();
  base.tools = createFolioAgentTools({
    clock: () => new Date("2026-08-12T10:00:00.000Z"),
    proposals: {
      async create() {
        return {
          ...proposalFixture(),
          status: "confirmed",
          items: [{ ...proposalFixture().items[0], evidence: [] }],
        };
      },
      async get() { return null; },
      async confirm() { throw new Error("must not be called"); },
    },
    reminders: { async listDue() { return []; } },
    repository: { async getPlanningSnapshot() { return {}; } },
    navigation: { async openReview() { return {}; } },
  });
  await assert.rejects(
    () => base.tools["folio.create_review_proposal"]({
      sourceKind: "voice",
      sourceId: "voice-source-1",
      text: "新增8000",
    }),
    (error) => error.code === "proposal_contains_server_state",
  );
});

test("confirmation fails closed without a live foreground session and recent reauthentication", async () => {
  const { tools } = createHarness();
  const common = {
    proposalId: "proposal-voice-1",
    expectedVersion: 3,
    idempotencyKey: "stepx-demo-confirm-0001",
    confirmedItemIds: ["income-1"],
    confirmedByUser: true,
  };
  await assert.rejects(
    () => tools["folio.confirm_selected_items"](common, { foreground: false }),
    (error) => error instanceof AgentBoundaryError && error.code === "foreground_required",
  );
  await assert.rejects(
    () => tools["folio.confirm_selected_items"](common, {
      foreground: true,
      reauthenticatedAt: "2026-08-12T09:54:59.000Z",
    }),
    (error) => error.code === "recent_reauthentication_required",
  );
});

test("confirmation rejects unknown items and only then delegates an explicit idempotent command", async () => {
  const { calls, tools } = createHarness();
  const context = {
    foreground: true,
    reauthenticatedAt: "2026-08-12T09:58:00.000Z",
  };
  await assert.rejects(
    () => tools["folio.confirm_selected_items"]({
      proposalId: "proposal-voice-1",
      expectedVersion: 3,
      idempotencyKey: "stepx-demo-confirm-0001",
      confirmedItemIds: ["invented-item"],
      confirmedByUser: true,
    }, context),
    (error) => error.code === "confirmed_item_unknown",
  );

  const receipt = await tools["folio.confirm_selected_items"]({
    proposalId: "proposal-voice-1",
    expectedVersion: 3,
    idempotencyKey: "stepx-demo-confirm-0002",
    confirmedItemIds: ["income-1", "reminder-1"],
    confirmedByUser: true,
  }, context);
  assert.deepEqual(receipt.appliedItemIds, ["income-1", "reminder-1"]);
  const confirmCall = calls.find(([name]) => name === "confirm");
  assert.equal(confirmCall[1].confirmedByUser, true);
  assert.equal(confirmCall[1].expectedVersion, 3);
});

test("planning tools return deterministic evidence and simulation never writes", async () => {
  const { calls, tools } = createHarness();
  const snapshot = await tools["folio.get_planning_snapshot"]({ horizonDays: 30 });
  assert.equal(snapshot.availableCashMinor, "2600000");
  assert.equal(snapshot.evidenceCoverage, 1);
  assert.ok(snapshot.citations.length > 0);

  const simulation = await tools["folio.simulate_idle_cash_plan"]({
    horizonDays: 30,
    reserveMinor: "1600000",
  });
  assert.equal(simulation.mode, "simulation");
  assert.equal(simulation.currency, "CNY");
  assert.equal(simulation.simulatableMinor, "1000000");
  assert.equal(calls.some(([name]) => name === "confirm"), false);
});
