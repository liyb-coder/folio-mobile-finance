import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Eye,
  EyeSlash,
  Fingerprint,
  Key,
  LockKey,
  ShieldCheck,
  Warning,
} from "@phosphor-icons/react";
import {
  canUsePasskeys,
  createSupabaseAuthClient,
  presentAuthError,
  WebAuthController,
} from "./supabaseAuth.js";
import {
  WEB_SESSION_IDLE_MS,
  WebSessionGuard,
} from "./webSessionGuard.js";

function Brand() {
  return (
    <div className="vault-brand">
      <img src="/assets/brand/folio-logo.png" alt="" />
      <span><b>Folio</b><small>私人财务驾驶舱</small></span>
    </div>
  );
}

export function WebIdentityGate({ config, children }) {
  const controller = useMemo(
    () => new WebAuthController(createSupabaseAuthClient(config)),
    [config],
  );
  const passkeyAvailable = canUsePasskeys(config);
  const [authState, setAuthState] = useState({ status: "checking", session: null });
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    controller.start((next) => {
      if (active) setAuthState(next);
    }).then((cleanup) => {
      if (active) unsubscribe = cleanup;
      else cleanup();
    }).catch((startError) => {
      if (active) {
        setError(presentAuthError(startError));
        setAuthState({ status: "signed_out", session: null });
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [controller]);

  useEffect(() => {
    if (authState.status !== "authenticated" || !authState.session) return undefined;
    const guard = new WebSessionGuard({
      timeoutMs: WEB_SESSION_IDLE_MS,
      onExpire: () => {
        setAuthState({ status: "signed_out", session: null });
        setNotice("已因 15 分钟无活动安全退出，请重新验证。");
        controller.signOut().catch(() => {
          // The UI remains fail-closed even if the remote sign-out request fails.
        });
      },
    });
    guard.start(window);
    return () => guard.stop();
  }, [authState.session, authState.status, controller]);

  const submitPassword = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "signup") {
        const result = await controller.signUpWithPassword({ email, password });
        if (result.needsEmailConfirmation) {
          setNotice("账户已创建。请完成邮箱确认后再登录。");
          setMode("signin");
          setPassword("");
        }
      } else {
        await controller.signInWithPassword({ email, password });
        setPassword("");
      }
    } catch (submitError) {
      setError(presentAuthError(submitError));
    } finally {
      setBusy(false);
    }
  };

  const submitPasskey = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await controller.signInWithPasskey();
    } catch (passkeyError) {
      setError(presentAuthError(passkeyError));
    } finally {
      setBusy(false);
    }
  };

  if (authState.status === "checking") {
    return <div className="vault-loading"><Brand /><span /><p>正在验证 Web 安全会话…</p></div>;
  }
  if (authState.status === "authenticated" && authState.session) {
    return children({
      session: authState.session,
      authController: controller,
      passkeyAvailable,
    });
  }

  return (
    <main className="vault-gate web-auth-gate">
      <section className="vault-story">
        <Brand />
        <div className="vault-story-copy">
          <span className="vault-kicker"><ShieldCheck weight="duotone" /> WEB 安全访问</span>
          <h1>身份登录，只打开云端边界。</h1>
          <p>云端身份、当前设备解锁和财务数据解密是三层独立保护。登录成功不代表服务器能够读取你的账户与流水明文。</p>
          <div className="vault-promises">
            <div><LockKey weight="duotone" /><span><b>短期内存会话</b><small>浏览器不持久保存刷新令牌，关闭页面即清除。</small></span></div>
            <div><Fingerprint weight="duotone" /><span><b>通行密钥渐进启用</b><small>仅在 HTTPS 与已锁定 RP 域名下开放。</small></span></div>
            <div><Key weight="duotone" /><span><b>客户端加密</b><small>财务事件上传前完成 XChaCha20-Poly1305 加密。</small></span></div>
          </div>
        </div>
        <div className="vault-story-foot"><ShieldCheck /> 发布密钥不是安全边界 · 权限由 RLS 与客户端加密共同约束</div>
      </section>

      <section className="vault-entry">
        <div className="vault-mobile-brand"><Brand /></div>
        <div className="vault-auth-card">
          <div className="vault-auth-icon"><LockKey weight="duotone" /></div>
          <span className="vault-auth-eyebrow">{mode === "signup" ? "创建安全身份" : "安全身份验证"}</span>
          <h2>{mode === "signup" ? "创建 Folio 账户" : "登录 Folio"}</h2>
          <p>{mode === "signup" ? "账户只用于身份和设备授权，不会获得财务明文。" : "查看真实同步数据前，必须先验证密码或通行密钥。"}</p>
          <form className="vault-form compact" onSubmit={submitPassword}>
            <label>
              <span>邮箱</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                required
              />
            </label>
            <label className="vault-password-field">
              <span>密码</span>
              <div>
                <Key />
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={mode === "signup" ? "至少 12 位，含大小写字母与数字" : "输入账户密码"}
                  required
                />
                <button
                  type="button"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? <EyeSlash /> : <Eye />}
                </button>
              </div>
            </label>
            {error && <div className="vault-error" role="alert"><Warning />{error}</div>}
            {notice && <div className="web-auth-notice" role="status"><ShieldCheck />{notice}</div>}
            <button className="vault-primary" type="submit" disabled={busy}>
              {mode === "signup" ? "创建账户" : "使用密码登录"} <ArrowRight />
            </button>
          </form>
          {passkeyAvailable && mode === "signin" && (
            <>
              <div className="vault-divider"><span>或</span></div>
              <button className="vault-touch-button web-passkey-button" type="button" onClick={submitPasskey} disabled={busy}>
                <Fingerprint weight="duotone" />
                <span><b>使用通行密钥</b><small>通过系统生物识别、设备 PIN 或安全密钥验证。</small></span>
                <ArrowRight />
              </button>
            </>
          )}
          <button
            className="web-auth-switch"
            type="button"
            onClick={() => {
              setMode((current) => current === "signin" ? "signup" : "signin");
              setError("");
              setNotice("");
              setPassword("");
            }}
          >
            {mode === "signin" ? "第一次使用？创建安全身份" : "已有账户？返回登录"}
          </button>
          <div className="vault-auth-foot"><ShieldCheck /> 15 分钟无活动自动退出 · 敏感操作要求重新认证</div>
        </div>
      </section>
    </main>
  );
}
