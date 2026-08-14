export const BACKGROUND_LOCK_GRACE_MS = 2_000;

export function createBackgroundLockGuard({
  onLock,
  graceMs = BACKGROUND_LOCK_GRACE_MS,
  setTimer = (callback, delay) => window.setTimeout(callback, delay),
  clearTimer = (timerId) => window.clearTimeout(timerId),
}) {
  if (typeof onLock !== "function") {
    throw new TypeError("onLock must be a function.");
  }
  if (!Number.isInteger(graceMs) || graceMs < 0) {
    throw new RangeError("graceMs must be a non-negative integer.");
  }

  let activeSessionId = null;
  let pendingTimer = null;
  const backgroundSources = new Set();

  const cancelPendingLock = () => {
    if (pendingTimer !== null) {
      clearTimer(pendingTimer);
      pendingTimer = null;
    }
  };

  const scheduleLock = () => {
    if (!activeSessionId || pendingTimer !== null || backgroundSources.size === 0) return;
    const scheduledSessionId = activeSessionId;
    pendingTimer = setTimer(() => {
      pendingTimer = null;
      if (
        activeSessionId === scheduledSessionId
        && backgroundSources.size > 0
      ) {
        void onLock("backgrounded");
      }
    }, graceMs);
  };

  return {
    activate(sessionId) {
      if (typeof sessionId !== "string" || !sessionId) {
        throw new TypeError("An unlocked sessionId is required.");
      }
      cancelPendingLock();
      backgroundSources.clear();
      activeSessionId = sessionId;
    },

    setBackgrounded(source, backgrounded) {
      if (!activeSessionId) return;
      if (typeof source !== "string" || !source) {
        throw new TypeError("A background source is required.");
      }

      if (backgrounded) {
        backgroundSources.add(source);
        scheduleLock();
        return;
      }

      backgroundSources.delete(source);
      if (backgroundSources.size === 0) cancelPendingLock();
    },

    deactivate() {
      cancelPendingLock();
      backgroundSources.clear();
      activeSessionId = null;
    },
  };
}
