import demoMarkdown from "../../docs/demo/Folio_冷启动全量演示数据.md?raw";
import { deriveConfirmedAssetTrend } from "../data/local/assetTrend.js";
import { parseStructuredFolioMarkdown } from "../services/import/structuredMarkdownImport.js";

const E2E_PASSWORD = "Folio-E2E-Only-2026";
const EXPECTED_CNY_NET_MINOR = 231_486_417;

function assert(condition, message) {
  if (!condition) throw new Error(`E2E 断言失败：${message}`);
}

async function assertRejects(operation, message) {
  try {
    await operation();
  } catch {
    return true;
  }
  throw new Error(`E2E 断言失败：${message}`);
}

function financialSignature(snapshot) {
  return JSON.stringify({
    accounts: snapshot.accounts.length,
    holdings: snapshot.holdings.length,
    transactions: snapshot.transactions.length,
    reminders: snapshot.reminders.length,
    planningVersion: snapshot.planning?.versionId ?? null,
    balances: snapshot.balances
      .map((item) => [item.accountId, item.currency, item.balanceMinor])
      .sort(([left], [right]) => left.localeCompare(right)),
    cnyNetMinor: cnyNetMinor(snapshot),
  });
}

function decimalFromMicros(value) {
  const units = Number(value) / 1_000_000;
  assert(Number.isFinite(units), "持仓数量必须可以安全转换");
  return units.toFixed(6).replace(/\.?0+$/, "");
}

function cnyNetMinor(snapshot) {
  const accountById = new Map(snapshot.accounts.map((account) => [account.id, account]));
  return snapshot.balances.reduce((sum, balance) => {
    const account = accountById.get(balance.accountId);
    return account?.currency === "CNY" ? sum + balance.balanceMinor : sum;
  }, 0);
}

function assertHoldingReconciliation(snapshot, accountName, expectedMinor) {
  const account = snapshot.accounts.find((item) => item.displayName === accountName);
  assert(account, `缺少账户：${accountName}`);
  const balance = snapshot.balances.find((item) => item.accountId === account.id)?.balanceMinor;
  const holdingsMinor = snapshot.holdings
    .filter((item) => item.accountId === account.id && !item.archivedAt)
    .reduce((sum, item) => sum + item.marketValueMinor, 0);
  assert(balance === expectedMinor, `${accountName} 余额不正确`);
  assert(holdingsMinor === expectedMinor, `${accountName} 持仓未与账户余额对账`);
}

function verifySnapshot(snapshot, expectedTransactions, expectedNetMinor) {
  assert(snapshot.accounts.length === 9, "应有 9 个账户");
  assert(snapshot.holdings.length === 7, "应有 7 个持仓");
  assert(snapshot.transactions.length === expectedTransactions, `应有 ${expectedTransactions} 笔流水`);
  assert(snapshot.reminders.length === 9, "应有 9 个事项");
  assert(snapshot.planning?.allocations?.length === 6, "应有 1 个六类长期规划");
  assert(cnyNetMinor(snapshot) === expectedNetMinor, "CNY 净资产不正确");
  assertHoldingReconciliation(snapshot, "投资账户", 38_640_000);
  assertHoldingReconciliation(snapshot, "银行理财账户", 18_000_000);

  const trend = deriveConfirmedAssetTrend({
    now: new Date("2026-08-14T12:00:00+08:00"),
    months: 6,
    baseCurrency: "CNY",
    accounts: snapshot.accounts,
    balances: snapshot.balances,
    transactions: snapshot.transactions,
  });
  assert(trend.length === 6, "资产趋势应覆盖近 6 个月");
  assert(new Set(trend.map((item) => item.totalMinor)).size > 1, "资产趋势不应是空白或水平线");
  return trend;
}

async function importFullSnapshot(repository, batch) {
  const accountIds = {};
  for (const item of batch.accounts) {
    const draft = await repository.createAccountDraft(item.request);
    await repository.confirmAccountDraft(draft.draftId);
    accountIds[item.key] = draft.accountId;
  }
  for (const item of batch.holdings) {
    const draft = await repository.createHoldingDraft({
      ...item.request,
      accountId: accountIds[item.accountKey],
    });
    await repository.confirmHoldingDraft(draft.draftId);
  }
  for (const item of batch.transactions) {
    const draft = await repository.createTransactionDraft({
      ...item.request,
      accountId: accountIds[item.accountKey],
      destinationAccountId: item.destinationAccountKey
        ? accountIds[item.destinationAccountKey]
        : null,
    });
    await repository.confirmTransactionDraft(draft.draftId);
  }
  for (const item of batch.reminders) {
    const draft = await repository.createReminderDraft({
      ...item.request,
      linkedAccountId: item.accountKey ? accountIds[item.accountKey] : null,
    });
    await repository.confirmReminderDraft(draft.draftId);
  }
  const planningDraft = await repository.savePlanningDraft(batch.planning.request);
  await repository.confirmPlanningDraft(planningDraft.draftId);
  return accountIds;
}

async function createIsolatedVault(controller) {
  return controller.createVault({
    vaultId: "primary",
    displayName: "Folio 桌面完整路径测试",
    baseCurrency: "CNY",
    password: E2E_PASSWORD,
  });
}

export async function runNativeDesktopE2E({ adapter, controller, repository, onProgress }) {
  const batch = parseStructuredFolioMarkdown(demoMarkdown);
  assert(batch.status === "reviewable", "测试 Markdown 必须可核对");
  assert(batch.counts.transactions === 26, "测试 Markdown 应提供 26 笔跨月流水");

  onProgress("创建隔离的本地加密数据…");
  let lockState = await createIsolatedVault(controller);

  onProgress("按依赖顺序确认 52 项冷启动数据…");
  let accountIds = await importFullSnapshot(repository, batch);
  const initial = await repository.getSnapshot();
  verifySnapshot(initial, 26, EXPECTED_CNY_NET_MINOR);

  onProgress("运行重复导入、取消草稿与异常输入对抗测试…");
  const initialSignature = financialSignature(initial);
  await assertRejects(
    () => repository.createAccountDraft(batch.accounts[0].request),
    "已有数据时重复创建同名账户必须被拒绝",
  );
  const cancelledDraft = await repository.createTransactionDraft({
    accountId: accountIds.daily,
    destinationAccountId: null,
    transactionKind: "expense",
    amount: "12.34",
    occurredOn: "2026-08-14",
    description: "E2E 取消草稿：不应入账",
    category: "测试",
    notes: "桌面 E2E 虚构数据",
  });
  assert(
    financialSignature(await repository.getSnapshot()) === initialSignature,
    "未确认草稿不得改变正式账本",
  );
  await repository.rejectTransactionDraft(cancelledDraft.draftId);
  assert(
    financialSignature(await repository.getSnapshot()) === initialSignature,
    "取消草稿后正式账本必须保持不变",
  );
  await assertRejects(
    () => repository.createTransactionDraft({
      accountId: accountIds.daily,
      destinationAccountId: null,
      transactionKind: "expense",
      amount: "1.001",
      occurredOn: "2026-08-14",
      description: "E2E 非法三位小数",
      category: "测试",
      notes: null,
    }),
    "三位小数金额必须被拒绝",
  );
  await assertRejects(
    () => repository.createTransactionDraft({
      accountId: accountIds.usd,
      destinationAccountId: accountIds.daily,
      transactionKind: "transfer",
      amount: "100.00",
      occurredOn: "2026-08-14",
      description: "E2E 跨币种无汇率转账",
      category: "账户调拨",
      notes: null,
    }),
    "没有汇率证据的跨币种转账必须被拒绝",
  );
  assert(
    financialSignature(await repository.getSnapshot()) === initialSignature,
    "异常输入不得留下任何财务变更",
  );

  onProgress("验证日常新增不会覆盖冷启动数据…");
  const incrementalDraft = await repository.createTransactionDraft({
    accountId: accountIds.daily,
    destinationAccountId: null,
    transactionKind: "expense",
    amount: "88.00",
    occurredOn: "2026-08-14",
    description: "E2E 日常新增：午餐",
    category: "餐饮",
    notes: "桌面 E2E 虚构数据",
  });
  const incrementalConfirmation = await repository.confirmTransactionDraft(incrementalDraft.draftId);
  const incremental = await repository.getSnapshot();
  verifySnapshot(incremental, 27, EXPECTED_CNY_NET_MINOR - 8_800);

  onProgress("验证已确认流水的不可变修正链…");
  const correctionDraft = await repository.createTransactionCorrectionDraft({
    transactionId: incrementalConfirmation.transactionId,
    correctionKind: "revise",
    reason: "用户核对后将午餐金额从 88 元修正为 68 元",
    replacement: {
      accountId: accountIds.daily,
      destinationAccountId: null,
      transactionKind: "expense",
      amount: "68.00",
      occurredOn: "2026-08-14",
      description: "E2E 日常新增：午餐（已修正）",
      category: "餐饮",
      notes: "桌面 E2E 虚构数据",
    },
  });
  await repository.confirmTransactionCorrectionDraft(correctionDraft.draftId);
  const corrected = await repository.getSnapshot();
  verifySnapshot(corrected, 28, EXPECTED_CNY_NET_MINOR - 6_800);
  const originalTransaction = corrected.transactions.find(
    (item) => item.id === incrementalConfirmation.transactionId,
  );
  const replacementTransaction = corrected.transactions.find(
    (item) => item.description === "E2E 日常新增：午餐（已修正）",
  );
  assert(originalTransaction?.reversed === true, "原流水必须保留并标记为已修正");
  assert(replacementTransaction?.amountMinor === 6_800, "修正流水金额必须精确为 68 元");
  await assertRejects(
    () => repository.createTransactionCorrectionDraft({
      transactionId: incrementalConfirmation.transactionId,
      correctionKind: "reverse",
      reason: "E2E 重复修正应失败",
      replacement: null,
    }),
    "同一原始流水不得被重复修正",
  );

  onProgress("验证持仓估值、周期提醒与规划更新不污染账本…");
  const beforeValuationNet = cnyNetMinor(corrected);
  const beforeValuationBalances = JSON.stringify(corrected.balances);
  const targetHolding = corrected.holdings.find((item) => item.name === "虚构中证红利基金");
  assert(targetHolding, "应找到用于估值测试的红利基金持仓");
  const valuationDraft = await repository.createHoldingValuationDraft({
    holdingId: targetHolding.id,
    units: decimalFromMicros(targetHolding.unitsMicros),
    costBasis: "110000.00",
    marketValue: "118700.00",
    asOfDate: "2026-08-14",
  });
  await repository.confirmHoldingDraft(valuationDraft.draftId);
  const valued = await repository.getSnapshot();
  const valuedHolding = valued.holdings.find((item) => item.id === targetHolding.id);
  assert(valuedHolding?.marketValueMinor === 11_870_000, "估值快照应更新持仓市值");
  assert(valuedHolding?.valuationCount === targetHolding.valuationCount + 1, "估值历史应追加而非覆盖");
  assert(cnyNetMinor(valued) === beforeValuationNet, "持仓估值不得重复增加净资产");
  assert(JSON.stringify(valued.balances) === beforeValuationBalances, "持仓估值不得改变账户余额");

  const recurringReminder = valued.reminders.find((item) => item.title === "八月租金确认");
  assert(recurringReminder?.dueOn === "2026-08-15", "应找到八月租金周期事项");
  const reminderDraft = await repository.completeReminderDraft(recurringReminder.id);
  assert(
    financialSignature(await repository.getSnapshot()) === financialSignature(valued),
    "未确认完成事项不得改变正式记录",
  );
  await repository.confirmReminderDraft(reminderDraft.draftId);
  const reminderAdvanced = await repository.getSnapshot();
  const nextReminder = reminderAdvanced.reminders.find((item) => item.id === recurringReminder.id);
  assert(nextReminder?.dueOn === "2026-09-15", "周期事项应从原日历锚点顺延一个月");
  assert(nextReminder?.completedOccurrences === 1, "周期事项应保留一次不可变完成历史");
  assert(cnyNetMinor(reminderAdvanced) === beforeValuationNet, "完成事项不得改变账本余额");

  const planningDraft = await repository.savePlanningDraft({
    ...batch.planning.request,
    name: "家庭长期资产规划（E2E 已核对）",
    cashBuffer: "60000.00",
  });
  await repository.confirmPlanningDraft(planningDraft.draftId);
  const planningUpdated = await repository.getSnapshot();
  assert(planningUpdated.planning?.cashBufferMinor === 6_000_000, "规划安全垫应更新为 6 万元");
  assert(cnyNetMinor(planningUpdated) === beforeValuationNet, "规划更新不得改变账本余额");

  onProgress("验证手动锁定、错误密码与错误清空密码…");
  const beforeLockSignature = financialSignature(planningUpdated);
  await controller.lock("e2e_manual_lock");
  await assertRejects(
    () => repository.getSnapshot(),
    "锁定后不得读取任何财务快照",
  );
  await assertRejects(
    () => adapter.unlock({ vaultId: "primary", method: "password", password: "E2E-wrong-password" }),
    "错误密码不得解锁",
  );
  lockState = await controller.unlock({
    vaultId: "primary",
    method: "password",
    password: E2E_PASSWORD,
  });
  assert(
    financialSignature(await repository.getSnapshot()) === beforeLockSignature,
    "正确解锁后数据必须完整保留",
  );
  await assertRejects(
    () => adapter.clearAllData({ vaultId: "primary", currentPassword: "E2E-wrong-password" }),
    "错误密码不得清空本地数据",
  );
  assert(
    financialSignature(await repository.getSnapshot()) === beforeLockSignature,
    "错误清空密码不得删除任何记录",
  );

  onProgress("验证清空后重新录入完整快照…");
  await adapter.clearAllData({ vaultId: "primary", currentPassword: E2E_PASSWORD });
  lockState = await createIsolatedVault(controller);
  accountIds = await importFullSnapshot(repository, batch);
  assert(Object.keys(accountIds).length === 9, "重新录入应重建 9 个账户依赖");
  const reimported = await repository.getSnapshot();
  const trend = verifySnapshot(reimported, 26, EXPECTED_CNY_NET_MINOR);

  return Object.freeze({
    passed: true,
    password: E2E_PASSWORD,
    lockState,
    snapshot: reimported,
    counts: Object.freeze({ accounts: 9, holdings: 7, transactions: 26, reminders: 9, planning: 1 }),
    confirmedDrafts: 52,
    incrementalTransactions: 1,
    adversarialChecks: 8,
    cancelledDraftProtected: true,
    correctionChainVerified: true,
    valuationIsolationVerified: true,
    recurringReminderVerified: true,
    planningIsolationVerified: true,
    lockAndPasswordVerified: true,
    cnyNetMinor: EXPECTED_CNY_NET_MINOR,
    assetTrendPoints: trend.length,
    replacementReimported: true,
  });
}
