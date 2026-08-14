import assert from "node:assert/strict";
import test from "node:test";
import {
  AppLockController,
  DEFAULT_AUTOMATIC_LOCK_ENABLED,
  DEFAULT_IDLE_TIMEOUT_MS,
  UnlockRateLimitError,
} from "../src/security/appLock.js";

test("customer demo workspace disables automatic locking by default", () => {
  assert.equal(DEFAULT_AUTOMATIC_LOCK_ENABLED, false);
  assert.equal(DEFAULT_IDLE_TIMEOUT_MS, 30 * 60 * 1000);
});

function setup({ shouldFail = false } = {}) {
  let now = 1_000_000;
  const calls = [];
  const adapter = {
    async create(request) {
      calls.push(["create", request]);
      if (shouldFail) throw new Error("Creation failed.");
      return { vaultId: request.vaultId, sessionId: "native-session-created" };
    },
    async unlock(request) {
      calls.push(["unlock", request]);
      if (shouldFail) throw new Error("Authentication failed.");
      return { sessionId: "native-session-1" };
    },
    async lock(request) {
      calls.push(["lock", request]);
    },
    async status() {
      return { status: "locked" };
    },
  };
  const controller = new AppLockController({
    adapter,
    clock: () => now,
    idleTimeoutMs: 10_000,
  });
  return {
    calls,
    controller,
    advance: (milliseconds) => { now += milliseconds; },
  };
}

test("creating a vault installs only the returned native session handle", async () => {
  const { calls, controller } = setup();
  const created = await controller.createVault({
    vaultId: "primary",
    displayName: "被子beizi",
    baseCurrency: "cny",
    password: "correct horse battery staple",
  });

  assert.equal(created.status, "unlocked");
  assert.equal(created.vaultId, "primary");
  assert.equal(created.sessionId, "native-session-created");
  assert.equal("password" in created, false);
  assert.deepEqual(calls[0], [
    "create",
    {
      vaultId: "primary",
      displayName: "被子beizi",
      baseCurrency: "CNY",
      password: "correct horse battery staple",
    },
  ]);
});

test("app starts locked and stores only a native session handle after unlock", async () => {
  const { calls, controller } = setup();
  assert.equal(controller.snapshot().status, "locked");

  const unlocked = await controller.unlock({
    vaultId: "vault-1",
    method: "biometric",
  });
  assert.equal(unlocked.status, "unlocked");
  assert.equal(unlocked.sessionId, "native-session-1");
  assert.equal("password" in unlocked, false);
  assert.deepEqual(calls[0], [
    "unlock",
    { vaultId: "vault-1", method: "biometric", password: undefined },
  ]);
});

test("idle and background transitions fail closed", async () => {
  const { calls, controller, advance } = setup();
  await controller.unlock({ vaultId: "vault-1", method: "biometric" });
  advance(10_000);
  const idle = await controller.checkIdle();
  assert.equal(idle.status, "locked");
  assert.equal(idle.lockReason, "idle_timeout");
  assert.equal(calls.at(-1)[0], "lock");

  await controller.unlock({ vaultId: "vault-1", method: "biometric" });
  const backgrounded = await controller.handleBackgrounded();
  assert.equal(backgrounded.status, "locked");
  assert.equal(backgrounded.lockReason, "backgrounded");
});

test("manual lock closes only the current session and allows the same vault to reopen", async () => {
  const { calls, controller } = setup();
  await controller.unlock({ vaultId: "vault-1", method: "biometric" });
  const locked = await controller.lock("manual");
  assert.equal(locked.status, "locked");
  assert.equal(locked.lockReason, "manual");
  assert.deepEqual(calls.at(-1), ["lock", { sessionId: "native-session-1" }]);

  const reopened = await controller.unlock({ vaultId: "vault-1", method: "biometric" });
  assert.equal(reopened.status, "unlocked");
  assert.equal(reopened.vaultId, "vault-1");
});

test("failed unlocks are rate limited", async () => {
  const { controller } = setup({ shouldFail: true });
  await assert.rejects(
    controller.unlock({ vaultId: "vault-1", method: "password", password: "wrong" }),
    /Authentication failed/,
  );
  await assert.rejects(
    controller.unlock({ vaultId: "vault-1", method: "password", password: "wrong" }),
    UnlockRateLimitError,
  );
});

test("a natively restored vault installs only its session handle", () => {
  const controller = new AppLockController({
    adapter: {
      unlock: async () => ({ sessionId: "unused" }),
      lock: async () => {},
      status: async () => ({ status: "locked" }),
    },
    clock: () => 1_000,
  });
  const state = controller.acceptRestoredVault("primary-restored", {
    vaultId: "primary-restored",
    sessionId: "restored-session",
    databaseKey: "must-not-be-stored",
  });
  assert.equal(state.status, "unlocked");
  assert.equal(state.vaultId, "primary-restored");
  assert.equal(state.sessionId, "restored-session");
  assert.equal("databaseKey" in state, false);
});
