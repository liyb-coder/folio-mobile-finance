import test from "node:test";
import assert from "node:assert/strict";

import {
  ContractError,
  assertMiniProgramPorts,
  assertReviewableProposal,
  assertSafeMiniProgramConfig,
  createConfirmationCommand,
} from "../packages/folio-contracts/src/index.js";

function completePorts() {
  const fn = async () => ({ ok: true });
  return {
    identity: {
      beginLogin: fn,
      bindAccount: fn,
      reauthenticate: fn,
      logout: fn,
    },
    capture: {
      startVoice: fn,
      stopVoice: fn,
      chooseImage: fn,
      chooseDocument: fn,
      releaseTransientSource: fn,
    },
    proposals: {
      create: fn,
      get: fn,
      confirm: fn,
      reject: fn,
    },
    repository: {
      getSnapshot: fn,
      getSyncCursor: fn,
    },
    reminders: {
      requestSubscription: fn,
      getSubscriptionState: fn,
    },
  };
}

test("mini-program runtime config accepts public routing data only", () => {
  const config = assertSafeMiniProgramConfig({
    appId: "wx1234567890abcdef",
    bffBaseUrl: "https://api.folio.example",
    environment: "staging",
    clientVersion: "0.1.0",
  });

  assert.equal(config.environment, "staging");
  assert.equal(Object.isFrozen(config), true);

  for (const unsafe of [
    { ...config, aiApiKey: "secret" },
    { ...config, appSecret: "secret" },
    { ...config, serviceRoleKey: "secret" },
    { ...config, provider: { privateKey: "secret" } },
  ]) {
    assert.throws(
      () => assertSafeMiniProgramConfig(unsafe),
      (error) => error instanceof ContractError && error.code === "client_secret_forbidden",
    );
  }

  assert.throws(
    () => assertSafeMiniProgramConfig({ ...config, bffBaseUrl: "http://api.folio.example" }),
    (error) => error instanceof ContractError && error.code === "https_required",
  );
});

test("mini-program ports fail closed when a platform capability is missing", () => {
  const ports = completePorts();
  assert.equal(assertMiniProgramPorts(ports), ports);

  const incomplete = completePorts();
  delete incomplete.proposals.confirm;

  assert.throws(
    () => assertMiniProgramPorts(incomplete),
    (error) => error instanceof ContractError
      && error.code === "missing_platform_port"
      && error.details.port === "proposals.confirm",
  );
});

test("AI and file-derived proposals can only enter pending review with evidence", () => {
  const proposal = assertReviewableProposal({
    proposalId: "proposal-1",
    state: "pending_review",
    sourceKind: "voice",
    sourceId: "voice-session-1",
    items: [
      {
        itemId: "income-1",
        kind: "transaction",
        evidence: [{ sourceId: "voice-session-1", quote: "建行新增租金收入8000" }],
      },
      {
        itemId: "reminder-1",
        kind: "reminder",
        evidence: [{ sourceId: "voice-session-1", quote: "8月20日交保费一万" }],
      },
    ],
  });

  assert.equal(proposal.state, "pending_review");

  assert.throws(
    () => assertReviewableProposal({ ...proposal, state: "confirmed" }),
    (error) => error instanceof ContractError && error.code === "proposal_not_reviewable",
  );

  assert.throws(
    () => assertReviewableProposal({
      ...proposal,
      items: [{ ...proposal.items[0], evidence: [] }],
    }),
    (error) => error instanceof ContractError && error.code === "proposal_evidence_required",
  );
});

test("confirmation requires explicit user intent, version checks and an idempotency key", () => {
  const command = createConfirmationCommand({
    proposalId: "proposal-1",
    expectedVersion: 17,
    idempotencyKey: "018fe378-2f61-7c4c-8f89-1fb19610b1a8",
    confirmedItemIds: ["income-1"],
    confirmedByUser: true,
  });

  assert.deepEqual(command.confirmedItemIds, ["income-1"]);
  assert.equal(Object.isFrozen(command), true);
  assert.equal(Object.isFrozen(command.confirmedItemIds), true);

  const invalidCases = [
    [{ ...command, confirmedByUser: false }, "explicit_confirmation_required"],
    [{ ...command, idempotencyKey: "" }, "idempotency_key_required"],
    [{ ...command, expectedVersion: -1 }, "expected_version_invalid"],
    [{ ...command, confirmedItemIds: [] }, "confirmed_items_required"],
    [{ ...command, confirmedItemIds: ["income-1", "income-1"] }, "confirmed_items_duplicate"],
  ];

  for (const [input, code] of invalidCases) {
    assert.throws(
      () => createConfirmationCommand(input),
      (error) => error instanceof ContractError && error.code === code,
    );
  }
});

test("adversarial runtime config rejects cyclic values and production loopback endpoints", () => {
  const cyclic = {
    appId: "wx1234567890abcdef",
    bffBaseUrl: "https://api.folio.example",
    environment: "production",
    clientVersion: "0.1.0",
  };
  cyclic.provider = cyclic;

  assert.throws(
    () => assertSafeMiniProgramConfig(cyclic),
    (error) => error instanceof ContractError && error.code === "runtime_config_cyclic",
  );

  assert.throws(
    () => assertSafeMiniProgramConfig({
      appId: "wx1234567890abcdef",
      bffBaseUrl: "https://localhost:8787",
      environment: "production",
      clientVersion: "0.1.0",
    }),
    (error) => error instanceof ContractError && error.code === "production_endpoint_invalid",
  );
});

test("adversarial proposals reject server state, forged evidence and malformed regions", () => {
  const base = {
    proposalId: "proposal-1",
    state: "pending_review",
    sourceKind: "image",
    sourceId: "image-1",
    items: [
      {
        itemId: "transaction-1",
        kind: "transaction",
        evidence: [{ sourceId: "image-1", region: [10, 20, 110, 70] }],
      },
    ],
  };

  const valid = assertReviewableProposal(base);
  assert.equal(Object.isFrozen(valid.items[0].evidence[0].region), true);

  for (const proposal of [
    { ...base, ledgerEventId: "event-1" },
    { ...base, items: [{ ...base.items[0], appliedAt: "2026-08-11T12:00:00Z" }] },
    { ...base, items: [{ ...base.items[0], confirmed: true }] },
    { ...base, items: [{ ...base.items[0], status: "applied" }] },
    {
      ...base,
      items: [{ ...base.items[0], mutation: { ledgerEventId: "event-hidden" } }],
    },
  ]) {
    assert.throws(
      () => assertReviewableProposal(proposal),
      (error) => error instanceof ContractError && error.code === "proposal_contains_server_state",
    );
  }

  assert.throws(
    () => assertReviewableProposal({
      ...base,
      items: [{
        ...base.items[0],
        evidence: [{ sourceId: "other-image", region: [10, 20, 110, 70] }],
      }],
    }),
    (error) => error instanceof ContractError && error.code === "proposal_evidence_source_mismatch",
  );

  for (const region of [
    [10, 20, "110", 70],
    [-1, 20, 110, 70],
    [10, 20, Number.NaN, 70],
  ]) {
    assert.throws(
      () => assertReviewableProposal({
        ...base,
        items: [{ ...base.items[0], evidence: [{ sourceId: "image-1", region }] }],
      }),
      (error) => error instanceof ContractError && error.code === "proposal_evidence_invalid",
    );
  }

  const cyclicItem = { ...base.items[0] };
  cyclicItem.metadata = cyclicItem;
  assert.throws(
    () => assertReviewableProposal({ ...base, items: [cyclicItem] }),
    (error) => error instanceof ContractError && error.code === "proposal_cyclic",
  );
});
