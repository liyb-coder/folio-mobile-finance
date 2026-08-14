import assert from "node:assert/strict";
import test from "node:test";
import {
  isNativeSyncConfigured,
  NativeSyncController,
  presentNativeSyncError,
} from "../src/sync/nativeSyncController.js";

function fixture() {
  const calls = [];
  const session = {
    access_token: "must-never-be-returned",
    refresh_token: "must-never-be-returned",
    user: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      email: "owner@example.com",
    },
  };
  const auth = {
    async start(onChange) {
      calls.push(["start"]);
      onChange({ status: "signed_out", session: null });
      return () => calls.push(["stop"]);
    },
    async signInWithPassword(request) {
      calls.push(["signin", request]);
      return { session };
    },
    async signUpWithPassword(request) {
      calls.push(["signup", request]);
      return { session: null, needsEmailConfirmation: true };
    },
    async signOut() {
      calls.push(["signout"]);
    },
  };
  const coordinator = {
    async enable(request) {
      calls.push(["enable", request]);
      return { enabled: true, pendingCount: 0 };
    },
    async synchronize(request) {
      calls.push(["synchronize", request]);
      return {
        upload: { status: { enabled: true, pendingCount: 0 } },
        download: { status: { enabled: true, pendingCount: 0 } },
      };
    },
    async disable() {
      calls.push(["disable"]);
      return { enabled: false, pendingCount: 0 };
    },
  };
  const local = {
    async getSyncStatus() {
      calls.push(["status"]);
      return { enabled: false, pendingCount: 0 };
    },
  };
  return {
    calls,
    controller: new NativeSyncController({
      authController: auth,
      coordinator,
      localRepository: local,
    }),
  };
}

test("native sync remains unavailable until public cloud connection values exist", () => {
  assert.equal(isNativeSyncConfigured({}), false);
  assert.equal(isNativeSyncConfigured({
    supabaseUrl: "https://example.supabase.co",
    supabasePublishableKey: "",
  }), false);
  assert.equal(isNativeSyncConfigured({
    supabaseUrl: "https://example.supabase.co",
    supabasePublishableKey: "sb_publishable_test",
  }), true);
});

test("native sync requires both an authenticated identity and explicit enable confirmation", async () => {
  const { calls, controller } = fixture();
  await assert.rejects(
    controller.enable({ confirmedByUser: true }),
    /must be authenticated/,
  );
  const authState = await controller.signInWithPassword({
    email: "owner@example.com",
    password: "StrongPassword9",
  });
  assert.deepEqual(authState, {
    status: "authenticated",
    user: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      email: "owner@example.com",
    },
  });
  assert.equal(JSON.stringify(authState).includes("must-never-be-returned"), false);
  await assert.rejects(controller.enable(), /explicit confirmation/);

  const status = await controller.enable({ confirmedByUser: true });
  assert.equal(status.enabled, true);
  assert.deepEqual(calls.find(([kind]) => kind === "enable"), ["enable", {
    cloudUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    platform: "macos",
  }]);
  assert.equal(Object.hasOwn(controller, "password"), false);
  assert.equal(JSON.stringify(controller).includes("StrongPassword9"), false);
});

test("manual synchronization requires a live memory-only identity session", async () => {
  const { calls, controller } = fixture();
  await assert.rejects(controller.synchronize(), /must be authenticated/);
  await controller.signInWithPassword({
    email: "owner@example.com",
    password: "StrongPassword9",
  });
  await controller.synchronize({ batchSize: 80 });
  assert.deepEqual(calls.find(([kind]) => kind === "synchronize"), [
    "synchronize",
    { batchSize: 80 },
  ]);
  await controller.signOut();
  await assert.rejects(controller.synchronize(), /must be authenticated/);
});

test("stopping sync is explicit but does not require a cloud session", async () => {
  const { calls, controller } = fixture();
  await assert.rejects(controller.disable(), /explicit confirmation/);
  const status = await controller.disable({ confirmedByUser: true });
  assert.equal(status.enabled, false);
  assert.equal(calls.filter(([kind]) => kind === "disable").length, 1);
});

test("native sync errors are presented without leaking backend details", () => {
  assert.match(
    presentNativeSyncError(new Error("This vault is already bound to a different cloud identity.")),
    /原身份/,
  );
  assert.match(
    presentNativeSyncError(new Error("fetch failed: https://private.internal/token?secret=x")),
    /检查网络/,
  );
  assert.doesNotMatch(
    presentNativeSyncError(new Error("fetch failed: https://private.internal/token?secret=x")),
    /secret|private\.internal/,
  );
});

test("device listing is identity-gated and scoped to the bound encrypted vault", async () => {
  const calls = [];
  const session = {
    user: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      email: "owner@example.com",
    },
  };
  const controller = new NativeSyncController({
    authController: {
      async start() {
        return () => {};
      },
      async signInWithPassword() {
        return { session };
      },
      async signUpWithPassword() {
        return { session: null, needsEmailConfirmation: true };
      },
      async signOut() {},
    },
    coordinator: {
      async enable() {},
      async synchronize() {},
      async disable() {},
    },
    localRepository: {
      async getSyncStatus() {
        return { enabled: true, cloudVaultId: "vault-cloud" };
      },
    },
    remoteClient: {
      async listEncryptedVaultDevices(request) {
        calls.push(request);
        return [{ id: "device-a", platform: "macos" }];
      },
    },
  });
  await assert.rejects(controller.listDevices(), /must be authenticated/);
  await controller.signInWithPassword({
    email: "owner@example.com",
    password: "StrongPassword9",
  });
  assert.deepEqual(await controller.listDevices(), [{
    id: "device-a",
    platform: "macos",
  }]);
  assert.deepEqual(calls, [{ vaultId: "vault-cloud" }]);
});
