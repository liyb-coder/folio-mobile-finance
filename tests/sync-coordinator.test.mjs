import assert from "node:assert/strict";
import test from "node:test";
import { EncryptedSyncCoordinator } from "../src/sync/syncCoordinator.js";
import {
  createSupabaseSyncClient,
  remoteEnvelope,
} from "../src/sync/supabaseSync.js";

function localFixture(envelopes = []) {
  const calls = [];
  return {
    calls,
    async enableSync(request) {
      calls.push(["enable", request]);
      return {
        cloudVaultId: "vault-cloud",
        cloudUserId: request.cloudUserId,
        deviceId: "device-cloud",
        encryptedVaultName: "\\x11",
        vaultNameNonce: "\\x22",
        devicePublicKey: "\\x33",
        keyEnvelopeId: "envelope-cloud",
        keyEnvelopeNonce: "\\x44",
        wrappedSyncKey: "\\x55",
        platform: request.platform,
        keyVersion: 1,
      };
    },
    async getSyncStatus() {
      calls.push(["status"]);
      return { enabled: true };
    },
    async prepareSyncOutbox(limit) {
      calls.push(["prepare", limit]);
    },
    async listSyncOutbox() {
      calls.push(["list"]);
      return envelopes;
    },
    async recordSyncDelivery(request) {
      calls.push(["delivery", request]);
      return { enabled: true };
    },
    async applyIncomingSyncEvents(request) {
      calls.push(["apply", request]);
      return { appliedCount: request.events.length, duplicateCount: 0, conflictCount: 0 };
    },
    async disableSync() {
      calls.push(["disable"]);
      return { enabled: false };
    },
  };
}

test("coordinator provisions only native-produced encrypted bootstrap values", async () => {
  const local = localFixture();
  const remoteCalls = [];
  const coordinator = new EncryptedSyncCoordinator({
    localRepository: local,
    remoteClient: {
      async bootstrapEncryptedVault(bootstrap) {
        remoteCalls.push(bootstrap);
      },
      async appendEncryptedEvent() {},
      async pullEncryptedEvents() {
        return { events: [], cursor: null };
      },
    },
  });
  const status = await coordinator.enable({
    cloudUserId: "user-cloud",
    platform: "macos",
  });
  assert.deepEqual(status, { enabled: true });
  assert.equal(remoteCalls.length, 1);
  assert.equal(Object.hasOwn(remoteCalls[0], "syncKey"), false);
  assert.equal(Object.hasOwn(remoteCalls[0], "devicePrivateKey"), false);
  assert.deepEqual(local.calls[0], ["enable", {
    cloudUserId: "user-cloud",
    platform: "macos",
    confirmedByUser: true,
  }]);
});

test("coordinator rolls local sync back to disabled when remote bootstrap fails", async () => {
  const local = localFixture();
  const coordinator = new EncryptedSyncCoordinator({
    localRepository: local,
    remoteClient: {
      async bootstrapEncryptedVault() {
        throw new Error("network unavailable");
      },
      async appendEncryptedEvent() {},
      async pullEncryptedEvents() {
        return { events: [], cursor: null };
      },
    },
  });

  await assert.rejects(
    coordinator.enable({ cloudUserId: "user-cloud", platform: "macos" }),
    /network unavailable/,
  );
  assert.equal(local.calls.filter(([kind]) => kind === "disable").length, 1);
  assert.equal(local.calls.filter(([kind]) => kind === "status").length, 0);
});

test("coordinator retries network failures and isolates idempotency collisions", async () => {
  const envelopes = [
    { event_id: "event-a", payload_ciphertext: "\\x11" },
    { event_id: "event-b", payload_ciphertext: "\\x22" },
  ];
  const local = localFixture(envelopes);
  const coordinator = new EncryptedSyncCoordinator({
    localRepository: local,
    remoteClient: {
      async bootstrapEncryptedVault() {},
      async appendEncryptedEvent(envelope) {
        if (envelope.event_id === "event-a") {
          const error = new Error("Sync idempotency collision requires reconciliation.");
          throw error;
        }
        const error = new Error("network unavailable");
        error.code = "NETWORK-OFFLINE";
        throw error;
      },
      async pullEncryptedEvents() {
        return { events: [], cursor: null };
      },
    },
  });
  const result = await coordinator.flush({ batchSize: 20 });
  assert.equal(result.attempted, 2);
  assert.deepEqual(
    result.results.map((entry) => entry.outcome),
    ["needs_reconciliation", "retry"],
  );
  const deliveries = local.calls.filter(([kind]) => kind === "delivery");
  assert.equal(deliveries[0][1].errorCode, "idempotency_collision");
  assert.equal(deliveries[1][1].errorCode, "network-offline");
});

test("native camelCase envelopes map exactly to Supabase snake_case columns", () => {
  assert.deepEqual(remoteEnvelope({
    eventId: "event-a",
    vaultId: "vault-a",
    deviceId: "device-a",
    eventKind: "ledger_event",
    logicalClock: 7,
    idempotencyKey: "local-domain:ledger_event:event-a:v2",
    eventHash: "\\xaa",
    previousEventHash: "\\xbb",
    payloadNonce: "\\xcc",
    payloadCiphertext: "\\xdd",
    aadVersion: 2,
    occurredAt: "2026-07-26T15:00:00.000Z",
  }), {
    event_id: "event-a",
    vault_id: "vault-a",
    device_id: "device-a",
    event_kind: "ledger_event",
    logical_clock: 7,
    idempotency_key: "local-domain:ledger_event:event-a:v2",
    event_hash: "\\xaa",
    previous_event_hash: "\\xbb",
    payload_nonce: "\\xcc",
    payload_ciphertext: "\\xdd",
    aad_version: 2,
    occurred_at: "2026-07-26T15:00:00.000Z",
  });
});

test("coordinator pulls an encrypted page into the native inbox and advances its cursor", async () => {
  const local = localFixture();
  local.getSyncStatus = async () => ({
    enabled: true,
    cloudVaultId: "11111111-1111-4111-8111-111111111111",
    lastInboundReceivedAt: "2026-07-26T15:00:00.000Z",
    lastInboundEventId: "22222222-2222-4222-8222-222222222222",
  });
  const remoteCalls = [];
  const coordinator = new EncryptedSyncCoordinator({
    localRepository: local,
    remoteClient: {
      async bootstrapEncryptedVault() {},
      async appendEncryptedEvent() {},
      async pullEncryptedEvents(request) {
        remoteCalls.push(request);
        return {
          events: [{
            event_id: "33333333-3333-4333-8333-333333333333",
            event_kind: "account_snapshot",
            payload_ciphertext: "\\xaa",
          }],
          cursor: {
            receivedAt: "2026-07-26T15:01:00.000Z",
            eventId: "33333333-3333-4333-8333-333333333333",
          },
        };
      },
    },
  });
  const result = await coordinator.pull({ batchSize: 40 });
  assert.equal(result.received, 1);
  assert.equal(result.appliedCount, 1);
  assert.equal(remoteCalls[0].limit, 40);
  const application = local.calls.find(([kind]) => kind === "apply");
  assert.equal(application[1].cursorEventId, "33333333-3333-4333-8333-333333333333");
  assert.equal(application[1].events[0].event_kind, "account_snapshot");
});

test("Supabase device listing returns only minimal camelCase device metadata", async () => {
  const calls = [];
  const query = {
    select(columns) {
      calls.push(["select", columns]);
      return this;
    },
    eq(column, value) {
      calls.push(["eq", column, value]);
      return this;
    },
    async order(column, options) {
      calls.push(["order", column, options]);
      return {
        data: [{
          id: "device-a",
          platform: "macos",
          created_at: "2026-07-27T00:00:00.000Z",
          last_seen_at: "2026-07-27T01:00:00.000Z",
          revoked_at: null,
        }],
        error: null,
      };
    },
  };
  const remote = createSupabaseSyncClient({
    from(table) {
      calls.push(["from", table]);
      return query;
    },
  });
  const devices = await remote.listEncryptedVaultDevices({ vaultId: "vault-a" });
  assert.deepEqual(devices, [{
    id: "device-a",
    platform: "macos",
    createdAt: "2026-07-27T00:00:00.000Z",
    lastSeenAt: "2026-07-27T01:00:00.000Z",
    revokedAt: null,
  }]);
  assert.deepEqual(calls, [
    ["from", "devices"],
    ["select", "id,platform,created_at,last_seen_at,revoked_at"],
    ["eq", "vault_id", "vault-a"],
    ["order", "created_at", { ascending: true }],
  ]);
  assert.equal(JSON.stringify(devices).includes("public_key"), false);
});
