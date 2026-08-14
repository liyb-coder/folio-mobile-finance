import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKGROUND_LOCK_GRACE_MS,
  createBackgroundLockGuard,
} from "../src/security/backgroundLockGuard.js";

function setup() {
  let nextTimerId = 1;
  const timers = new Map();
  const locks = [];
  const guard = createBackgroundLockGuard({
    onLock: (reason) => locks.push(reason),
    setTimer(callback, delay) {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, { callback, delay });
      return timerId;
    },
    clearTimer(timerId) {
      timers.delete(timerId);
    },
  });

  return {
    guard,
    locks,
    timers,
    firePending() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach(({ callback }) => callback());
    },
  };
}

test("transient focus loss during unlock does not relock the workspace", () => {
  const { firePending, guard, locks, timers } = setup();
  guard.activate("session-1");
  guard.setBackgrounded("native-window-focus", true);

  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, BACKGROUND_LOCK_GRACE_MS);

  guard.setBackgrounded("native-window-focus", false);
  firePending();
  assert.deepEqual(locks, []);
});

test("a sustained background transition locks after the grace period", () => {
  const { firePending, guard, locks } = setup();
  guard.activate("session-1");
  guard.setBackgrounded("native-window-focus", true);
  firePending();
  assert.deepEqual(locks, ["backgrounded"]);
});

test("a stale background callback cannot lock a newer session", () => {
  let pendingCallback;
  const locks = [];
  const guard = createBackgroundLockGuard({
    onLock: (reason) => locks.push(reason),
    setTimer(callback) {
      pendingCallback = callback;
      return 1;
    },
    clearTimer() {},
  });

  guard.activate("session-1");
  guard.setBackgrounded("native-window-focus", true);
  guard.activate("session-2");
  pendingCallback();

  assert.deepEqual(locks, []);
});

test("remaining background sources still require a lock", () => {
  const { firePending, guard, locks } = setup();
  guard.activate("session-1");
  guard.setBackgrounded("native-window-focus", true);
  guard.setBackgrounded("document-visibility", true);
  guard.setBackgrounded("native-window-focus", false);
  firePending();

  assert.deepEqual(locks, ["backgrounded"]);
});
