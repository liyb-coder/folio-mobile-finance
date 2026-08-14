import assert from "node:assert/strict";
import test from "node:test";
import {
  WEB_SESSION_IDLE_MS,
  WebSessionGuard,
} from "../src/auth/webSessionGuard.js";

function fakeTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    removeEventListener(name, listener) {
      if (listeners.get(name) === listener) listeners.delete(name);
    },
  };
}

test("web identity session expires after fifteen minutes of inactivity", () => {
  const scheduled = [];
  const cleared = [];
  let expired = 0;
  const target = fakeTarget();
  const guard = new WebSessionGuard({
    onExpire: () => { expired += 1; },
    setTimeoutImpl(callback, delay) {
      const token = { callback, delay };
      scheduled.push(token);
      return token;
    },
    clearTimeoutImpl(token) {
      cleared.push(token);
    },
  });

  guard.start(target);
  assert.equal(scheduled[0].delay, WEB_SESSION_IDLE_MS);
  assert.equal(WEB_SESSION_IDLE_MS, 15 * 60 * 1000);
  target.listeners.get("keydown")();
  assert.equal(cleared.length, 1);
  assert.equal(scheduled.length, 2);
  scheduled.at(-1).callback();
  assert.equal(expired, 1);
  guard.stop();
  assert.equal(target.listeners.size, 0);
});

test("web session guard rejects unsafe timeout and target inputs", () => {
  assert.throws(
    () => new WebSessionGuard({ onExpire() {}, timeoutMs: 5_000 }),
    /at least one minute/,
  );
  const guard = new WebSessionGuard({ onExpire() {} });
  assert.throws(() => guard.start({}), /event target/);
});
