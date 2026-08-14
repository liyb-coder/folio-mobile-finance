import { useState } from "react";
import {
  CheckCircle,
  CloudCheck,
  Database,
  Fingerprint,
  Key,
  SignOut,
  Warning,
} from "@phosphor-icons/react";
import { presentAuthError } from "../auth/supabaseAuth.js";

export function SyncWorkspace({
  session,
  authController,
  passkeyAvailable,
}) {
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const registerPasskey = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await authController.registerPasskey();
      setNotice("通行密钥已登记。下次可直接使用系统验证登录。");
    } catch (registrationError) {
      setError(presentAuthError(registrationError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="sync-onboarding">
      <header className="sync-onboarding-header">
        <div className="vault-brand">
          <img src="/assets/brand/folio-logo.png" alt="" />
          <span><b>Folio</b><small>加密同步控制台</small></span>
        </div>
        <button type="button" onClick={() => authController.signOut()}><SignOut />退出身份会话</button>
      </header>
      <section className="sync-onboarding-card">
        <span className="sync-onboarding-kicker"><CloudCheck /> 身份验证已通过</span>
        <h1>云端只能看见密文事件。</h1>
        <p className="sync-onboarding-email">{session.user?.email ?? "已验证账户"}</p>
        <div className="sync-security-grid">
          <article><CheckCircle /><span><b>身份层</b><small>Supabase Auth 会话仅保存在当前页面内存。</small></span></article>
          <article><Database /><span><b>数据层</b><small>RLS 以用户与数据空间 membership 隔离所有行。</small></span></article>
          <article><Key /><span><b>加密层</b><small>账户、流水、备注和附件元数据上传前在客户端加密。</small></span></article>
        </div>
        <div className="sync-next-step">
          <div><b>下一步：连接本机加密数据</b><small>同步仍是可选功能。尚未连接前，不会上传或改变任何本地数据。</small></div>
          <span>等待设备密钥登记</span>
        </div>
        {passkeyAvailable && (
          <button className="vault-primary sync-passkey-enroll" type="button" onClick={registerPasskey} disabled={busy}>
            <Fingerprint /> 为此账户登记通行密钥
          </button>
        )}
        {notice && <div className="web-auth-notice"><CheckCircle />{notice}</div>}
        {error && <div className="vault-error"><Warning />{error}</div>}
      </section>
    </main>
  );
}
