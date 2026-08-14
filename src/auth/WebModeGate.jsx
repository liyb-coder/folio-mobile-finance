import { useState } from "react";
import {
  ArrowRight,
  Flask,
  LockKey,
  ShieldCheck,
  Warning,
} from "@phosphor-icons/react";

function Brand() {
  return (
    <div className="vault-brand">
      <img src="/assets/brand/folio-logo.png" alt="" />
      <span><b>Folio</b><small>私人财务驾驶舱</small></span>
    </div>
  );
}

export function LockedWebGate({ localMode = false }) {
  return (
    <main className="vault-gate web-mode-gate">
      <section className="vault-story">
        <Brand />
        <div className="vault-story-copy">
          <span className="vault-kicker"><ShieldCheck weight="duotone" /> 默认安全关闭</span>
          <h1>没有明确的数据模式，就不展示任何财务界面。</h1>
          <p>Folio 不会把配置错误降级成公开 Demo，也不会让浏览器假装获得本机数据权限。</p>
        </div>
        <div className="vault-story-foot"><ShieldCheck /> 私人数据入口必须经过密码、通行密钥或原生生物识别</div>
      </section>
      <section className="vault-entry">
        <div className="vault-mobile-brand"><Brand /></div>
        <div className="vault-auth-card web-mode-card">
          <div className="vault-auth-icon"><LockKey weight="duotone" /></div>
          <span className="vault-auth-eyebrow">WEB 已锁定</span>
          <h2>{localMode ? "本机数据不能由普通网页打开" : "尚未配置安全访问模式"}</h2>
          <p>{localMode
            ? "请使用 Folio macOS/iOS/Android 原生应用，以应用密码或系统生物识别解锁本机数据。"
            : "部署私人 Web 时必须配置 sync 模式和身份服务；公开演示必须单独显式启用。"}</p>
          <div className="web-mode-warning">
            <Warning weight="fill" />
            <span><b>没有回退数据</b><small>当前页面未加载账户、流水、事项或 AI 证据。</small></span>
          </div>
          <div className="vault-auth-foot"><ShieldCheck /> 失败关闭 · 不读取本机文件 · 不创建匿名会话</div>
        </div>
      </section>
    </main>
  );
}

export function PublicDemoGate({ children }) {
  const [entered, setEntered] = useState(false);
  if (entered) return children;

  return (
    <main className="vault-gate web-mode-gate">
      <section className="vault-story">
        <Brand />
        <div className="vault-story-copy">
          <span className="vault-kicker"><Flask weight="duotone" /> 公开产品演示</span>
          <h1>先确认边界，再进入虚构数据。</h1>
          <p>这个模式只用于查看交互和视觉效果。它没有登录身份、不会连接个人数据，也不能安全承载真实财务数据。</p>
        </div>
        <div className="vault-story-foot"><ShieldCheck /> 所有金额、机构、账户和事项均为虚构示例</div>
      </section>
      <section className="vault-entry">
        <div className="vault-mobile-brand"><Brand /></div>
        <div className="vault-auth-card web-mode-card">
          <div className="vault-auth-icon demo"><Flask weight="duotone" /></div>
          <span className="vault-auth-eyebrow">虚构演示数据</span>
          <h2>进入 Folio 虚构演示</h2>
          <p>请勿粘贴、上传或输入任何真实账户、流水、证件、密钥或个人信息。</p>
          <div className="web-mode-warning demo">
            <Flask weight="fill" />
            <span><b>演示数据不会保存</b><small>刷新页面即可恢复；真实数据只能进入受认证和加密保护的模式。</small></span>
          </div>
          <button className="vault-primary" type="button" onClick={() => setEntered(true)}>
            我明白，进入虚构演示 <ArrowRight />
          </button>
          <div className="vault-auth-foot"><ShieldCheck /> 此按钮不是登录，不能用于访问任何私人数据</div>
        </div>
      </section>
    </main>
  );
}
