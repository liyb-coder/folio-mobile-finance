import assert from "node:assert/strict";
import test from "node:test";
import {
  EncryptedSyncQueue,
  MemoryEncryptedQueueStore,
} from "../src/sync/encryptedQueue.js";

const envelope = Object.freeze({
  event_id: "33333333-3333-4333-8333-333333333333",
  vault_id: "11111111-1111-4111-8111-111111111111",
  logical_clock: 1,
  idempotency_key: "manual-account:fixture-0001",
  event_hash: "\\x00",
  payload_ciphertext: "\\x11",
});

test("encrypted queue is idempotent and orders pending events by logical clock", async () => {
  const queue = new EncryptedSyncQueue(new MemoryEncryptedQueueStore());
  await queue.enqueue({ ...envelope, event_id: "event-2", logical_clock: 2 });
  await queue.enqueue(envelope);
  await queue.enqueue(envelope);
  assert.deepEqual(
    (await queue.pending(envelope.vault_id)).map((record) => record.envelope.logical_clock),
    [1, 2],
  );
});

test("sync queue retains retry metadata without storing plaintext payloads", async () => {
  const store = new MemoryEncryptedQueueStore();
  const queue = new EncryptedSyncQueue(store);
  await queue.enqueue(envelope);
  await queue.markAttempt(envelope.event_id, "network_unavailable");
  const record = await store.get(envelope.event_id);
  assert.equal(record.attempts, 1);
  assert.equal(record.last_error_code, "network_unavailable");
  assert.equal(Object.hasOwn(record.envelope, "payload"), false);
  await queue.markSynced(envelope.event_id);
  assert.equal((await queue.pending(envelope.vault_id)).length, 0);
});

test("event identifier collisions are sent to reconciliation", async () => {
  const queue = new EncryptedSyncQueue();
  await queue.enqueue(envelope);
  await assert.rejects(
    queue.enqueue({ ...envelope, event_hash: "\\xff" }),
    /collision/,
  );
});
