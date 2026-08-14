import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowsClockwise,
  Bell,
  BellRinging,
  Buildings,
  CalendarBlank,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChartBar,
  ChartDonut,
  ChartLineUp,
  Check,
  CheckCircle,
  Clock,
  Coins,
  CurrencyCny,
  Database,
  DotsThree,
  DownloadSimple,
  Eye,
  EyeSlash,
  FileText,
  Flask,
  Gear,
  Globe,
  HardDrives,
  HouseLine,
  Info,
  Key,
  Lightning,
  ListChecks,
  Microphone,
  Paperclip,
  Plus,
  PiggyBank,
  Receipt,
  ShieldCheck,
  SlidersHorizontal,
  Sparkle,
  Stack,
  Target,
  TrendDown,
  TrendUp,
  UploadSimple,
  Wallet,
  Warning,
  X,
} from "@phosphor-icons/react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { createDataRepository } from "./data/repository.js";

const dataRepository = createDataRepository({ dataMode: "demo" });
const {
  allocation,
  assetTrend,
  bankAssets,
  insightCards,
  planningTargets,
  productPerformance,
  reminderSchedule,
  sandboxAssets,
  transactions,
} = dataRepository.getSnapshot();

const dataIconComponents = Object.freeze({
  buildings: Buildings,
  "chart-line": ChartLineUp,
  clock: Clock,
  coins: Coins,
  receipt: Receipt,
  "shield-check": ShieldCheck,
  wallet: Wallet,
  warning: Warning,
});

function resolveDataIcon(icon) {
  return typeof icon === "string"
    ? dataIconComponents[icon] ?? Info
    : icon;
}

const navItems = [
  { id: "overview", label: "总览", icon: HouseLine },
  { id: "assets", label: "资产", icon: Wallet },
  { id: "cashflow", label: "流水", icon: Receipt },
  { id: "planning", label: "规划", icon: ChartDonut },
  { id: "reminders", label: "提醒", icon: CalendarBlank },
  { id: "assistant", label: "AI 管家", icon: Sparkle },
];

function Money({ children, hidden }) {
  return <>{hidden ? "¥ ••••••" : children}</>;
}

function Logo() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <img src="/assets/brand/folio-logo.png" alt="" />
      </div>
      <div>
        <strong>Folio</strong>
        <span>财务驾驶舱</span>
      </div>
    </div>
  );
}

function Sidebar({ active, onChange, mobileOpen, onClose }) {
  return (
    <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="side-head">
        <Logo />
        <button className="mobile-close icon-button" onClick={onClose} aria-label="关闭菜单"><X /></button>
      </div>
      <nav className="main-nav" aria-label="主导航">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={active === item.id ? "active" : ""}
              onClick={() => { onChange(item.id); onClose(); }}
            >
              <Icon weight={active === item.id ? "fill" : "regular"} />
              <span>{item.label}</span>
              {item.id === "reminders" && <em>3</em>}
            </button>
          );
        })}
      </nav>
      <div className="side-card">
        <div className="side-card-icon"><ShieldCheck weight="fill" /></div>
        <strong>数据已安全同步</strong>
        <span>6 个账户 · 11:42 更新</span>
        <button onClick={() => { onChange("sources"); onClose(); }}>管理数据源 <ArrowRight /></button>
      </div>
      <div className="side-footer">
        <button className={active === "settings" ? "active" : ""} onClick={() => { onChange("settings"); onClose(); }}><Gear /><span>设置</span></button>
        <div className="profile">
          <img src="/assets/brand/folio-cat-avatar.png" alt="猫猫头像" />
          <div><strong>被子beizi</strong><small>个人账户</small></div>
        </div>
      </div>
    </aside>
  );
}

function Header({ title, onMenu }) {
  return (
    <header className="topbar">
      <div className="mobile-brand">
        <button className="menu-button" onClick={onMenu} aria-label="打开菜单"><ListChecks /></button>
        <Logo />
      </div>
      <div className="page-title">
        <p>2026年7月23日 · 周四</p>
        <h1>{title}</h1>
      </div>
      <div className="top-actions">
        <button className="icon-button notice" aria-label="通知"><Bell /><i /></button>
      </div>
    </header>
  );
}

function MetricCard({ label, value, hint, icon: Icon, variant, hidden }) {
  return (
    <article className={`metric-card ${variant || ""}`}>
      <div className="metric-icon"><Icon weight="duotone" /></div>
      <div>
        <span>{label}</span>
        <strong><Money hidden={hidden}>{value}</Money></strong>
        <small>{hint}</small>
      </div>
    </article>
  );
}

function CurrencyTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <span>{label}</span>
      <strong>净资产 ¥{payload[0]?.value}万</strong>
    </div>
  );
}

function AllocationTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const item = payload[0]?.payload;
  return (
    <div className="allocation-tooltip">
      <span>{item.name}</span>
      <strong>{item.amount}</strong>
      <small>{item.value}% · {item.risk}</small>
      <p>{item.note}</p>
    </div>
  );
}

function Dashboard({ hidden, onToggleHidden, onNavigate, onNotify, onOpenAction, summaryField }) {
  const [trendRange, setTrendRange] = useState("近6月");
  const [insightIndex, setInsightIndex] = useState(0);
  const [allocationFocus, setAllocationFocus] = useState(0);

  const changeInsight = (direction) => {
    setInsightIndex((current) => (current + direction + insightCards.length) % insightCards.length);
  };

  const openInsight = () => {
    const destinations = ["planning", "assets", "reminders"];
    onNavigate(destinations[insightIndex]);
    onNotify(`${insightCards[insightIndex].title}：已打开对应处理模块`);
  };

  return (
    <div className="dashboard">
      <section className="hero-grid">
        <div className="net-worth-card">
          <div className="net-top">
            <span>家庭净资产 <button className="plain-icon" onClick={onToggleHidden} aria-label="隐藏金额">{hidden ? <EyeSlash /> : <Eye />}</button></span>
            <div className="sync-status"><i /> 已同步</div>
          </div>
          <div className="net-value">
            <span>¥</span><strong>{hidden ? "••••••" : "2,896,380"}</strong><small>.52</small>
          </div>
          <div className="net-change"><TrendUp weight="bold" /> 本月增加 <b>¥36,420</b><span>+1.27%</span></div>
          <div className="net-summary">
            <div><span>总资产</span><b><Money hidden={hidden}>¥3,142,680</Money></b></div>
            <div className="configurable-metric">
              <span>{summaryField.label}<button onClick={() => onNavigate("settings")} aria-label="配置首页字段"><Gear /></button></span>
              <b><Money hidden={hidden}>{summaryField.value}</Money></b>
            </div>
            <div><span>本月现金流</span><b><Money hidden={hidden}>+¥29,580</Money></b></div>
          </div>
        </div>

        <div className="ai-focus-card" onKeyDown={(event) => {
          if (event.key === "ArrowLeft") changeInsight(-1);
          if (event.key === "ArrowRight") changeInsight(1);
        }} tabIndex={0}>
          <div className="card-label">
            <span><Sparkle weight="fill" /> AI 今日重点</span>
            <div className="focus-controls">
              <button onClick={() => changeInsight(-1)} aria-label="上一条重点"><CaretLeft /></button>
              <small>{insightIndex + 1} / {insightCards.length}</small>
              <button onClick={() => changeInsight(1)} aria-label="下一条重点"><CaretRight /></button>
            </div>
          </div>
          <div className="focus-body" key={insightIndex}>
            {(() => {
              const insight = insightCards[insightIndex];
              const Icon = resolveDataIcon(insight.icon);
              return <>
                <div className={`focus-icon ${insight.severity}`}><Icon weight="duotone" /></div>
                <div>
                  <h3>{insight.title}</h3>
                  <p>{insight.body}</p>
                  <button onClick={openInsight}>{insight.action} <ArrowRight /></button>
                </div>
              </>;
            })()}
          </div>
          <div className="focus-dots">
            {insightCards.map((_, i) => <button key={i} className={i === insightIndex ? "active" : ""} onClick={() => setInsightIndex(i)} aria-label={`查看第${i + 1}条建议`} />)}
          </div>
        </div>
      </section>

      <section className="metrics-row">
        <MetricCard label="可用活期" value="¥186,400" hint="其中 ¥128,500 可规划" icon={Wallet} variant="lime" hidden={hidden} />
        <MetricCard label="本月收入" value="¥45,720" hint="较上月 +8.2%" icon={ArrowDown} hidden={hidden} />
        <MetricCard label="本月支出" value="¥16,140" hint="预算剩余 ¥13,860" icon={ArrowUp} hidden={hidden} />
        <MetricCard label="预期年化" value="4.28%" hint="目标区间 4%–6%" icon={ChartLineUp} />
      </section>

      <section className="cash-alert-panel">
        <div className="cash-alert-head">
          <span><Warning weight="fill" /></span>
          <div>
            <div className="cash-alert-title"><h2>闲置资金提醒：活期合计 ¥50,800</h2><em>已闲置 7 天</em></div>
            <p>已超过你设置的 ¥20,000 闲置阈值，建议将超出部分分批规划。</p>
          </div>
          <button onClick={() => onNavigate("planning")}>规划资金 <ArrowRight /></button>
        </div>
        <div className="cash-bank-list">
          <button onClick={() => onNavigate("assets")}><span><b>招行活期</b><small>招商银行</small></span><strong>¥38,500</strong><ArrowRight /></button>
          <button onClick={() => onNavigate("assets")}><span><b>工行活期</b><small>工商银行</small></span><strong>¥12,300</strong><ArrowRight /></button>
          <small><BellRinging /> 满 7 天会推送浏览器与应用内通知</small>
        </div>
      </section>

      <section className="content-grid">
        <article className="panel trend-panel">
          <div className="panel-head">
            <div><h2>资产走势</h2><p>净资产稳步增长，近 6 个月增加 ¥17.6万</p></div>
            <div className="segmented">
              {["近6月", "今年", "全部"].map((item) => <button key={item} className={trendRange === item ? "active" : ""} onClick={() => setTrendRange(item)}>{item}</button>)}
            </div>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={assetTrend} margin={{ top: 18, right: 10, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="assetFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#9b8df2" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#9b8df2" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 6" vertical={false} stroke="#e2e3e8" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#8a8d94", fontSize: 12 }} />
                <YAxis domain={[265, 295]} axisLine={false} tickLine={false} tick={{ fill: "#8a8d94", fontSize: 12 }} tickFormatter={(v) => `${v}万`} />
                <Tooltip content={<CurrencyTooltip />} cursor={{ stroke: "#b7b9c0", strokeDasharray: "3 3" }} />
                <Area type="monotone" dataKey="net" stroke="#4d465f" strokeWidth={2.5} fill="url(#assetFill)" activeDot={{ r: 5, fill: "#c9ef5b", stroke: "#25262a", strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel allocation-panel">
          <div className="panel-head">
            <div><h2>资产配置</h2><p>按当前市值计算</p></div>
            <button className="text-button" onClick={() => onNavigate("planning")}>配置目标 <ArrowRight /></button>
          </div>
          <div className="allocation-content">
            <div className="donut-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={allocation}
                    dataKey="value"
                    innerRadius={58}
                    outerRadius={82}
                    paddingAngle={3}
                    stroke="none"
                    onMouseEnter={(_, index) => setAllocationFocus(index)}
                    onClick={(_, index) => setAllocationFocus(index)}
                  >
                    {allocation.map((item, index) => <Cell key={item.name} fill={item.color} opacity={allocationFocus === index ? 1 : .66} />)}
                  </Pie>
                  <Tooltip content={<AllocationTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-label"><b>{allocation[allocationFocus].value}%</b><span>{allocation[allocationFocus].name}</span></div>
            </div>
            <div className="allocation-list">
              {allocation.map((item, index) => (
                <button
                  key={item.name}
                  className={allocationFocus === index ? "active" : ""}
                  onMouseEnter={() => setAllocationFocus(index)}
                  onFocus={() => setAllocationFocus(index)}
                  onClick={() => setAllocationFocus(index)}
                >
                  <i style={{ background: item.color }} /><span>{item.name}</span><b>{item.value}%</b><small><Money hidden={hidden}>{item.amount}</Money></small>
                </button>
              ))}
            </div>
          </div>
        </article>
      </section>

      <section className="content-grid lower-grid">
        <article className="panel account-panel">
          <div className="panel-head">
            <div><h2>账户与资产</h2><p>所有账户最近一次同步状态</p></div>
            <button className="text-button" onClick={() => onNavigate("assets")}>查看全部 <ArrowRight /></button>
          </div>
          <div className="account-list">
            {bankAssets.map((item) => (
              <button className="account-row" key={item.bank} onClick={() => onNotify(`${item.bank}：已打开账户详情（Demo）`)}>
                <span className={`bank-logo ${item.tone}`}>{item.bank.slice(0, 1)}</span>
                <span className="account-name"><b>{item.bank}</b><small>{item.type}</small></span>
                <span className="account-cash"><small>可用活期</small><b><Money hidden={hidden}>{item.cash}</Money></b></span>
                <span className="account-amount"><b><Money hidden={hidden}>{item.amount}</Money></b><small className={item.change.startsWith("-") ? "down" : ""}>{item.change}</small></span>
                <ArrowRight />
              </button>
            ))}
          </div>
        </article>

        <article className="panel reminder-panel">
          <div className="panel-head">
            <div><h2>近期财务日程</h2><p>租金、缴费和产品到期统一提醒</p></div>
            <button className="round-add" aria-label="添加事项" onClick={() => onOpenAction("add-item")}><Plus /></button>
          </div>
          <div className="reminder-list">
            {reminderSchedule.slice(0, 3).map((item) => {
              const Icon = resolveDataIcon(item.icon);
              return (
                <div className="reminder-row" key={item.title}>
                  <div className="date-block"><b>{item.date}</b><span>{item.month}</span></div>
                  <div className="reminder-icon"><Icon /></div>
                  <div className="reminder-copy"><b>{item.title}</b><span>{item.detail}</span></div>
                  <em className={item.tone}>{item.tag}</em>
                  <button aria-label="更多" onClick={() => onNotify(`${item.title}：已打开提醒操作菜单`)}><DotsThree /></button>
                </div>
              );
            })}
          </div>
          <button className="calendar-action" onClick={() => onNavigate("reminders")}><CalendarBlank /> 查看完整财务日历</button>
        </article>
      </section>

      <section className="panel transactions-panel">
        <div className="panel-head">
          <div><h2>近期流水</h2><p>自动归类的收入、支出与投资记录</p></div>
          <div className="panel-actions"><button onClick={() => onNotify("流水导出任务已创建（Demo）")}><DownloadSimple /> 导出</button><button className="text-button" onClick={() => onNavigate("cashflow")}>全部流水 <ArrowRight /></button></div>
        </div>
        <div className="transaction-table">
          {transactions.map((item) => {
            const Icon = resolveDataIcon(item.icon);
            return (
              <div className="transaction-row" key={item.name}>
                <div className="transaction-icon"><Icon /></div>
                <div><b>{item.name}</b><span>{item.meta}</span></div>
                <time>{item.time}</time>
                <strong className={item.type}><Money hidden={hidden}>{item.amount}</Money></strong>
              </div>
            );
          })}
        </div>
      </section>

    </div>
  );
}

function AssetsPage({ hidden, onNotify, onNavigate, onOpenAction }) {
  const [filter, setFilter] = useState("全部");
  const [section, setSection] = useState("资产明细");
  const filteredAssets = filter === "全部"
    ? bankAssets
    : bankAssets.filter((item) => item.category.includes(filter));
  return (
    <div className="subpage">
      <section className="page-summary">
        <div><span>总资产</span><strong><Money hidden={hidden}>¥3,142,680</Money></strong><small><TrendUp /> 本月 +1.16%</small></div>
        <button onClick={() => onOpenAction("add-account")}><Plus /> 添加账户</button>
      </section>
      <section className="panel">
        <div className="panel-head responsive">
          <div><h2>资产配置</h2><p>从持仓明细到产品表现与 AI 调仓建议</p></div>
          <div className="section-tabs">
            {["资产明细", "产品表现", "AI调仓建议"].map((item) => <button key={item} className={section === item ? "active" : ""} onClick={() => setSection(item)}>{item}</button>)}
          </div>
        </div>
        {section === "资产明细" && (
          <>
            <div className="filter-pills asset-filters">{["全部", "活期", "理财", "基金", "保险"].map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div>
            <div className="asset-table-head"><span>机构 / 资产</span><span>类型</span><span>可用资金</span><span>市值</span><span>收益</span></div>
            <div className="asset-table">
              {filteredAssets.map((item, i) => (
                <button className="asset-table-row" key={item.bank} onClick={() => onNotify(`${item.bank}：已打开资产详情（Demo）`)}>
                  <span className="asset-identity"><i className={`bank-logo ${item.tone}`}>{item.bank[0]}</i><b>{item.bank}<small>{i % 2 ? "尾号 8208" : "尾号 3619"}</small></b></span>
                  <span>{item.type}</span>
                  <span><Money hidden={hidden}>{item.cash}</Money></span>
                  <strong><Money hidden={hidden}>{item.amount}</Money></strong>
                  <em className={item.change.startsWith("-") ? "down" : ""}>{item.change}</em>
                </button>
              ))}
            </div>
          </>
        )}
        {section === "产品表现" && (
          <div className="performance-table">
            <div className="performance-head"><span>产品</span><span>风险</span><span>当前市值</span><span>年内表现</span><span>健康度</span></div>
            {productPerformance.map((item) => (
              <button key={item.name} onClick={() => onNotify(`${item.name}：已展开持仓穿透分析`)}>
                <span><b>{item.name}</b><small>{item.type}</small></span>
                <em>{item.risk}</em>
                <strong>{item.amount}</strong>
                <i className={item.change.startsWith("-") ? "down" : ""}>{item.change}</i>
                <span className="score"><span style={{ width: `${item.score}%` }} />{item.score}</span>
              </button>
            ))}
          </div>
        )}
        {section === "AI调仓建议" && (
          <div className="rebalance-layout">
            <article className="rebalance-card important">
              <span><Warning weight="fill" /></span>
              <div><small>需要关注</small><h3>黄金敞口高于目标上限</h3><p>相关基金合计约 18.4%，建议分两次降至 12%–15%，避免一次性择时。</p></div>
              <button onClick={() => onNavigate("planning")}>放入模拟沙盘 <ArrowRight /></button>
            </article>
            <article className="rebalance-card">
              <span><PiggyBank weight="duotone" /></span>
              <div><small>现金效率</small><h3>¥78,500 可分批配置</h3><p>保留 ¥50,000 安全垫后，可按 4 周分批进入稳健理财与债券基金。</p></div>
              <button onClick={() => onNavigate("planning")}>模拟调整 <ArrowRight /></button>
            </article>
            <div className="ai-disclaimer"><ShieldCheck /><span><b>建议不会直接改动真实资产</b><small>所有动作都先进入模拟沙盘，确认后仅生成待执行清单。</small></span></div>
          </div>
        )}
      </section>
    </div>
  );
}

function CashflowPage({ hidden, onNotify, onOpenAction }) {
  const [year, setYear] = useState(2026);
  return (
    <div className="subpage">
      <section className="metrics-row three">
        <MetricCard label="7月收入" value="¥45,720" hint="含待收租金 ¥8,600" icon={ArrowDown} variant="lime" hidden={hidden} />
        <MetricCard label="7月支出" value="¥16,140" hint="较上月少 12.4%" icon={ArrowUp} hidden={hidden} />
        <MetricCard label="月度结余" value="¥29,580" hint="结余率 64.7%" icon={Wallet} hidden={hidden} />
      </section>
      <section className="panel cashflow-chart">
        <div className="panel-head"><div><h2>收支变化</h2><p>收入、支出与结余趋势</p></div><button className="date-select" onClick={() => { const next = year === 2026 ? 2025 : 2026; setYear(next); onNotify(`已切换到 ${next} 年收支数据（Demo）`); }}>{year}年 <CaretDown /></button></div>
        <ResponsiveContainer width="100%" height={310}>
          <LineChart data={assetTrend} margin={{ top: 20, right: 20, bottom: 0, left: -10 }}>
            <CartesianGrid strokeDasharray="3 6" vertical={false} stroke="#e2e3e8" />
            <XAxis dataKey="month" axisLine={false} tickLine={false} />
            <YAxis axisLine={false} tickLine={false} tickFormatter={(v) => `${v}万`} />
            <Tooltip />
            <Line type="monotone" dataKey="income" name="收入" stroke="#8f80e8" strokeWidth={3} dot={false} />
            <Line type="monotone" dataKey="expense" name="支出" stroke="#25262a" strokeWidth={3} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </section>
      <section className="panel transactions-panel">
        <div className="panel-head">
          <div><h2>全部流水</h2><p>AI 已自动归类 96% 的记录</p></div>
          <button className="panel-primary-action" onClick={() => onOpenAction("add-transaction")}><Plus /> 添加流水</button>
        </div>
        <div className="transaction-table">{transactions.map((item) => { const Icon = resolveDataIcon(item.icon); return <div className="transaction-row" key={item.name}><div className="transaction-icon"><Icon /></div><div><b>{item.name}</b><span>{item.meta}</span></div><time>{item.time}</time><strong className={item.type}><Money hidden={hidden}>{item.amount}</Money></strong></div>; })}</div>
      </section>
    </div>
  );
}

function PlanningPage({ hidden, onNotify, onOpenAction }) {
  const [mix, setMix] = useState({ cash: 20, stable: 38, equity: 30, gold: 12 });
  const totalMix = Object.values(mix).reduce((sum, value) => sum + value, 0);
  const expectedReturn = sandboxAssets.reduce((sum, item) => sum + mix[item.key] * item.returnRate / 100, 0);
  const riskScore = Math.round(sandboxAssets.reduce((sum, item) => sum + mix[item.key] * item.risk / 100, 0));
  const sandboxData = sandboxAssets.map((item) => ({ ...item, value: mix[item.key] }));

  return (
    <div className="subpage planning-page">
      <section className="planning-hero">
        <span>配置健康度</span><strong>82<small>/100</small></strong><p>现金略多、权益类略高；调整后预计风险等级可从“进取”回到“均衡”。</p><button onClick={() => onNotify("本月调仓方案已生成，并放入待执行清单（Demo）")}>生成本月调仓方案 <ArrowRight /></button>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>目标配置进度</h2><p>基于你的风险偏好与年度计划</p></div><button className="text-button" onClick={() => onOpenAction("edit-target")}>调整目标</button></div>
        <div className="target-list">
          {planningTargets.map((item) => (
            <div className="target-row" key={item.name}><div><b>{item.name}</b><span><Money hidden={hidden}>当前 ¥{item.current}万 · 目标 ¥{item.target}万</Money></span></div><div className="progress"><i className={item.color} style={{ width: `${Math.min(100, item.current / item.target * 100)}%` }} /></div><em>{item.note}</em></div>
          ))}
        </div>
      </section>
      <section className="content-grid">
        <article className="panel"><div className="panel-head"><div><h2>建议动作</h2><p>需要你确认后才会记录</p></div></div><div className="suggestion-stack"><div><i><CurrencyCny /></i><span><b>保留 ¥50,000 活期安全垫</b><small>其余 ¥78,500 可分批配置</small></span><button onClick={() => onNotify("已采纳现金安全垫建议，并加入模拟方案")}>采纳</button></div><div><i><ChartDonut /></i><span><b>降低黄金相关敞口</b><small>建议从 18.4% 降至 12%–15%</small></span><button onClick={() => onNotify("已展开黄金敞口穿透分析（Demo）")}>查看</button></div></div></article>
        <article className="panel risk-note"><ShieldCheck weight="duotone" /><div><h2>建议不等于交易指令</h2><p>Folio 仅基于你提供的数据做归纳和风险提示，不会代替你执行申购、赎回或清仓。</p></div></article>
      </section>
      <section className="panel sandbox-panel">
        <div className="panel-head responsive">
          <div><h2>投资组合模拟沙盘 <em className="demo-badge"><Flask /> 仅模拟</em></h2><p>实时调整比例，查看预期收益与风险变化；不会写入真实资产。</p></div>
          <button className="ai-mix-button" onClick={() => setMix({ cash: 18, stable: 42, equity: 30, gold: 10 })}><Sparkle weight="fill" /> 应用 AI 建议比例</button>
        </div>
        <div className="sandbox-grid">
          <div className="sandbox-chart">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={sandboxData} dataKey="value" innerRadius={68} outerRadius={96} paddingAngle={3} stroke="none">
                  {sandboxData.map((item) => <Cell key={item.key} fill={item.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div><b>{totalMix}%</b><span>{totalMix === 100 ? "配比有效" : "需调整至 100%"}</span></div>
          </div>
          <div className="sandbox-sliders">
            {sandboxAssets.map((item) => (
              <label key={item.key}>
                <span><i style={{ background: item.color }} />{item.name}<b>{mix[item.key]}%</b></span>
                <input type="range" min="0" max="70" value={mix[item.key]} onChange={(event) => setMix((current) => ({ ...current, [item.key]: Number(event.target.value) }))} />
              </label>
            ))}
          </div>
          <div className="sandbox-result">
            <span>模拟结果</span>
            <div><small>预期年化</small><strong>{expectedReturn.toFixed(2)}%</strong></div>
            <div><small>风险评分</small><strong>{riskScore}<em>/100</em></strong></div>
            <div><small>波动判断</small><strong>{riskScore > 55 ? "中高" : riskScore > 35 ? "均衡" : "稳健"}</strong></div>
            <button disabled={totalMix !== 100} onClick={() => onNotify("已生成模拟调仓清单；真实资产尚未发生变化")}>生成待执行清单 <ArrowRight /></button>
          </div>
        </div>
      </section>
    </div>
  );
}

function RemindersPage({ onNotify, onOpenAction }) {
  const [category, setCategory] = useState("全部");
  const schedule = reminderSchedule;
  const visibleSchedule = category === "全部" ? schedule : schedule.filter((item) => item.category === category);

  return (
    <div className="subpage reminders-page">
      <section className="reminder-hero">
        <div><span>下一个重要节点</span><strong>2 天后</strong><p>滨江公寓 7 月租金 ¥8,600 应到账</p></div>
        <button onClick={() => onOpenAction("add-item")}><Plus /> 添加事项</button>
      </section>
      <section className="manager-grid">
        <article className="manager-card rent">
          <div className="manager-title"><span><Buildings /></span><div><h3>租金管家</h3><p>2 套房产 · 1 笔待收</p></div><em>需处理</em></div>
          <div className="manager-primary"><span><small>滨江公寓 2栋 801</small><b>¥8,600</b></span><strong>逾期 2 天</strong></div>
          <button onClick={() => onNotify("滨江公寓：已标记本月租金到账")}><Check /> 标记已收</button>
        </article>
        <article className="manager-card insurance">
          <div className="manager-title"><span><ShieldCheck /></span><div><h3>保险管家</h3><p>3 份保单 · 1 项续缴</p></div><em>10天后</em></div>
          <div className="manager-primary"><span><small>友邦保险续缴</small><b>¥12,800</b></span><strong>保单 1028</strong></div>
          <button onClick={() => onOpenAction("import-insurance")}><UploadSimple /> 导入保单</button>
        </article>
        <article className="manager-card maturity">
          <div className="manager-title"><span><Clock /></span><div><h3>到期管家</h3><p>理财、定期与分红提醒</p></div><em>16天后</em></div>
          <div className="manager-primary"><span><small>嘉鑫固收 90 天</small><b>¥80,000</b></span><strong>预计 +¥1,042</strong></div>
          <button onClick={() => onNotify("已创建到期前 7 天、1 天双重提醒")}><BellRinging /> 设置双提醒</button>
        </article>
      </section>
      <section className="panel">
        <div className="panel-head responsive">
          <div><h2>财务日程</h2><p>未来 30 天共有 {schedule.length} 个节点</p></div>
          <button className="round-add" aria-label="添加事项" onClick={() => onOpenAction("add-item")}><Plus /></button>
        </div>
        <div className="filter-pills reminder-filters">{["全部", "租金", "到期", "保险", "闲置"].map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div>
        <div className="timeline">
          {visibleSchedule.map((item) => { const Icon = resolveDataIcon(item.icon); return <div className="timeline-item" key={item.title}><div className="timeline-date"><b>{item.date}</b><span>{item.month}</span></div><div className="timeline-line"><i /></div><div className="timeline-card"><span><Icon /></span><div><b>{item.title}</b><small>{item.detail}</small></div><em>{item.tag}</em><button aria-label={`${item.title}更多操作`} onClick={() => onNotify(`${item.title}：已打开提醒操作菜单`)}><DotsThree /></button></div></div>; })}
        </div>
      </section>
    </div>
  );
}

function DataSourcesPage({ onNotify, onVoice }) {
  const [sourceType, setSourceType] = useState("飞书多维表");
  const sources = [
    { name: "飞书多维表", icon: Stack, detail: "适合从现有资产表做首次迁移与周期补充", status: "推荐起步" },
    { name: "文件导入", icon: UploadSimple, detail: "支持 Markdown、CSV、PDF、图片与银行账单", status: "可用" },
    { name: "语音补录", icon: Microphone, detail: "把最新买卖、租金和大额支出转成待确认记录", status: "可用" },
    { name: "API / MCP", icon: Globe, detail: "按机构能力接入市场数据、企业信息与个人连接器", status: "规划中" },
  ];
  const activeSource = sources.find((item) => item.name === sourceType);
  const ActiveIcon = activeSource.icon;

  return (
    <div className="subpage sources-page">
      <section className="sources-hero">
        <div><span><Database weight="duotone" /></span><div><small>数据中心</small><h2>先统一入口，再逐步自动化</h2><p>当前 Demo 不要求一次接完所有银行。推荐先导入飞书表格，再用文件与语音补录变化。</p></div></div>
        <em><ShieldCheck /> 写入前均需确认</em>
      </section>
      <section className="source-layout">
        <div className="source-cards">
          {sources.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.name} className={sourceType === item.name ? "active" : ""} onClick={() => setSourceType(item.name)}>
                <span><Icon /></span><div><b>{item.name}</b><small>{item.detail}</small></div><em>{item.status}</em>
              </button>
            );
          })}
        </div>
        <article className="panel source-detail">
          <div className="source-detail-icon"><ActiveIcon /></div>
          <span>当前选择</span>
          <h2>{activeSource.name}</h2>
          <p>{activeSource.detail}</p>
          {sourceType === "飞书多维表" && <div className="source-steps"><i>1</i><span>选择多维表</span><i>2</i><span>映射字段</span><i>3</i><span>预览并确认</span></div>}
          {sourceType === "文件导入" && <div className="drop-zone"><FileText /><b>拖入文件或点击选择</b><small>.md / .csv / .pdf / .png / .jpg</small></div>}
          {sourceType === "语音补录" && <div className="voice-source"><Microphone weight="fill" /><span>说“招行赎回 5 万，转入建行理财”</span></div>}
          {sourceType === "API / MCP" && <div className="connector-list"><span><HardDrives /> 市场数据连接器</span><span><Buildings /> 银行与机构连接器</span><span><Globe /> 联网检索适配器</span></div>}
          <button className="primary source-action" onClick={() => {
            if (sourceType === "语音补录") onVoice();
            else onNotify(`${sourceType}：已进入配置向导（Demo）`);
          }}>{sourceType === "语音补录" ? "开始语音补录" : "开始配置"} <ArrowRight /></button>
        </article>
      </section>
      <section className="panel connected-sources">
        <div className="panel-head"><div><h2>已连接数据源</h2><p>仅显示 Demo 状态，不会读取真实账户</p></div></div>
        <div><span><Stack /></span><div><b>个人资产多维表</b><small>上次同步：今天 11:42 · 86 条记录</small></div><em>正常</em><button onClick={() => onNotify("已模拟重新同步个人资产多维表")}><ArrowsClockwise /> 重新同步</button></div>
      </section>
    </div>
  );
}

function SettingsPage({ summaryFieldKey, onSummaryFieldChange, onNotify }) {
  const [tab, setTab] = useState("AI模型");
  const [provider, setProvider] = useState("OpenAI Compatible");
  const fields = [
    { key: "availableCash", label: "活期可用", value: "¥186,400" },
    { key: "liability", label: "总负债", value: "¥246,300" },
    { key: "investable", label: "可规划资金", value: "¥128,500" },
  ];

  return (
    <div className="subpage settings-page">
      <section className="panel settings-shell">
        <div className="settings-nav">
          <div><span><Gear /></span><h2>设置</h2><p>模型、字段、提醒与安全策略</p></div>
          {["AI模型", "首页指标", "提醒偏好", "安全"].map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}<ArrowRight /></button>)}
        </div>
        <div className="settings-content">
          {tab === "AI模型" && (
            <>
              <div className="settings-heading"><span><Sparkle /></span><div><h2>AI 模型配置</h2><p>Demo 只保存界面状态，不上传或校验真实密钥。</p></div></div>
              <label className="settings-field"><span>模型提供方</span><select value={provider} onChange={(event) => setProvider(event.target.value)}><option>OpenAI Compatible</option><option>本地 Ollama</option><option>自定义企业网关</option></select></label>
              <label className="settings-field"><span>API Base URL</span><input value={provider === "本地 Ollama" ? "http://localhost:11434/v1" : "https://api.openai.com/v1"} readOnly /></label>
              <label className="settings-field"><span>API Key</span><div className="key-input"><Key /><input type="password" value="sk-demo-not-a-real-key" readOnly /><button onClick={() => onNotify("生产版将调用系统钥匙串，不会明文保存在前端")}>存储策略</button></div></label>
              <div className="env-scan"><HardDrives /><div><b>桌面端环境变量检测</b><small>只检测是否存在，不在界面展示完整密钥；复制前必须征得用户同意。</small></div><button onClick={() => onNotify("检测完成：发现 1 个可用变量（Demo），等待用户确认导入")}>模拟检测</button></div>
              <button className="primary settings-save" onClick={() => onNotify("AI 模型配置已保存为 Demo 草稿")}>保存配置</button>
            </>
          )}
          {tab === "首页指标" && (
            <>
              <div className="settings-heading"><span><SlidersHorizontal /></span><div><h2>首页字段</h2><p>选择净资产卡片中间显示的可配置指标。</p></div></div>
              <div className="field-options">
                {fields.map((item) => <button key={item.key} className={summaryFieldKey === item.key ? "active" : ""} onClick={() => onSummaryFieldChange(item.key)}><span><b>{item.label}</b><small>{item.value}</small></span>{summaryFieldKey === item.key && <CheckCircle weight="fill" />}</button>)}
              </div>
            </>
          )}
          {tab === "提醒偏好" && (
            <>
              <div className="settings-heading"><span><BellRinging /></span><div><h2>提醒偏好</h2><p>关键节点默认应用内提醒，并可选择浏览器通知。</p></div></div>
              <div className="toggle-list">
                {["租金到期前 3 天", "保险续缴前 15 天", "理财到期前 7 天", "活期闲置满 7 天"].map((item) => <label key={item}><span><b>{item}</b><small>应用内 + 浏览器通知</small></span><input type="checkbox" defaultChecked /></label>)}
              </div>
            </>
          )}
          {tab === "安全" && (
            <>
              <div className="settings-heading"><span><ShieldCheck /></span><div><h2>数据与金额安全</h2><p>所有外部输入先进入草稿区，不直接覆盖总账。</p></div></div>
              <div className="security-cards"><article><CheckCircle /><b>逐项确认</b><p>金额、机构、产品和动作均需核对。</p></article><article><ArrowsClockwise /><b>可撤销记录</b><p>每次修改都保留版本和原始输入。</p></article><article><Key /><b>本地密钥</b><p>桌面端优先存入系统安全钥匙串。</p></article></div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function AssistantPage({ onVoice }) {
  return (
    <div className="subpage assistant-page">
      <section className="assistant-hero">
        <div className="assistant-orb"><Sparkle weight="fill" /></div>
        <span>Folio AI 管家</span>
        <h2>用自然语言，管理你的每一笔钱</h2>
        <p>语音说一笔交易，或上传基金、保险文件。我会先提取信息并生成核对清单，只有你确认后才写入资产。</p>
        <div className="assistant-input"><button><Paperclip /></button><span>例如：我把招行 A 基金卖了五万，买了建行 B 基金…</span><button className="mic" onClick={onVoice}><Microphone weight="fill" /></button></div>
      </section>
      <section className="assistant-capabilities">
        <article><span><Microphone /></span><h3>语音记账与调仓</h3><p>识别口语中的机构、产品、金额和动作，自动生成变更草稿。</p></article>
        <article><span><FileText /></span><h3>保险文件解读</h3><p>提取缴费、分红、保障期限和注意事项，写入财务日程。</p></article>
        <article><span><ChartLineUp /></span><h3>基金持仓分析</h3><p>识别行业与大类资产敞口，结合市场波动给出关注提示。</p></article>
      </section>
      <section className="panel guardrail"><ShieldCheck weight="duotone" /><div><h2>金额安全护栏</h2><p>不确定的数字会标红，缺失信息会主动追问；任何资产变更都需要你逐项确认，并保留原始语音与修改记录。</p></div><span>已开启</span></section>
    </div>
  );
}

const voiceContextConfig = {
  overview: {
    listeningTitle: "直接说，Folio 会帮你归类",
    example: "“今天招行收到滨江公寓租金八千六，记到租金收入。”",
    confirmTitle: "确认本次信息记录",
    summary: "我识别出 1 笔租金收入，将先保存为待确认记录。",
    items: [{ id: "income", icon: ArrowDown, tone: "buy", title: "记录租金收入", meta: "招商银行 · 滨江公寓", amount: "+¥8,600.00" }],
    fields: [["发生日期", "2026-07-23"], ["归类", "租金收入"]],
    confirmLabel: "确认并记录",
    success: "已记录滨江公寓租金收入 ¥8,600",
    reviewTitle: "请核对金额、账户和分类",
  },
  assets: {
    listeningTitle: "说出资产变化，Folio 会先整理",
    example: "“我把招行的中证红利 A 卖了五万，然后买了建行的嘉鑫固收。”",
    confirmTitle: "确认本次资产变更",
    summary: "我从语音中识别出 2 笔交易，金额轧差为 ¥0。",
    items: [
      { id: "sold", icon: ArrowUp, tone: "sell", title: "赎回基金", meta: "招商银行 · 招商中证红利 A", amount: "¥50,000.00" },
      { id: "bought", icon: ArrowDown, tone: "buy", title: "购买理财", meta: "建设银行 · 嘉鑫固收 90 天", amount: "¥50,000.00" },
    ],
    fields: [["交易日期", "2026-07-23"], ["赎回到账", "T+1 预计到账"]],
    confirmLabel: "确认并更新资产",
    success: "已更新：赎回 ¥50,000，并购买嘉鑫固收 ¥50,000",
    supportsFees: true,
    reviewTitle: "请重点核对金额和产品名称",
  },
  cashflow: {
    listeningTitle: "说一笔收支，Folio 会帮你记账",
    example: "“今天从建行花了三百六十八买日用品。”",
    confirmTitle: "确认本次流水",
    summary: "我识别出 1 笔日常支出，请核对金额、账户与分类。",
    items: [{ id: "expense", icon: ArrowUp, tone: "sell", title: "记录日常支出", meta: "建设银行 · 日用品", amount: "-¥368.00" }],
    fields: [["交易日期", "2026-07-23"], ["分类", "日常消费"]],
    confirmLabel: "确认并添加流水",
    success: "已添加日常支出 ¥368，等待账单对账",
    supportsFees: true,
    reviewTitle: "请核对金额、账户和分类",
  },
  planning: {
    listeningTitle: "说出规划目标，Folio 会先生成草稿",
    example: "“把活期安全垫调整到八万元，权益资产上限保持百分之三十。”",
    confirmTitle: "确认规划目标草稿",
    summary: "我识别出 2 项配置偏好，只会更新模拟目标。",
    items: [
      { id: "buffer", icon: Wallet, tone: "buy", title: "调整活期安全垫", meta: "规划目标 · 不影响真实余额", amount: "¥80,000" },
      { id: "equity", icon: ChartDonut, tone: "buy", title: "权益资产上限", meta: "风险约束 · 保持当前设置", amount: "30%" },
    ],
    fields: [["生效范围", "模拟与建议"], ["风险偏好", "均衡"]],
    confirmLabel: "确认并保存目标",
    success: "规划目标草稿已保存，真实持仓未发生变化",
    reviewTitle: "请核对目标值与适用范围",
    reviewHint: "确认后只更新规划草稿，不会触发任何真实交易。",
  },
  reminders: {
    listeningTitle: "说出要记住的事项",
    example: "“八月二日要缴友邦保险一万二千八，提前三天提醒我。”",
    confirmTitle: "确认新增事项",
    summary: "我识别出 1 个保险续缴事项，并附带提前 3 天提醒。",
    items: [{ id: "reminder", icon: CalendarBlank, tone: "buy", title: "友邦保险续缴", meta: "保单尾号 1028 · 提前 3 天提醒", amount: "¥12,800" }],
    fields: [["关注日期", "2026-08-02"], ["事项类型", "保险续缴"]],
    confirmLabel: "确认并添加事项",
    success: "保险续缴事项已添加，并设置提前 3 天提醒",
    reviewTitle: "请核对日期、金额和提醒时间",
    reviewHint: "确认后新增事项，不会生成或发送对外催收信息。",
  },
  sources: {
    listeningTitle: "口述最新数据，Folio 会生成核对清单",
    example: "“招行活期余额现在是十二万八千五，数据日期是今天。”",
    confirmTitle: "确认数据补录草稿",
    summary: "我识别出 1 项账户余额更新，确认后进入对账队列。",
    items: [{ id: "source", icon: Database, tone: "buy", title: "补录招行活期余额", meta: "招商银行 · 数据日期 2026-07-23", amount: "¥128,500" }],
    fields: [["数据来源", "语音补录"], ["处理状态", "待对账"]],
    confirmLabel: "确认并加入对账",
    success: "余额补录草稿已加入对账队列",
    reviewTitle: "请核对余额与数据日期",
    reviewHint: "确认后进入对账队列，不会直接覆盖现有账户余额。",
  },
  settings: {
    listeningTitle: "说出偏好，Folio 会先整理",
    example: "“保险续缴提前十五天提醒，首页继续显示活期可用。”",
    confirmTitle: "确认偏好设置",
    summary: "我识别出 2 项界面与提醒偏好。",
    items: [
      { id: "notice", icon: BellRinging, tone: "buy", title: "保险续缴提醒", meta: "应用内 + 浏览器通知", amount: "提前15天" },
      { id: "metric", icon: SlidersHorizontal, tone: "buy", title: "首页次级指标", meta: "净资产卡片中部", amount: "活期可用" },
    ],
    fields: [["适用范围", "个人账户"], ["修改方式", "语音偏好"]],
    confirmLabel: "确认并保存偏好",
    success: "提醒与首页指标偏好已保存",
    reviewTitle: "请核对提醒时间与展示字段",
    reviewHint: "确认后只更新当前个人账户的偏好设置。",
  },
};

function VoiceModal({ active, onClose, onCommitted }) {
  const config = voiceContextConfig[active] || voiceContextConfig.overview;
  const [stage, setStage] = useState("listening");
  const [checks, setChecks] = useState(() => ({
    ...Object.fromEntries(config.items.map((item) => [item.id, true])),
    fees: false,
  }));

  const toggle = (key) => setChecks((prev) => ({ ...prev, [key]: !prev[key] }));
  const allChecked = config.items.every((item) => checks[item.id]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="voice-modal" role="dialog" aria-modal="true" aria-labelledby="voice-title">
        <button className="modal-close" onClick={onClose} aria-label="关闭"><X /></button>
        {stage === "listening" ? (
          <>
            <div className="listening-orb"><Microphone weight="fill" /></div>
            <span className="eyebrow">正在听…</span>
            <h2 id="voice-title">{config.listeningTitle}</h2>
            <p>{config.example}</p>
            <div className="waveform" aria-hidden="true">{Array.from({ length: 22 }).map((_, i) => <i key={i} style={{ height: `${12 + ((i * 17) % 34)}px` }} />)}</div>
            <div className="listening-actions"><button className="secondary" onClick={onClose}>取消</button><button className="primary" onClick={() => setStage("confirm")}><Check /> 完成并解析</button></div>
            <small className="privacy-note"><ShieldCheck /> 语音仅用于本次解析，所有结果都需确认</small>
          </>
        ) : (
          <>
            <div className="confirm-head">
              <div className="confirm-icon"><Sparkle weight="fill" /></div>
              <div><span className="eyebrow">已解析 · 请逐项核对</span><h2 id="voice-title">{config.confirmTitle}</h2><p>{config.summary}</p></div>
            </div>
            <div className="transcript"><span>原始语音</span><p>{config.example}</p></div>
            <div className="change-list">
              {config.items.map((item) => {
                const ItemIcon = item.icon;
                return (
                  <button key={item.id} className={`change-row ${checks[item.id] ? "checked" : ""}`} onClick={() => toggle(item.id)}>
                    <i>{checks[item.id] && <Check />}</i><span className={`change-action ${item.tone}`}><ItemIcon /></span>
                    <span><b>{item.title}</b><small>{item.meta}</small></span>
                    <strong>{item.amount}</strong>
                  </button>
                );
              })}
            </div>
            <div className="verify-grid">
              {config.fields.map(([label, value]) => <div key={label}><span>{label}</span><button>{value} <CaretDown /></button></div>)}
            </div>
            {config.supportsFees && <label className="fee-check"><input type="checkbox" checked={checks.fees} onChange={() => toggle("fees")} /><span><Check /></span> 含手续费或额外费用</label>}
            <div className="accuracy-note"><Warning weight="fill" /><span><b>{config.reviewTitle}</b><small>{config.reviewHint || "确认后才会写入；原记录不会被覆盖，可随时撤销。"}</small></span></div>
            <div className="confirm-actions"><button className="secondary" onClick={() => setStage("listening")}>返回修改</button><button className="primary" disabled={!allChecked} onClick={() => { onCommitted(config.success); onClose(); }}><CheckCircle weight="fill" /> {config.confirmLabel}</button></div>
          </>
        )}
      </div>
    </div>
  );
}

const actionModalConfig = {
  "add-account": {
    eyebrow: "资产数据",
    title: "添加账户",
    description: "先补充账户基础信息。金额会进入待确认区，不会直接覆盖现有总账。",
    submit: "保存到账户草稿",
  },
  "add-transaction": {
    eyebrow: "流水记录",
    title: "添加流水",
    description: "补充一笔收入、支出或转账。保存后先进入待对账区。",
    submit: "保存流水草稿",
  },
  "add-item": {
    eyebrow: "财务日程",
    title: "添加事项",
    description: "记录需要准备、核对或跟进的事项；需要时可同时设置提醒。",
    submit: "保存事项",
  },
  "edit-target": {
    eyebrow: "资产规划",
    title: "调整配置目标",
    description: "修改目标只影响规划与模拟建议，不会改变真实持仓。",
    submit: "保存目标草稿",
  },
  "import-insurance": {
    eyebrow: "保险管家",
    title: "导入保单信息",
    description: "上传文件或粘贴保单文字，AI 会先提取关键日期与金额供你核对。",
    submit: "开始解析",
  },
};

function ActionModal({ type, onClose, onSubmit, onNavigate }) {
  const config = actionModalConfig[type];
  const [accountMethod, setAccountMethod] = useState("手动录入");
  const [reminderEnabled, setReminderEnabled] = useState(true);

  const submit = (event) => {
    event.preventDefault();
    onSubmit(type);
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="action-modal" role="dialog" aria-modal="true" aria-labelledby="action-modal-title" onSubmit={submit}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="关闭"><X /></button>
        <div className="action-modal-head">
          <span>{type === "add-account" ? <Wallet /> : type === "add-transaction" ? <Receipt /> : type === "add-item" ? <CalendarBlank /> : type === "edit-target" ? <Target /> : <ShieldCheck />}</span>
          <div><small>{config.eyebrow}</small><h2 id="action-modal-title">{config.title}</h2><p>{config.description}</p></div>
        </div>

        {type === "add-account" && (
          <>
            <div className="method-tabs" aria-label="添加账户方式">
              {["手动录入", "文件导入", "连接数据源"].map((item) => <button type="button" key={item} className={accountMethod === item ? "active" : ""} onClick={() => setAccountMethod(item)}>{item}</button>)}
            </div>
            {accountMethod === "手动录入" ? (
              <div className="form-grid">
                <label><span>机构名称</span><input name="institution" placeholder="例如：招商银行" required /></label>
                <label><span>账户类型</span><select name="accountType" defaultValue="活期账户"><option>活期账户</option><option>理财账户</option><option>基金账户</option><option>保险账户</option><option>其他</option></select></label>
                <label><span>账户尾号</span><input name="tail" inputMode="numeric" placeholder="例如：3619" maxLength={8} /></label>
                <label><span>当前余额</span><div className="money-input"><b>¥</b><input name="balance" inputMode="decimal" placeholder="0.00" required /></div></label>
                <label className="full"><span>备注（可选）</span><input name="note" placeholder="例如：日常消费与房租收款账户" /></label>
              </div>
            ) : (
              <button type="button" className="modal-route-card" onClick={() => { onClose(); onNavigate("sources"); }}>
                {accountMethod === "文件导入" ? <FileText /> : <Database />}
                <span><b>{accountMethod === "文件导入" ? "前往文件导入" : "前往数据中心"}</b><small>{accountMethod === "文件导入" ? "支持 Markdown、CSV、PDF 与图片" : "连接飞书多维表、API 或 MCP"}</small></span>
                <ArrowRight />
              </button>
            )}
          </>
        )}

        {type === "add-transaction" && (
          <div className="form-grid">
            <label><span>流水类型</span><select defaultValue="支出"><option>收入</option><option>支出</option><option>账户转账</option><option>投资交易</option></select></label>
            <label><span>发生日期</span><input type="date" defaultValue="2026-07-23" required /></label>
            <label><span>账户</span><select defaultValue="招商银行"><option>招商银行</option><option>建设银行</option><option>工商银行</option><option>现金</option></select></label>
            <label><span>金额</span><div className="money-input"><b>¥</b><input inputMode="decimal" placeholder="0.00" required /></div></label>
            <label className="full"><span>分类与说明</span><input placeholder="例如：家庭日用品" required /></label>
            <label className="full"><span>备注（可选）</span><textarea rows="3" placeholder="补充商户、用途或对账线索…" /></label>
          </div>
        )}

        {type === "add-item" && (
          <div className="form-grid">
            <label><span>事项类型</span><select defaultValue="租金"><option>租金</option><option>保险</option><option>理财到期</option><option>闲置资金</option><option>自定义</option></select></label>
            <label><span>关注日期</span><input type="date" defaultValue="2026-07-25" required /></label>
            <label className="full"><span>事项标题</span><input placeholder="例如：确认滨江公寓租金到账" required /></label>
            <label className="full"><span>事项内容</span><textarea rows="4" placeholder="记录需要核对、准备或跟进的内容…" required /></label>
            <label className="reminder-toggle full"><span><b>同时创建提醒</b><small>默认在关注日期前 3 天和当天提醒</small></span><input type="checkbox" checked={reminderEnabled} onChange={() => setReminderEnabled((value) => !value)} /></label>
          </div>
        )}

        {type === "edit-target" && (
          <div className="form-grid">
            <label><span>风险偏好</span><select defaultValue="均衡"><option>稳健</option><option>均衡</option><option>进取</option></select></label>
            <label><span>活期安全垫</span><div className="money-input"><b>¥</b><input inputMode="decimal" defaultValue="50000" /></div></label>
            <label><span>稳健资产目标</span><div className="percent-input"><input inputMode="numeric" defaultValue="42" /><b>%</b></div></label>
            <label><span>权益资产上限</span><div className="percent-input"><input inputMode="numeric" defaultValue="30" /><b>%</b></div></label>
          </div>
        )}

        {type === "import-insurance" && (
          <div className="insurance-import">
            <button type="button" className="upload-zone"><UploadSimple /><b>选择保单 PDF 或图片</b><small>Demo 中仅展示解析流程，不会上传真实文件</small></button>
            <div className="import-divider"><span>或者</span></div>
            <label><span>粘贴保单文字</span><textarea rows="5" placeholder="粘贴缴费日、保费、分红日、犹豫期等信息…" /></label>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>取消</button>
          <button type="submit" className="primary">{config.submit} <ArrowRight /></button>
        </div>
      </form>
    </div>
  );
}

function ContextVoiceButton({ active, onVoice }) {
  const voiceCopy = {
    overview: ["告诉 Folio 发生了什么", "记录资产变化、大额消费或到账"],
    assets: ["语音补充资产变化", "说出开户、买入、卖出或转账"],
    cashflow: ["语音记录一笔流水", "说出金额、账户与收支用途"],
    planning: ["语音说出配置目标", "例如调整安全垫或风险偏好"],
    reminders: ["语音添加事项", "记录租金、保险或产品到期节点"],
    sources: ["语音补录最新数据", "口语输入会先生成核对清单"],
    settings: ["语音描述你的偏好", "调整字段、提醒与安全规则"],
  };
  const copy = voiceCopy[active] || voiceCopy.overview;

  return (
    <button className="floating-ai context-voice" onClick={onVoice}>
      <span><Sparkle weight="fill" /></span>
      <div><b>{copy[0]}</b><small>{copy[1]}</small></div>
      <Microphone weight="fill" />
    </button>
  );
}

export function App({ showDemoBanner = true }) {
  const [active, setActive] = useState("overview");
  const [hidden, setHidden] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [actionModal, setActionModal] = useState("");
  const [summaryFieldKey, setSummaryFieldKey] = useState("availableCash");

  const summaryFields = {
    availableCash: { label: "活期可用", value: "¥186,400" },
    liability: { label: "总负债", value: "¥246,300" },
    investable: { label: "可规划资金", value: "¥128,500" },
  };
  const title = useMemo(() => ({
    ...Object.fromEntries(navItems.map((item) => [item.id, item.label])),
    sources: "数据中心",
    settings: "设置",
  })[active] || "总览", [active]);
  const notify = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 4200);
  };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [active]);

  const content = {
    overview: <Dashboard hidden={hidden} onToggleHidden={() => setHidden((v) => !v)} onNavigate={setActive} onNotify={notify} onOpenAction={setActionModal} summaryField={summaryFields[summaryFieldKey]} />,
    assets: <AssetsPage hidden={hidden} onNotify={notify} onNavigate={setActive} onOpenAction={setActionModal} />,
    cashflow: <CashflowPage hidden={hidden} onNotify={notify} onOpenAction={setActionModal} />,
    planning: <PlanningPage hidden={hidden} onNotify={notify} onOpenAction={setActionModal} />,
    reminders: <RemindersPage onNotify={notify} onOpenAction={setActionModal} />,
    assistant: <AssistantPage onVoice={() => setVoiceOpen(true)} />,
    sources: <DataSourcesPage onNotify={notify} onVoice={() => setVoiceOpen(true)} />,
    settings: <SettingsPage summaryFieldKey={summaryFieldKey} onSummaryFieldChange={(key) => { setSummaryFieldKey(key); notify(`首页指标已切换为“${summaryFields[key].label}”`); }} onNotify={notify} />,
  }[active];

  return (
    <div className={`app-shell${showDemoBanner ? " public-demo-app" : ""}`}>
      {showDemoBanner && (
        <div className="public-demo-banner" role="status">
          <Flask weight="fill" />
          <span><b>公开虚构演示</b> · 不含、不保存也不应输入真实财务数据</span>
        </div>
      )}
      <Sidebar active={active} onChange={setActive} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      {mobileOpen && <button className="mobile-scrim" onClick={() => setMobileOpen(false)} aria-label="关闭菜单" />}
      <main className="main-area">
        <Header title={title} onMenu={() => setMobileOpen(true)} />
        <div className="page-content">{content}</div>
      </main>
      <nav className="mobile-nav" aria-label="移动端导航">
        {navItems.slice(0, 2).map((item) => { const Icon = item.icon; return <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => setActive(item.id)}><Icon weight={active === item.id ? "fill" : "regular"} /><span>{item.label}</span></button>; })}
        {active === "assistant" ? <span className="mobile-voice-spacer" aria-hidden="true" /> : (
          <button className="mobile-voice-button" onClick={() => setVoiceOpen(true)} aria-label="语音记一笔">
            <i><Microphone weight="fill" /></i>
            <span>记一笔</span>
          </button>
        )}
        {navItems.filter((item) => item.id === "reminders" || item.id === "assistant").map((item) => { const Icon = item.icon; return <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => setActive(item.id)}><Icon weight={active === item.id ? "fill" : "regular"} /><span>{item.label}</span></button>; })}
      </nav>
      {active !== "assistant" && <ContextVoiceButton active={active} onVoice={() => setVoiceOpen(true)} />}
      {actionModal && <ActionModal key={actionModal} type={actionModal} onClose={() => setActionModal("")} onNavigate={setActive} onSubmit={(type) => {
        const messages = {
          "add-account": "账户草稿已保存，等待确认后写入资产",
          "add-transaction": "流水草稿已保存，等待账单对账",
          "add-item": "事项已保存，并加入财务日程",
          "edit-target": "配置目标草稿已保存，模拟沙盘已同步更新",
          "import-insurance": "保单解析任务已创建，结果将先进入核对清单",
        };
        notify(messages[type]);
        setActionModal("");
      }} />}
      {voiceOpen && <VoiceModal active={active} onClose={() => setVoiceOpen(false)} onCommitted={notify} />}
      {toast && <div className="toast"><CheckCircle weight="fill" /><span><b>操作已完成</b><small>{toast}</small></span><button onClick={() => setToast("")}><X /></button></div>}
    </div>
  );
}
