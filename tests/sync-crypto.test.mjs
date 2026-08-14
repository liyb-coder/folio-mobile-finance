import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "@noble/ciphers/utils.js";
import {
  SYNC_EVENT_KINDS,
  decryptSyncEvent,
  encryptSyncEvent,
} from "../src/sync/syncCrypto.js";

const fixture = Object.freeze({
  vaultId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  eventId: "33333333-3333-4333-8333-333333333333",
});

test("sync events round-trip through authenticated client-side encryption", async () => {
  const key = randomBytes(32);
  const payload = {
    accountName: "仅客户端可见",
    amountMinor: 12850032,
    tags: ["现金", "真实数据"],
  };
  const envelope = await encryptSyncEvent({
    vaultKey: key,
    ...fixture,
    eventKind: "ledger_event",
    logicalClock: 1,
    idempotencyKey: "manual-account:fixture-0001",
    occurredAt: "2026-07-26T14:00:00.000Z",
    payload,
  });
  assert.deepEqual(await decryptSyncEvent({ vaultKey: key, envelope }), payload);
  assert.equal(JSON.stringify(envelope).includes("仅客户端可见"), false);
  assert.equal(JSON.stringify(envelope).includes("12850032"), false);
  assert.match(envelope.payload_nonce, /^\\x[0-9a-f]{48}$/);
});

test("tampered ciphertext and authenticated metadata are rejected", async () => {
  const key = randomBytes(32);
  const envelope = await encryptSyncEvent({
    vaultKey: key,
    ...fixture,
    eventKind: "account_snapshot",
    logicalClock: 2,
    idempotencyKey: "manual-account:fixture-0002",
    payload: { amountMinor: 5000 },
  });
  const tamperedCiphertext = {
    ...envelope,
    payload_ciphertext: `${envelope.payload_ciphertext.slice(0, -2)}00`,
  };
  await assert.rejects(
    decryptSyncEvent({ vaultKey: key, envelope: tamperedCiphertext }),
    /hash verification/,
  );
  await assert.rejects(
    decryptSyncEvent({
      vaultKey: key,
      envelope: { ...envelope, logical_clock: 3 },
    }),
    /hash verification/,
  );
});

test("unsafe numeric payloads never enter encrypted sync", async () => {
  await assert.rejects(
    encryptSyncEvent({
      vaultKey: randomBytes(32),
      ...fixture,
      eventKind: "ledger_event",
      logicalClock: 3,
      idempotencyKey: "manual-account:fixture-0003",
      payload: { amountMinor: Number.MAX_VALUE },
    }),
    /safe integers/,
  );
});

test("all encrypted holding-domain event kinds round-trip without plaintext envelopes", async () => {
  assert.deepEqual(SYNC_EVENT_KINDS, [
    "account_snapshot",
    "holding_snapshot",
    "holding_valuation",
    "ledger_event",
    "holding_operation",
    "holding_operation_correction",
    "reminder_snapshot",
  ]);
  const key = randomBytes(32);
  for (const [index, eventKind] of SYNC_EVENT_KINDS.entries()) {
    const payload = {
      schemaVersion: 1,
      holdingName: `私密持仓-${eventKind}`,
      marketValueMinor: 1_088_000 + index,
    };
    const envelope = await encryptSyncEvent({
      vaultKey: key,
      ...fixture,
      eventId: `44444444-4444-4444-8444-44444444444${index}`,
      eventKind,
      logicalClock: index + 10,
      idempotencyKey: `encrypted-domain-fixture-${eventKind}`,
      payload,
    });
    assert.deepEqual(await decryptSyncEvent({ vaultKey: key, envelope }), payload);
    assert.equal(JSON.stringify(envelope).includes("私密持仓"), false);
    assert.equal(JSON.stringify(envelope).includes("1088000"), false);
  }
});

test("unknown sync event kinds are rejected before encryption and decryption", async () => {
  const key = randomBytes(32);
  await assert.rejects(
    encryptSyncEvent({
      vaultKey: key,
      ...fixture,
      eventKind: "plaintext_holding",
      logicalClock: 20,
      idempotencyKey: "unsupported-domain-fixture-1",
      payload: { name: "不得上传" },
    }),
    /unsupported/,
  );
  const envelope = await encryptSyncEvent({
    vaultKey: key,
    ...fixture,
    eventKind: "holding_snapshot",
    logicalClock: 21,
    idempotencyKey: "supported-domain-fixture-2",
    payload: { schemaVersion: 1 },
  });
  await assert.rejects(
    decryptSyncEvent({
      vaultKey: key,
      envelope: { ...envelope, event_kind: "plaintext_holding" },
    }),
    /Unsupported encrypted event kind/,
  );
});
