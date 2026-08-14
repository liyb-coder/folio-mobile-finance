import { createClient } from "@supabase/supabase-js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requiredText(value, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label}不能为空。`);
  return normalized;
}

export function validateEmail(value) {
  const email = requiredText(value, "邮箱");
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new Error("请输入有效的邮箱地址。");
  }
  return email.toLowerCase();
}

export function validateNewPassword(value) {
  const password = typeof value === "string" ? value : "";
  if (password.length < 12) {
    throw new Error("密码至少需要 12 位。");
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    throw new Error("密码需要同时包含大写字母、小写字母和数字。");
  }
  return password;
}

export function createSupabaseAuthClient(config, createClientImpl = createClient) {
  if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
    throw new Error("加密同步尚未配置 Supabase 公共连接信息。");
  }
  return createClientImpl(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: false,
      flowType: "pkce",
      experimental: {
        passkey: Boolean(config.passkeyAuthEnabled),
      },
    },
  });
}

export function canUsePasskeys(config, browser = globalThis) {
  if (!config?.passkeyAuthEnabled) return false;
  const location = browser?.location;
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(location?.hostname);
  const secureOrigin = browser?.isSecureContext === true || loopback;
  return secureOrigin && typeof browser?.PublicKeyCredential === "function";
}

export function presentAuthError(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  if (/rate|too many/i.test(message)) return "尝试次数过多，请稍后再试。";
  if (/email.*confirm/i.test(message)) return "请先完成邮箱确认，再登录 Folio。";
  if (/passkey|webauthn|credential/i.test(message)) {
    return "通行密钥验证未完成。你可以重试，或改用密码登录。";
  }
  if (/network|fetch|offline/i.test(message)) return "暂时无法连接身份服务，请检查网络后重试。";
  return "无法完成身份验证。请检查登录信息后重试。";
}

export class WebAuthController {
  #client;

  constructor(client) {
    if (!client?.auth) throw new TypeError("Supabase Auth client is required.");
    this.#client = client;
  }

  async start(onChange) {
    if (typeof onChange !== "function") throw new TypeError("Auth state callback is required.");
    const { data: subscriptionData } = this.#client.auth.onAuthStateChange(
      (_event, session) => onChange({ status: session ? "authenticated" : "signed_out", session }),
    );
    const { data, error } = await this.#client.auth.getSession();
    if (error) {
      subscriptionData?.subscription?.unsubscribe();
      throw error;
    }
    onChange({
      status: data?.session ? "authenticated" : "signed_out",
      session: data?.session ?? null,
    });
    return () => subscriptionData?.subscription?.unsubscribe();
  }

  async signInWithPassword({ email, password }) {
    const identity = validateEmail(email);
    const secret = requiredText(password, "密码");
    const { data, error } = await this.#client.auth.signInWithPassword({
      email: identity,
      password: secret,
    });
    if (error) throw error;
    if (!data?.session) throw new Error("Authentication did not create a session.");
    return data;
  }

  async signUpWithPassword({ email, password }) {
    const identity = validateEmail(email);
    const secret = validateNewPassword(password);
    const { data, error } = await this.#client.auth.signUp({
      email: identity,
      password: secret,
    });
    if (error) throw error;
    return {
      ...data,
      needsEmailConfirmation: !data?.session,
    };
  }

  async signInWithPasskey() {
    if (typeof this.#client.auth.signInWithPasskey !== "function") {
      throw new Error("Passkey authentication is unavailable.");
    }
    const { data, error } = await this.#client.auth.signInWithPasskey();
    if (error) throw error;
    if (!data?.session) throw new Error("Passkey authentication did not create a session.");
    return data;
  }

  async registerPasskey() {
    if (typeof this.#client.auth.registerPasskey !== "function") {
      throw new Error("Passkey registration is unavailable.");
    }
    const { data, error } = await this.#client.auth.registerPasskey();
    if (error) throw error;
    return data;
  }

  async signOut() {
    const { error } = await this.#client.auth.signOut({ scope: "local" });
    if (error) throw error;
  }
}
