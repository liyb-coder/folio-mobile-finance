import assert from "node:assert/strict";
import test from "node:test";
import {
  IdempotencyConflictError,
  InMemoryLedger,
} from "../src/domain/ledger.js";

function createLedger() {
  let id = 0;
  return new InMemoryLedger({
    clock: () => new Date("2026-07-24T00:00:00.000Z"),
    idFactory: () => `event-${++id}`,
  });
}

function event(overrides = {}) {
  return {
    vaultId: "vault-1",
    accountId: "account-1",
    eventType: "income",
    deltaMinor: "10000",
    currency: "CNY",
    occurredAt: "2026-07-24T08:00:00+08:00",
    status: "confirmed",
    idempotencyKey: "source:1",
    ...overrides,
  };
}

test("ledger appends immutable events and computes exact balances", () => {
  const ledger = createLedger();
  const result = ledger.append(event());

  assert.equal(result.duplicate, false);
  assert.equal(result.event.deltaMinor, "10000");
  assert.equal(
    ledger.getBalance({ vaultId: "vault-1", accountId: "account-1", currency: "CNY" }),
    "10000",
  );
});

test("ledger retries are idempotent and conflicting retries fail closed", () => {
  const ledger = createLedger();
  ledger.append(event());
  const duplicate = ledger.append(event());
  assert.equal(duplicate.duplicate, true);
  assert.equal(ledger.listEvents().length, 1);

  assert.throws(
    () => ledger.append(event({ deltaMinor: "20000" })),
    IdempotencyConflictError,
  );
  assert.equal(ledger.listEvents().length, 1);
});

test("batch appends are atomic", () => {
  const ledger = createLedger();
  assert.throws(
    () => ledger.appendBatch([
      event({ idempotencyKey: "batch:1" }),
      event({ idempotencyKey: "batch:2", currency: "CN" }),
    ]),
    /three-letter ISO/,
  );
  assert.equal(ledger.listEvents().length, 0);
});

test("reversal appends a compensating event instead of mutating history", () => {
  const ledger = createLedger();
  const original = ledger.append(event()).event;
  const reversal = ledger.reverse(original.id, {
    idempotencyKey: "reverse:1",
    reason: "User corrected the imported transaction",
  }).event;

  assert.equal(reversal.deltaMinor, "-10000");
  assert.equal(reversal.reversesEventId, original.id);
  assert.equal(ledger.listEvents().length, 2);
  assert.equal(
    ledger.getBalance({ vaultId: "vault-1", accountId: "account-1", currency: "CNY" }),
    "0",
  );
});
