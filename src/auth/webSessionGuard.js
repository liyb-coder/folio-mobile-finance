export const WEB_SESSION_IDLE_MS = 15 * 60 * 1000;

const ACTIVITY_EVENTS = Object.freeze([
  "pointerdown",
  "keydown",
  "touchstart",
  "focus",
]);

export class WebSessionGuard {
  #onExpire;
  #timeoutMs;
  #setTimeout;
  #clearTimeout;
  #timer = null;
  #target = null;
  #expired = false;
  #recordActivity;

  constructor({
    onExpire,
    timeoutMs = WEB_SESSION_IDLE_MS,
    setTimeoutImpl = globalThis.setTimeout,
    clearTimeoutImpl = globalThis.clearTimeout,
  }) {
    if (typeof onExpire !== "function") {
      throw new TypeError("An inactivity expiration callback is required.");
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 60_000) {
      throw new TypeError("Web session idle timeout must be at least one minute.");
    }
    this.#onExpire = onExpire;
    this.#timeoutMs = timeoutMs;
    this.#setTimeout = setTimeoutImpl;
    this.#clearTimeout = clearTimeoutImpl;
    this.#recordActivity = () => this.recordActivity();
  }

  start(target = globalThis) {
    if (this.#target) return;
    if (
      typeof target?.addEventListener !== "function"
      || typeof target?.removeEventListener !== "function"
    ) {
      throw new TypeError("A browser event target is required.");
    }
    this.#target = target;
    this.#expired = false;
    for (const eventName of ACTIVITY_EVENTS) {
      target.addEventListener(eventName, this.#recordActivity, { passive: true });
    }
    this.#arm();
  }

  recordActivity() {
    if (!this.#target || this.#expired) return;
    this.#arm();
  }

  stop() {
    if (this.#timer !== null) {
      this.#clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (this.#target) {
      for (const eventName of ACTIVITY_EVENTS) {
        this.#target.removeEventListener(eventName, this.#recordActivity);
      }
      this.#target = null;
    }
  }

  #arm() {
    if (this.#timer !== null) this.#clearTimeout(this.#timer);
    this.#timer = this.#setTimeout(() => {
      this.#timer = null;
      this.#expired = true;
      this.#onExpire();
    }, this.#timeoutMs);
  }
}
