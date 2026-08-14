import {
  createSupabaseAuthClient,
  presentAuthError,
  WebAuthController,
} from "../auth/supabaseAuth.js";
import { EncryptedSyncCoordinator } from "./syncCoordinator.js";
import { createSupabaseSyncClient } from "./supabaseSync.js";

function assertMethod(target, method, label) {
  if (typeof target?.[method] !== "function") {
    throw new TypeError(`${label} must implement ${method}().`);
  }
}

function safeIdentity(session) {
  const id = typeof session?.user?.id === "string" ? session.user.id : "";
  if (!id) return null;
  return Object.freeze({
    id,
    email: typeof session.user.email === "string" ? session.user.email : "",
  });
}

export function isNativeSyncConfigured(config) {
  return Boolean(config?.supabaseUrl && config?.supabasePublishableKey);
}

export function presentNativeSyncError(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  if (/different cloud identity/i.test(message)) {
    return "这份数据已绑定其他云端身份。请登录原身份，不要尝试覆盖绑定。";
  }
  if (/explicit confirmation/i.test(message)) {
    return "请先勾选确认，Folio 不会默认开启或关闭云端同步。";
  }
  if (/must be authenticated|identity session/i.test(message)) {
    return "云端身份会话已失效，请重新登录后再操作。";
  }
  if (/not configured|尚未配置|supabase/i.test(message)) {
    return "当前安装包尚未配置 Folio 云端服务；本地数据仍可正常使用。";
  }
  if (/network|fetch|offline|timeout/i.test(message)) {
    return "暂时无法连接同步服务。本地数据没有丢失，请检查网络后重试。";
  }
  if (/idempotency collision|reconciliation/i.test(message)) {
    return "发现需要人工核对的同步冲突；Folio 已停止覆盖相关记录。";
  }
  return "无法完成加密同步操作。本地数据保持不变，请稍后重试。";
}

export class NativeSyncController {
  #auth;
  #coordinator;
  #local;
  #remote;
  #session = null;
  #onAuthChange = null;

  constructor({
    authController,
    coordinator,
    localRepository,
    remoteClient = null,
  }) {
    for (const method of [
      "start",
      "signInWithPassword",
      "signUpWithPassword",
      "signOut",
    ]) {
      assertMethod(authController, method, "Cloud identity controller");
    }
    for (const method of ["enable", "synchronize", "disable"]) {
      assertMethod(coordinator, method, "Encrypted sync coordinator");
    }
    assertMethod(localRepository, "getSyncStatus", "Local encrypted repository");
    if (remoteClient) {
      assertMethod(remoteClient, "listEncryptedVaultDevices", "Remote encrypted sync client");
    }
    this.#auth = authController;
    this.#coordinator = coordinator;
    this.#local = localRepository;
    this.#remote = remoteClient;
  }

  #authSnapshot(status = this.#session ? "authenticated" : "signed_out") {
    return Object.freeze({
      status,
      user: safeIdentity(this.#session),
    });
  }

  #emit(status) {
    const snapshot = this.#authSnapshot(status);
    this.#onAuthChange?.(snapshot);
    return snapshot;
  }

  async start(onChange) {
    if (typeof onChange !== "function") {
      throw new TypeError("Native sync auth callback is required.");
    }
    this.#onAuthChange = onChange;
    onChange(this.#authSnapshot("checking"));
    const stop = await this.#auth.start((next) => {
      this.#session = next?.session ?? null;
      this.#emit(next?.status ?? (this.#session ? "authenticated" : "signed_out"));
    });
    return () => {
      if (this.#onAuthChange === onChange) this.#onAuthChange = null;
      stop?.();
    };
  }

  async signInWithPassword(credentials) {
    const result = await this.#auth.signInWithPassword(credentials);
    this.#session = result?.session ?? null;
    return this.#emit();
  }

  async signUpWithPassword(credentials) {
    const result = await this.#auth.signUpWithPassword(credentials);
    this.#session = result?.session ?? null;
    this.#emit();
    return Object.freeze({
      needsEmailConfirmation: Boolean(result?.needsEmailConfirmation),
      authenticated: Boolean(this.#session),
    });
  }

  async signOut() {
    try {
      await this.#auth.signOut();
    } finally {
      this.#session = null;
      this.#emit("signed_out");
    }
    return this.#authSnapshot("signed_out");
  }

  async getStatus() {
    return this.#local.getSyncStatus();
  }

  async listDevices() {
    if (!safeIdentity(this.#session)) {
      throw new Error("Cloud identity session must be authenticated before listing devices.");
    }
    if (!this.#remote) {
      throw new Error("Encrypted device listing is unavailable.");
    }
    const status = await this.#local.getSyncStatus();
    if (!status?.enabled || !status?.cloudVaultId) {
      return [];
    }
    return this.#remote.listEncryptedVaultDevices({
      vaultId: status.cloudVaultId,
    });
  }

  async enable({ confirmedByUser = false, platform = "macos" } = {}) {
    if (!confirmedByUser) {
      throw new Error("Enabling cloud sync requires explicit confirmation.");
    }
    const cloudUserId = safeIdentity(this.#session)?.id;
    if (!cloudUserId) {
      throw new Error("Cloud identity session must be authenticated before enabling sync.");
    }
    return this.#coordinator.enable({ cloudUserId, platform });
  }

  async synchronize({ batchSize = 250 } = {}) {
    if (!safeIdentity(this.#session)) {
      throw new Error("Cloud identity session must be authenticated before synchronizing.");
    }
    return this.#coordinator.synchronize({ batchSize });
  }

  async disable({ confirmedByUser = false } = {}) {
    if (!confirmedByUser) {
      throw new Error("Disabling cloud sync requires explicit confirmation.");
    }
    return this.#coordinator.disable();
  }
}

export function createNativeSyncController({
  config,
  localRepository,
  createClientImpl,
}) {
  if (!isNativeSyncConfigured(config)) {
    throw new Error("Encrypted sync is not configured.");
  }
  const client = createSupabaseAuthClient(config, createClientImpl);
  const authController = new WebAuthController(client);
  const remoteClient = createSupabaseSyncClient(client);
  const coordinator = new EncryptedSyncCoordinator({
    localRepository,
    remoteClient,
  });
  return new NativeSyncController({
    authController,
    coordinator,
    localRepository,
    remoteClient,
  });
}

export { presentAuthError };
