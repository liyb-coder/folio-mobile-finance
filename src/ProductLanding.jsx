import { useEffect } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  ChartLineUp,
  Check,
  CheckCircle,
  ClockCounterClockwise,
  Coins,
  Database,
  FileCsv,
  FileXls,
  Fingerprint,
  HouseLine,
  LockKey,
  Microphone,
  Monitor,
  Receipt,
  ShieldCheck,
  Sparkle,
  Table,
  Vault,
  Wallet,
} from "@phosphor-icons/react";
import "./product-landing.css";

const productModules = [
  {
    icon: Wallet,
    title: "资产总览",
    text: "账户与持仓分层组织，余额、产品表现和配置比例一眼可见。",
  },
  {
    icon: Receipt,
    title: "流水账本",
    text: "每一次确认都留下不可变记录，更正也以新的补偿记录完成。",
  },
  {
    icon: ChartLineUp,
    title: "配置规划",
    text: "把目标比例、可用现金和调整建议放在同一个决策视图里。",
  },
  {
    icon: Bell,
    title: "财务事项",
    text: "房租、保险、到期和闲置资金，都有清晰的下一步。",
  },
];

const securityItems = [
  {
    icon: Database,
    title: "真实数据留在本机",
    text: "账本与附件解析结果默认存储在你的 Mac，而不是公开服务。",
  },
  {
    icon: Fingerprint,
    title: "密码与 Touch ID 解锁",
    text: "生物识别由 macOS 完成，应用始终保留安全的密码回退方式。",
  },
  {
    icon: ClockCounterClockwise,
    title: "每一步都可追溯",
    text: "正式数据只在核对并确认后写入；历史记录不会被静默覆盖。",
  },
];

function BrandLockup() {
  return (
    <span className="folio-landing-brand">
      <img src="/assets/brand/folio-logo.png" alt="" />
      <span>
        <strong>Folio</strong>
        <small>个人财务驾驶舱</small>
      </span>
    </span>
  );
}

function HeroProductFrame() {
  return (
    <figure className="folio-product-frame" aria-label="Folio 资产总览界面示意">
      <div className="folio-window-bar">
        <span className="folio-window-dots" aria-hidden="true"><i /><i /><i /></span>
        <span>Folio · 资产总览</span>
        <span className="folio-demo-label">虚构演示数据</span>
      </div>
      <div className="folio-app-preview">
        <aside className="folio-preview-sidebar" aria-hidden="true">
          <img src="/assets/brand/folio-logo.png" alt="" />
          <span className="active"><HouseLine weight="fill" /></span>
          <span><Wallet weight="duotone" /></span>
          <span><Receipt weight="duotone" /></span>
          <span><ChartLineUp weight="duotone" /></span>
          <span><Bell weight="duotone" /></span>
          <img className="folio-preview-avatar" src="/assets/brand/folio-cat-avatar.png" alt="" />
        </aside>
        <div className="folio-preview-canvas">
          <div className="folio-preview-heading">
            <span><small>晚上好，被子</small><strong>你的财务，一切有序。</strong></span>
            <button type="button" tabIndex="-1">+ 添加账户</button>
          </div>
          <div className="folio-preview-grid">
            <section className="folio-networth-card">
              <span className="folio-card-kicker">净资产</span>
              <strong>¥ 1,286,430</strong>
              <span className="folio-rise"><ArrowUpRight weight="bold" /> 本月 3.8%</span>
              <div className="folio-line-chart" aria-hidden="true">
                <i className="seg s1" /><i className="seg s2" /><i className="seg s3" />
                <i className="seg s4" /><i className="seg s5" /><i className="seg s6" />
                <b className="dot d1" /><b className="dot d2" /><b className="dot d3" />
              </div>
              <div className="folio-card-foot"><span>活期可用</span><b>¥ 86,200</b></div>
            </section>
            <section className="folio-health-card">
              <span className="folio-card-kicker">配置健康度</span>
              <div className="folio-score-orbit"><strong>86</strong><small>稳健</small></div>
              <p><Sparkle weight="fill" /> 现金比例处于目标区间</p>
            </section>
            <section className="folio-account-card">
              <div className="folio-card-title"><span><small>主要账户</small><b>4 个账户</b></span><ArrowUpRight /></div>
              <div className="folio-account-row"><i className="lime"><Wallet /></i><span><b>日常账户</b><small>现金 · 活期</small></span><strong>¥ 86,200</strong></div>
              <div className="folio-account-row"><i className="purple"><Coins /></i><span><b>长期投资</b><small>基金 · 股票</small></span><strong>¥ 912,530</strong></div>
              <div className="folio-account-row"><i className="mint"><Vault /></i><span><b>稳健储备</b><small>定期 · 固收</small></span><strong>¥ 287,700</strong></div>
            </section>
            <section className="folio-todo-card">
              <div className="folio-card-title"><span><small>接下来</small><b>财务事项</b></span><Bell /></div>
              <div className="folio-todo-row"><i /><span><b>保险续费</b><small>8 月 15 日 · 提前 14 天</small></span></div>
              <div className="folio-todo-row"><i className="purple" /><span><b>检查闲置资金</b><small>本周五 · 每月复查</small></span></div>
            </section>
          </div>
          <div className="folio-voice-pill"><Microphone weight="fill" /><span>随时说出一笔变动，先解析，再核对</span><i /></div>
        </div>
      </div>
    </figure>
  );
}

function VoiceReviewVisual() {
  return (
    <div className="folio-voice-visual" aria-label="语音录入核对流程示意">
      <div className="folio-voice-prompt">
        <span className="folio-mic-orb"><Microphone weight="fill" /></span>
        <p>“从招商账户支出 680 元，家庭保险续费。”</p>
        <span className="folio-wave" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <i key={index} />)}</span>
      </div>
      <div className="folio-review-sheet">
        <div><span>识别为</span><b>支出记录</b><small>待核对</small></div>
        <dl>
          <dt>金额</dt><dd>¥ 680.00</dd>
          <dt>账户</dt><dd>招商账户</dd>
          <dt>分类</dt><dd>保险保障</dd>
        </dl>
        <button type="button" tabIndex="-1"><Check /> 核对后确认写入</button>
      </div>
    </div>
  );
}

export function ProductLanding() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Folio · 你的私密个人财务驾驶舱";
    return () => { document.title = previousTitle; };
  }, []);

  return (
    <div className="folio-marketing">
      <header className="folio-site-header">
        <a className="folio-brand-link" href="#top" aria-label="Folio 官网首页"><BrandLockup /></a>
        <nav aria-label="官网导航">
          <a href="#product">产品</a>
          <a href="#workflow">工作方式</a>
          <a href="#security">安全</a>
          <a href="#about">Mac 版</a>
        </nav>
        <a className="folio-header-cta" href="#about">了解 Mac 版 <ArrowUpRight /></a>
      </header>

      <main id="top">
        <section className="folio-hero">
          <div className="folio-ambient-shape one" aria-hidden="true" />
          <div className="folio-ambient-shape two" aria-hidden="true" />
          <div className="folio-hero-copy">
            <span className="folio-eyebrow"><i /> 为 Mac 打造 · 本地优先</span>
            <h1>你的财务，<br />应该只属于你。</h1>
            <p>Folio 把账户、持仓、流水、规划和提醒收进一个加密的本地财务空间。看清全局，也保留每一步的依据。</p>
            <div className="folio-hero-actions">
              <a className="folio-primary-action" href="#product">探索 Folio <ArrowRight weight="bold" /></a>
              <a className="folio-text-action" href="#security"><ShieldCheck weight="duotone" /> 了解安全设计</a>
            </div>
            <div className="folio-trust-row">
              <span><CheckCircle weight="fill" /> 本地加密数据</span>
              <span><CheckCircle weight="fill" /> Touch ID 解锁</span>
              <span><CheckCircle weight="fill" /> 可审计账本</span>
            </div>
          </div>
          <HeroProductFrame />
        </section>

        <section className="folio-intro-band" aria-label="产品定位">
          <p>不是又一个记账表格，而是一套属于你的财务操作系统。</p>
          <div>
            <span><strong>01</strong> 看见全貌</span>
            <span><strong>02</strong> 核对变动</span>
            <span><strong>03</strong> 留下依据</span>
          </div>
        </section>

        <section className="folio-section folio-product-section" id="product">
          <div className="folio-section-heading">
            <span className="folio-section-index">01 · 一个清晰的财务全景</span>
            <h2>钱在哪里，发生了什么，<br />下一步做什么。</h2>
            <p>把零散信息放回同一个上下文里。无需在银行 App、表格和备忘录之间来回拼凑。</p>
          </div>
          <div className="folio-module-grid">
            {productModules.map(({ icon: Icon, title, text }, index) => (
              <article className={index === 0 ? "featured" : ""} key={title}>
                <span className="folio-module-icon"><Icon weight="duotone" /></span>
                <span className="folio-module-number">0{index + 1}</span>
                <h3>{title}</h3>
                <p>{text}</p>
                {index === 0 && (
                  <div className="folio-holdings-visual" aria-hidden="true">
                    <div className="folio-holding-top"><span>资产配置</span><b>¥ 1,286,430</b></div>
                    <div className="folio-allocation-bar"><i /><i /><i /><i /></div>
                    <div className="folio-allocation-labels">
                      <span><i className="c1" />权益 42%</span><span><i className="c2" />现金 18%</span>
                      <span><i className="c3" />固收 26%</span><span><i className="c4" />其他 14%</span>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="folio-section folio-workflow-section" id="workflow">
          <div className="folio-workflow-copy">
            <span className="folio-section-index light">02 · 输入可以自然，确认必须严谨</span>
            <h2>说一句，贴一段，<br />然后认真核对。</h2>
            <p>语音、文件和表格都先变成可检查的草稿。Folio 不会根据一句模糊的话直接修改你的资产。</p>
            <ol>
              <li><span>1</span><div><b>解析</b><small>识别金额、账户、类型与时间</small></div></li>
              <li><span>2</span><div><b>核对</b><small>补齐缺失信息，发现冲突就停下</small></div></li>
              <li><span>3</span><div><b>确认</b><small>只有你明确确认后才写入正式记录</small></div></li>
            </ol>
          </div>
          <VoiceReviewVisual />
        </section>

        <section className="folio-section folio-import-section">
          <div className="folio-import-visual">
            <div className="folio-file-stack">
              <span className="folio-file-card csv"><FileCsv weight="duotone" /><b>cashflow.csv</b><small>流水记录 · 128 行</small></span>
              <span className="folio-file-card xls"><FileXls weight="duotone" /><b>holdings.xlsx</b><small>资产持仓 · 24 行</small></span>
              <span className="folio-file-card table"><Table weight="duotone" /><b>表格粘贴</b><small>Excel · Numbers · 飞书</small></span>
            </div>
            <div className="folio-import-result">
              <span><CheckCircle weight="fill" /> 已解析</span>
              <strong>152 条待核对记录</strong>
              <div><i /><i /><i /><i /><i /></div>
              <small>原始文本在生成核对草稿后释放</small>
            </div>
          </div>
          <div className="folio-section-heading compact">
            <span className="folio-section-index">03 · 真实数据，不必写死</span>
            <h2>从你已经在用的方式开始。</h2>
            <p>手工录入、CSV、TSV、XLSX，或从 Excel、Numbers、飞书表格显式复制粘贴。仓库里只保留虚构演示数据，你的真实财务数据只保存在本机。</p>
            <div className="folio-format-row"><span>CSV</span><span>TSV</span><span>XLSX</span><span>粘贴表格</span></div>
          </div>
        </section>

        <section className="folio-section folio-security-section" id="security">
          <div className="folio-security-heading">
            <span className="folio-section-index light">04 · 从第一天就按真实数据设计</span>
            <h2>安全不是一个开关，<br />而是产品的结构。</h2>
            <p>Folio 把身份、设备解锁和本地数据解密分成独立安全层。即使未来增加加密同步，云端也只接收认证密文与最少路由信息。</p>
          </div>
          <div className="folio-security-lockup">
            <div className="folio-vault-core"><LockKey weight="duotone" /><span><b>本地数据</b><small>SQLCipher 加密</small></span></div>
            <span className="folio-security-ring ring-one">应用密码</span>
            <span className="folio-security-ring ring-two">Touch ID</span>
            <span className="folio-security-ring ring-three">设备边界</span>
          </div>
          <div className="folio-security-grid">
            {securityItems.map(({ icon: Icon, title, text }) => (
              <article key={title}><Icon weight="duotone" /><h3>{title}</h3><p>{text}</p></article>
            ))}
          </div>
        </section>

        <section className="folio-section folio-companion-section">
          <div className="folio-companion-card">
            <div className="folio-cat-wrap"><img src="/assets/brand/folio-cat-avatar.png" alt="Folio 的灰色猫咪 AI 管家形象" /></div>
            <div className="folio-companion-copy">
              <span className="folio-section-index">05 · 一位知道边界的 AI 管家</span>
              <h2>帮你整理和理解，<br />不会替你擅自做决定。</h2>
              <p>它可以解释本地账本、整理录入草稿、提示未完成事项；所有结论都带着数据时间和来源，所有变更都要回到核对流程。</p>
              <div className="folio-answer-bubble"><Sparkle weight="fill" /><span><b>本月支出比上月增加 12.4%</b><small>已覆盖 28 条本币支出记录 · 可查看来源</small></span></div>
            </div>
          </div>
        </section>

        <section className="folio-final-cta" id="about">
          <div>
            <span className="folio-eyebrow inverse"><Monitor weight="duotone" /> Mac 版优先</span>
            <h2>从一台 Mac，<br />开始建立自己的财务秩序。</h2>
            <p>Folio 当前聚焦 Apple Silicon Mac 的安全本地体验。移动端、私人 Web 与跨设备加密同步将在 Mac 版稳定后继续推进。</p>
          </div>
          <div className="folio-cta-panel">
            <span className="folio-status-dot"><i /> Mac MVP · 内测中</span>
            <ul>
              <li><Check /> macOS 原生应用</li>
              <li><Check /> 离线可用</li>
              <li><Check /> 本地加密真实数据</li>
            </ul>
            <a href="#top">回到顶部 <ArrowUpRight weight="bold" /></a>
          </div>
        </section>
      </main>

      <footer className="folio-site-footer">
        <BrandLockup />
        <p>让财务更清楚，让数据更安静。</p>
        <span>© 2026 Folio · 被子beizi</span>
      </footer>
    </div>
  );
}
