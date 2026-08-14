function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.getOwnPropertyNames(value).forEach((key) => deepFreeze(value[key]));
  return Object.freeze(value);
}

module.exports = deepFreeze({
  fictional: true,
  mode: "demo",
  fixtureVersion: "wechat-m1-2026-08-11",
  summary: {
    netWorth: "2,896,380.52",
    totalAssets: "3,142,680.00",
    totalAssetsMinor: 314268000,
    currentAvailable: "186,400.00",
    monthlyCashflow: "+12,680.00",
    liabilities: "246,299.48"
  },
  accounts: [
    { id: "demo-cmb", name: "招商银行日常", type: "现金账户", balance: "684,920.00", balanceMinor: 68492000, tint: "lime", initial: "招" },
    { id: "demo-ccb", name: "建设银行定期", type: "定期存款", balance: "536,300.00", balanceMinor: 53630000, tint: "lilac", initial: "建" },
    { id: "demo-fund", name: "指数基金组合", type: "基金持仓", balance: "420,000.00", balanceMinor: 42000000, tint: "mint", initial: "基" },
    { id: "demo-broker", name: "证券账户", type: "权益投资", balance: "382,580.00", balanceMinor: 38258000, tint: "lilac", initial: "证" },
    { id: "demo-insurance", name: "保险现金价值", type: "保障资产", balance: "291,000.00", balanceMinor: 29100000, tint: "mint", initial: "保" },
    { id: "demo-property", name: "其他长期资产", type: "长期配置", balance: "827,880.00", balanceMinor: 82788000, tint: "lime", initial: "长" }
  ],
  cashflow: [
    { id: "demo-flow-1", title: "租金收入", category: "收入 · 建行", date: "8月11日", amount: "+8,000.00", direction: "income" },
    { id: "demo-flow-2", title: "日用品", category: "支出 · 招行", date: "8月10日", amount: "-368.00", direction: "expense" },
    { id: "demo-flow-3", title: "基金定投", category: "内部转移", date: "8月9日", amount: "2,000.00", direction: "transfer" }
  ],
  reminders: [
    { id: "demo-reminder-1", demo: true, manager: "保险管家", title: "年度保费", date: "8月20日", amount: "10,000.00", tint: "lilac" },
    { id: "demo-reminder-2", demo: true, manager: "租金管家", title: "月度租金", date: "9月1日", amount: "8,000.00", tint: "lime" },
    { id: "demo-reminder-3", demo: true, manager: "到期管家", title: "建行定期到期", date: "10月26日", amount: "300,000.00", tint: "mint" }
  ]
});
