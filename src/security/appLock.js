const UNLOCK_METHODS = Object.freeze(["biometric", "password", "passkey"]);
export const DEFAULT_AUTOMATIC_LOCK_ENABLED = false;
export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export class UnlockRateLimitError extends Error {
  constructor(retryAt) {
    super(`Unlock is temporarily rate limited until ${new Date(retryAt).toISOString()}.`);
    this.name = "UnlockRateLimitError";
    this.retryAt = retryAt;
  }
}

function assertVaultAdapter(adapter) {
  for (const method of ["unlock", "lock", "status"]) {
    if (typeof adapter?.[method] !== "function") {
      throw new TypeError(`Vault adapter must implement ${method}().`);
    }
  }
  return adapter;
}

export class AppLockController {
  #adapter;
  #clock;
  #idleTimeoutMs;
  #state;

  #installSession(vaultId, result) {
    if (!result || typeof result.sessionId !== "string" || !result.sessionId) {
      throw new Error("Vault adapter did not return a valid session.");
    }
    const unlockedAt = this.#clock();
    this.#state = {
      status: "unlocked",
      vaultId,
      sessionId: result.sessionId,
      unlockedAt,
      lastActivityAt: unlockedAt,
      failedAttempts: 0,
      retryAt: null,
      lockReason: null,
    };
    return this.snapshot();
  }

  constructor({
    adapter,
    clock = () => Date.now(),
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  }) {
    if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs < 10_000) {
      throw new RangeError("idleTimeoutMs must be an integer of at least 10 seconds.");
    }
    this.#adapter = assertVaultAdapter(adapter);
    this.#clock = clock;
    this.#idleTimeoutMs = idleTimeoutMs;
    this.#state = {
      status: "locked",
      vaultId: null,
      sessionId: null,
      unlockedAt: null,
      lastActivityAt: null,
      failedAttempts: 0,
      retryAt: null,
      lockReason: "startup",
    };
  }

  snapshot() {
    return structuredClone(this.#state);
  }

  async createVault({ vaultId, displayName, baseCurrency, password }) {
    if (typeof this.#adapter.create !== "function") {
      throw new TypeError("Vault adapter must implement create().");
    }
    if (typeof vaultId !== "string" || !vaultId.trim()) {
      throw new TypeError("vaultId is required.");
    }
    if (typeof displayName !== "string" || !displayName.trim()) {
      throw new TypeError("displayName is required.");
    }
    if (typeof baseCurrency !== "string" || !baseCurrency.trim()) {
      throw new TypeError("baseCurrency is required.");
    }
    if (typeof password !== "string" || password.length < 12) {
      throw new TypeError("Vault password must contain at least 12 characters.");
    }

    this.#state = { ...this.#state, status: "creating" };
    try {
      const normalizedVaultId = vaultId.trim();
      const result = await this.#adapter.create({
        vaultId: normalizedVaultId,
        displayName: displayName.trim(),
        baseCurrency: baseCurrency.trim().toUpperCase(),
        password,
      });
      return this.#installSession(normalizedVaultId, result);
    } catch (error) {
      this.#state = {
        ...this.#state,
        status: "locked",
        sessionId: null,
        unlockedAt: null,
        lastActivityAt: null,
        lockReason: "create_failed",
      };
      throw error;
    }
  }

  async unlock({ vaultId, method, password }) {
    const now = this.#clock();
    if (this.#state.retryAt && now < this.#state.retryAt) {
      throw new UnlockRateLimitError(this.#state.retryAt);
    }
    if (!UNLOCK_METHODS.includes(method)) {
      throw new TypeError(`Unlock method must be one of: ${UNLOCK_METHODS.join(", ")}.`);
    }
    if (typeof vaultId !== "string" || !vaultId.trim()) {
      throw new TypeError("vaultId is required.");
    }
    if (method === "password" && (typeof password !== "string" || !password)) {
      throw new TypeError("Password unlock requires a password.");
    }

    this.#state.status = "unlocking";
    try {
      const result = await this.#adapter.unlock({
        vaultId: vaultId.trim(),
        method,
        password: method === "password" ? password : undefined,
      });
      return this.#installSession(vaultId.trim(), result);
    } catch (error) {
      const failedAttempts = this.#state.failedAttempts + 1;
      const delay = Math.min(300_000, 1000 * (2 ** (failedAttempts - 1)));
      this.#state = {
        ...this.#state,
        status: "locked",
        sessionId: null,
        unlockedAt: null,
        lastActivityAt: null,
        failedAttempts,
        retryAt: now + delay,
        lockReason: "unlock_failed",
      };
      throw error;
    }
  }

  acceptRestoredVault(vaultId, result) {
    if (typeof vaultId !== "string" || !vaultId.trim()) {
      throw new TypeError("Restored vaultId is required.");
    }
    return this.#installSession(vaultId.trim(), result);
  }

  recordActivity() {
    if (this.#state.status === "unlocked") {
      this.#state.lastActivityAt = this.#clock();
    }
    return this.snapshot();
  }

  async checkIdle() {
    if (
      this.#state.status === "unlocked"
      && this.#clock() - this.#state.lastActivityAt >= this.#idleTimeoutMs
    ) {
      await this.lock("idle_timeout");
    }
    return this.snapshot();
  }

  async handleBackgrounded() {
    if (this.#state.status === "unlocked") {
      await this.lock("backgrounded");
    }
    return this.snapshot();
  }

  async lock(reason = "manual") {
    if (this.#state.status === "unlocked") {
      await this.#adapter.lock({ sessionId: this.#state.sessionId });
    }
    this.#state = {
      ...this.#state,
      status: "locked",
      sessionId: null,
      unlockedAt: null,
      lastActivityAt: null,
      lockReason: reason,
    };
    return this.snapshot();
  }
}

export { UNLOCK_METHODS, assertVaultAdapter };
