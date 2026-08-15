import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowsLeftRight,
  Bell,
  Buildings,
  CalendarBlank,
  CalendarCheck,
  ChartDonut,
  Check,
  Clock,
  Coins,
  DotsThree,
  Eye,
  EyeSlash,
  EnvelopeSimple,
  FileText,
  Fingerprint,
  Gear,
  HouseLine,
  LockKey,
  ListChecks,
  Microphone,
  PencilSimple,
  Plus,
  Receipt,
  ShieldCheck,
  Sparkle,
  Stop,
  Table,
  Trash,
  UploadSimple,
  UserCircle,
  Vault,
  Wallet,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
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
import {
  ACCOUNT_TYPE_OPTIONS,
  accountTypeLabel,
  createAccountProfileForm,
  createEmptyAccountForm,
  formatMinorAmount,
  presentAccountError,
  toAccountDraftInput,
  toAccountUpdateDraftInput,
  validateAccountForm,
  validateAccountProfileForm,
} from "./data/local/accountDraft.js";
import {
  HOLDING_TYPE_OPTIONS,
  createEmptyHoldingForm,
  createHoldingProfileForm,
  createHoldingValuationForm,
  formatUnitsMicros,
  holdingTypeLabel,
  presentHoldingError,
  toHoldingArchiveDraftInput,
  toHoldingDraftInput,
  toHoldingUpdateDraftInput,
  toHoldingValuationDraftInput,
  validateHoldingForm,
  validateHoldingProfileForm,
  validateHoldingValuationForm,
} from "./data/local/holdingDraft.js";
import {
  HOLDING_OPERATION_OPTIONS,
  changeHoldingOperationKind,
  createHoldingOperationCorrectionForm,
  createHoldingOperationForm,
  holdingOperationLabel,
  presentHoldingOperationError,
  toHoldingOperationDraftInput,
  toHoldingOperationCorrectionDraftInput,
  validateHoldingOperationCorrectionForm,
  validateHoldingOperationForm,
} from "./data/local/holdingOperationDraft.js";
import { createLocalRepository } from "./data/local/localRepository.js";
import { summarizeBaseBalances } from "./data/local/balanceSummary.js";
import {
  dailyChangeLabel,
  deriveDailyChangeHighlights,
} from "./data/local/dailyChangeHighlights.js";
import {
  deriveAssetTrendYAxisDomain,
  deriveConfirmedAssetTrend,
} from "./data/local/assetTrend.js";
import { attachDocumentEvidence } from "./ai/documentEvidence.js";
import { mergeCodexSemanticAnalysis } from "./ai/codexCliProposal.js";
import {
  excerptForModelFact,
  mergeExternalModelFact,
  modelFactIntent,
} from "./ai/externalModelProposal.js";
import { localModelProvider } from "./ai/modelProvider.js";
import { requireNativeSpeechText } from "./ai/nativeSpeech.js";
import { organizeVoiceReview, splitVoiceReviewItems } from "./ai/voiceReview.js";
import {
  formatBackupBytes,
  presentBackupError,
  validateBackupExportForm,
  validateBackupInspection,
  validateBackupRestoreForm,
} from "./security/backupModel.js";
import {
  createPastedTablePayload,
  createImportMapping,
  presentImportError,
  presentImportRowError,
  readImportFile,
  toImportDraftInput,
  validateImportFileMeta,
  validateImportMapping,
} from "./data/local/importDraft.js";
import {
  TRANSACTION_CATEGORIES,
  TRANSACTION_KIND_OPTIONS,
  createEmptyTransactionForm,
  createTransactionFormFromTransaction,
  formatTransactionAmount,
  presentTransactionError,
  toTransactionCorrectionDraftInput,
  toTransactionDraftInput,
  transactionKindLabel,
  validateTransactionCorrection,
  validateTransactionForm,
} from "./data/local/transactionDraft.js";
import {
  REMINDER_CATEGORIES,
  REMINDER_RECURRENCES,
  createReminderForm,
  formatReminderAmount,
  presentReminderError,
  reminderCategoryLabel,
  reminderRecurrenceLabel,
  reminderStatusLabel,
  toReminderDraftInput,
  toReminderUpdateDraftInput,
  validateReminderForm,
} from "./data/local/reminderDraft.js";
import {
  PLANNING_ALLOCATIONS,
  createPlanningForm,
  toPlanningDraftInput,
  validatePlanningForm,
} from "./data/local/planningDraft.js";
import { derivePlanningJourney } from "./data/local/planningJourney.js";
import {
  AppLockController,
  DEFAULT_AUTOMATIC_LOCK_ENABLED,
} from "./security/appLock.js";
import { createBackgroundLockGuard } from "./security/backgroundLockGuard.js";
import { createTauriVaultAdapter } from "./security/tauriVaultAdapter.js";
import {
  DEFAULT_BASE_CURRENCY,
  DEFAULT_VAULT_ID,
  DEFAULT_VAULT_NAME,
  pickInitialVault,
  presentBiometricSettingsError,
  presentPasswordChangeError,
  presentVaultError,
  validatePasswordChange,
  validateVaultPassword,
} from "./security/nativeVaultModel.js";
import { parseCsv, parseTsv } from "./services/import/csvImport.js";
import {
  isStructuredFolioMarkdown,
  parseStructuredFolioMarkdown,
} from "./services/import/structuredMarkdownImport.js";
import {
  downloadStructuredFolioMarkdown,
  serializeStructuredFolioMarkdown,
} from "./services/export/structuredMarkdownExport.js";
import { AssistantWorkspace } from "./components/assistant/AssistantWorkspace.jsx";
import { VoiceWaveCanvas } from "./components/assistant/VoiceWaveCanvas.jsx";
import {
  createNativeSyncController,
  isNativeSyncConfigured,
} from "./sync/nativeSyncController.js";
import {
  EMPTY_NATIVE_SYNC_STATUS,
  NativeSyncSettingsModal,
} from "./sync/NativeSyncSettingsModal.jsx";

const localNavItems = [
  { id: "overview", label: "总览", icon: HouseLine },
  { id: "assets", label: "资产", icon: Wallet },
  { id: "cashflow", label: "流水", icon: Receipt },
  { id: "planning", label: "规划", icon: ChartDonut },
  { id: "reminders", label: "提醒", icon: CalendarBlank },
  { id: "assistant", label: "AI 管家", icon: Sparkle },
];

const localViewLabels = {
  ...Object.fromEntries(localNavItems.map(({ id, label }) => [id, label])),
  settings: "安全设置",
  profile: "我的",
};

const EMPTY_MODEL_PROVIDER_STATUS = Object.freeze({
  providerId: "openai_responses_v1",
  configured: false,
  credentialSource: "none",
  model: "gpt-5.6-terra",
  baseUrl: "https://api.openai.com/v1",
  dataBoundary: "external",
  capabilities: [],
});

const EMPTY_CODEX_CLI_STATUS = Object.freeze({
  providerId: "codex_cli_v1",
  available: false,
  authenticated: false,
  ready: false,
  version: null,
  authMode: "none",
  model: "codex-cli-account-default",
  dataBoundary: "external_via_codex_account",
  inputModalities: ["text", "image"],
  rawAudioSupported: false,
  imageInputSupported: true,
  message: "正在检查 Codex CLI…",
});

const IS_APPLE_MOBILE_RUNTIME = typeof navigator !== "undefined"
  && /iPhone|iPad|iPod/i.test(navigator.userAgent);
const NATIVE_DESKTOP_E2E = import.meta.env.VITE_FOLIO_NATIVE_E2E === "1";
const APPLE_BIOMETRIC_LABEL = IS_APPLE_MOBILE_RUNTIME ? "Face ID / Touch ID" : "Touch ID";
const APPLE_BIOMETRIC_SYSTEM = IS_APPLE_MOBILE_RUNTIME ? "iOS" : "macOS";

function Brand() {
  return (
    <div className="vault-brand">
      <img src="/assets/brand/folio-logo.png" alt="" />
      <span><b>Folio</b><small>财务驾驶舱</small></span>
    </div>
  );
}

export function VaultGate({
  mode,
  vault,
  vaults = [],
  biometric = { available: false, enabled: false },
  busy = false,
  error = "",
  onSelectVault = () => {},
  onCreate = async () => false,
  onPasswordUnlock = async () => false,
  onBiometricUnlock = async () => false,
}) {
  const [displayName, setDisplayName] = useState(DEFAULT_VAULT_NAME);
  const [baseCurrency, setBaseCurrency] = useState(DEFAULT_BASE_CURRENCY);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [enableBiometric, setEnableBiometric] = useState(biometric.available);
  const [validation, setValidation] = useState("");

  useEffect(() => {
    setPassword("");
    setConfirmation("");
    setValidation("");
  }, [mode, vault?.vaultId]);

  useEffect(() => {
    if (!biometric.available) setEnableBiometric(false);
  }, [biometric.available]);

  const submitCreate = async (event) => {
    event.preventDefault();
    const issue = validateVaultPassword(password, confirmation);
    if (issue) {
      setValidation(issue);
      return;
    }
    setValidation("");
    const succeeded = await onCreate({
      vaultId: DEFAULT_VAULT_ID,
      displayName,
      baseCurrency,
      password,
      enableBiometric,
    });
    if (!succeeded) {
      setPassword("");
      setConfirmation("");
    }
  };

  const submitUnlock = async (event) => {
    event.preventDefault();
    const issue = validateVaultPassword(password);
    if (issue) {
      setValidation(issue);
      return;
    }
    setValidation("");
    const succeeded = await onPasswordUnlock(password);
    if (!succeeded) setPassword("");
  };

  const selectedVaultId = vault?.vaultId ?? "";
  const isCreate = mode === "create";
  const title = isCreate ? "开始使用 Folio" : "欢迎回来";
  const description = isCreate
    ? "先设置应用密码。进入后是空白状态，你可以导入一份 Markdown 开始。"
    : "输入应用密码，继续查看你的财务数据。";

  return (
    <main className="vault-gate">
      <section className="vault-story" aria-label="Folio 安全说明">
        <Brand />
        <div className="vault-story-copy">
          <span className="vault-kicker"><ShieldCheck weight="fill" /> 本地优先 · 数据加密</span>
          <h1>你的财务全貌，<br />只在你允许时出现。</h1>
          <p>账本只保存在本机。每次 AI 解析都会明确提示数据边界，结果先进入核对区，不会直接改变资产。</p>
          <div className="vault-promises">
            <div><LockKey /><span><b>临时离开时锁定</b><small>隐藏资产信息，回来后验证身份继续</small></span></div>
            <div><Fingerprint /><span><b>系统级验证</b><small>{APPLE_BIOMETRIC_LABEL} 密钥只存于设备 Keychain</small></span></div>
            <div><Check /><span><b>逐项确认</b><small>真实金额写入前必须明确确认</small></span></div>
          </div>
        </div>
        <div className="vault-story-foot"><ShieldCheck /> Folio 无法读取或恢复你的应用密码</div>
      </section>

      <section className="vault-entry">
        <div className="vault-mobile-brand"><Brand /></div>
        <div className="vault-auth-card">
          <div className="vault-auth-icon">{isCreate ? <Vault weight="duotone" /> : <LockKey weight="duotone" />}</div>
          <span className="vault-auth-eyebrow">{isCreate ? "首次设置" : "本地数据已锁定"}</span>
          <h2>{title}</h2>
          <p>{description}</p>

          {isCreate ? (
            <form onSubmit={submitCreate} className="vault-form">
              <label>
                <span>数据名称</span>
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  autoComplete="organization"
                  maxLength={80}
                  required
                />
              </label>
              <label>
                <span>基础币种</span>
                <select value={baseCurrency} onChange={(event) => setBaseCurrency(event.target.value)}>
                  <option value="CNY">人民币 · CNY</option>
                  <option value="USD">美元 · USD</option>
                  <option value="HKD">港币 · HKD</option>
                </select>
              </label>
              <PasswordField
                label="设置应用密码"
                value={password}
                onChange={setPassword}
                visible={showPassword}
                onToggle={() => setShowPassword((value) => !value)}
                autoComplete="new-password"
              />
              <PasswordField
                label="再次输入密码"
                value={confirmation}
                onChange={setConfirmation}
                visible={showPassword}
                autoComplete="new-password"
              />
              <small className="vault-password-hint">至少 12 个字符。密码只用于解封本地数据密钥，不会写入数据库或 Git。</small>
              {biometric.available && (
                <label className="vault-biometric-option">
                  <input
                    type="checkbox"
                    checked={enableBiometric}
                    onChange={(event) => setEnableBiometric(event.target.checked)}
                  />
                  <i><Check /></i>
                  <Fingerprint />
                  <span><b>同时启用 {APPLE_BIOMETRIC_LABEL}</b><small>应用密码始终保留为恢复方式</small></span>
                </label>
              )}
              {(validation || error) && <VaultError message={validation || error} />}
              <button className="vault-primary" type="submit" disabled={busy || !displayName.trim()}>
                {busy ? "正在初始化本地数据…" : "创建并进入 Folio"} {!busy && <ArrowRight />}
              </button>
            </form>
          ) : (
            <div className="vault-unlock-stack">
              {vaults.length > 1 && (
                <label className="vault-selector">
                  <span>选择本地数据</span>
                  <select value={selectedVaultId} onChange={(event) => onSelectVault(event.target.value)}>
                    {vaults.map((item) => <option key={item.vaultId} value={item.vaultId}>{item.displayName}</option>)}
                  </select>
                </label>
              )}
              {biometric.available && biometric.enabled && (
                <>
                  <button className="vault-touch-button" onClick={onBiometricUnlock} disabled={busy}>
                    <Fingerprint weight="duotone" />
                    <span><b>{busy ? "等待系统验证…" : `使用 ${APPLE_BIOMETRIC_LABEL} 解锁`}</b><small>生物识别由系统验证</small></span>
                    <ArrowRight />
                  </button>
                  <div className="vault-divider"><span>或输入密码</span></div>
                </>
              )}
              <form onSubmit={submitUnlock} className="vault-form compact">
                <PasswordField
                  label="应用密码"
                  value={password}
                  onChange={setPassword}
                  visible={showPassword}
                  onToggle={() => setShowPassword((value) => !value)}
                  autoComplete="current-password"
                />
                {(validation || error) && <VaultError message={validation || error} />}
                <button className="vault-primary" type="submit" disabled={busy}>
                  {busy ? "正在验证…" : "解锁 Folio"} {!busy && <ArrowRight />}
                </button>
              </form>
            </div>
          )}
          <div className="vault-auth-foot"><ShieldCheck /> 本地加密 · 右上角可随时锁定</div>
        </div>
      </section>
    </main>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  visible,
  onToggle,
  autoComplete,
}) {
  return (
    <label className="vault-password-field">
      <span>{label}</span>
      <div>
        <LockKey />
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          spellCheck="false"
          required
        />
        {onToggle && (
          <button type="button" onClick={onToggle} aria-label={visible ? "隐藏密码" : "显示密码"}>
            {visible ? <EyeSlash /> : <Eye />}
          </button>
        )}
      </div>
    </label>
  );
}

function VaultError({ message }) {
  return <div className="vault-error" role="alert"><WarningCircle weight="fill" /><span>{message}</span></div>;
}

function formatBalance(balance) {
  const minor = Number(balance?.balanceMinor ?? balance?.balance_minor ?? 0);
  const currency = balance?.currency ?? "CNY";
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

function formatReviewedChange(before, after) {
  const previous = before || "未填写";
  const next = after || "未填写";
  return previous === next ? `${next}（未变化）` : `${previous} → ${next}`;
}

const petStateCopy = Object.freeze({
  welcome: ["欢迎回来", "猫爪只在本次冷启动出现"],
  idle: ["猫猫在这里", "随时可以告诉 Folio"],
  rest: ["猫猫睡着了", "需要时轻轻叫醒 Folio"],
  processing: ["正在本机整理", "处理好会提醒你核对"],
  ready: ["已经整理好了", "请核对后再写入"],
  needs_input: ["还需要一点信息", "补齐后才能生成草稿"],
  done: ["本次处理完成", "正式变更已经明确确认"],
});

function FolioDeskPet({
  state = "idle",
  pendingCount = 0,
  onOpenInbox,
  placement = "floating",
}) {
  const [title, detail] = petStateCopy[state] ?? petStateCopy.idle;
  const displayTitle = state === "idle" && pendingCount > 0
    ? `${pendingCount} 条待核对`
    : title;
  return (
    <button
      type="button"
      className={`folio-desk-pet state-${state} placement-${placement}`}
      onClick={onOpenInbox}
      aria-label={`${displayTitle}，打开 AI 收件箱`}
      title="打开 AI 收件箱"
    >
      <span
        className={state === "welcome" ? "folio-pet-welcome" : "folio-pet-frame"}
        aria-hidden="true"
      />
      {state === "rest" && (
        <span className="folio-pet-zzz" aria-hidden="true">
          <span>Z</span><span>Z</span><span>Z</span>
        </span>
      )}
      <span className="folio-pet-message">
        <b>{displayTitle}</b>
        <small>{pendingCount > 0 && state === "idle" ? "点击查看本机待核对草稿" : detail}</small>
      </span>
      {pendingCount > 0 && <i>{pendingCount > 99 ? "99+" : pendingCount}</i>}
    </button>
  );
}

const aiInboxKindLabels = Object.freeze({
  account: "账户",
  holding_operation: "产品操作",
  transaction: "流水",
  reminder: "事项",
  planning: "规划",
});

const aiInboxStatusLabels = Object.freeze({
  needs_review: "待核对",
  confirmed: "已确认",
  rejected: "已拒绝",
});

function AiInboxDrawer({
  items,
  loading,
  error,
  onClose,
  onRefresh,
  onNavigate,
}) {
  const pendingCount = items.filter((item) => item.draftStatus === "needs_review").length;
  return (
    <div className="local-inbox-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside className="local-ai-inbox" role="dialog" aria-modal="true" aria-labelledby="local-inbox-title">
        <header>
          <span><Sparkle weight="fill" /></span>
          <div>
            <small>本机加密 · 不自动改账</small>
            <h2 id="local-inbox-title">AI 待核对收件箱</h2>
            <p>{pendingCount > 0 ? `${pendingCount} 条草稿等待处理` : "目前没有未处理的 AI 草稿"}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭 AI 收件箱"><X /></button>
        </header>
        <div className="local-inbox-toolbar">
          <span><ShieldCheck weight="fill" /> 只有明确确认才会影响正式数据</span>
          <button type="button" onClick={() => void onRefresh()} disabled={loading}>
            {loading ? "刷新中…" : "刷新"}
          </button>
        </div>
        {error && <VaultError message={error} />}
        <div className="local-inbox-list">
          {!loading && items.length === 0 && (
            <div className="local-inbox-empty">
              <span className="folio-pet-frame" aria-hidden="true" />
              <b>猫猫没有发现待核对内容</b>
              <small>语音、截图、PDF 和邮件识别结果都会先出现在这里。</small>
            </div>
          )}
          {items.map((item) => (
            <article key={item.proposalId} className={`status-${item.draftStatus}`}>
              <div className="local-inbox-item-icon">
                {item.draftStatus === "needs_review"
                  ? <Clock weight="fill" />
                  : item.draftStatus === "confirmed"
                    ? <Check weight="bold" />
                    : <X weight="bold" />}
              </div>
              <div>
                <span>
                  <b>{aiInboxKindLabels[item.proposalKind] ?? item.proposalKind}</b>
                  <em>{aiInboxStatusLabels[item.draftStatus] ?? item.draftStatus}</em>
                </span>
                <p>{item.transcriptPreview}</p>
                <small>
                  {item.inputKind === "voice" ? "语音" : item.inputKind === "file" ? "文件" : "文字"}
                  {" · "}置信度 {Math.round(Number(item.confidenceBps ?? 0) / 100)}%
                  {" · "}{item.evidenceCount ?? 0} 条来源证据
                </small>
              </div>
              <button
                type="button"
                onClick={() => {
                  onNavigate(item.moduleContext === "assistant" ? "overview" : item.moduleContext);
                  onClose();
                }}
              >
                来源模块 <ArrowRight />
              </button>
            </article>
          ))}
        </div>
      </aside>
    </div>
  );
}

function LocalWorkspace({
  snapshot,
  biometric,
  syncConfig = {},
  syncStatus = EMPTY_NATIVE_SYNC_STATUS,
  localRepository = null,
  onSyncStatusChange = () => {},
  onListSyncConflicts = async () => [],
  onInspectSyncConflict = async () => {
    throw new Error("同步冲突检查服务尚未连接");
  },
  onKeepLocalSyncConflict = async () => {
    throw new Error("同步冲突解决服务尚未连接");
  },
  initialView = "overview",
  initialNotice = "",
  initialFullReimport = null,
  onFullReimportConsumed = () => {},
  onCreateAccountDraft = async () => {
    throw new Error("账户草稿服务尚未连接");
  },
  onConfirmAccountDraft = async () => {
    throw new Error("账户确认服务尚未连接");
  },
  onUpdateAccountDraft = async () => {
    throw new Error("账户编辑服务尚未连接");
  },
  onArchiveAccountDraft = async () => {
    throw new Error("账户归档服务尚未连接");
  },
  onRejectAccountDraft = async () => {},
  onCreateHoldingDraft = async () => {
    throw new Error("持仓草稿服务尚未连接");
  },
  onCreateHoldingValuationDraft = async () => {
    throw new Error("持仓估值服务尚未连接");
  },
  onUpdateHoldingDraft = async () => {
    throw new Error("持仓编辑服务尚未连接");
  },
  onArchiveHoldingDraft = async () => {
    throw new Error("持仓归档服务尚未连接");
  },
  onConfirmHoldingDraft = async () => {
    throw new Error("持仓确认服务尚未连接");
  },
  onRejectHoldingDraft = async () => {},
  onCreateHoldingOperationDraft = async () => {
    throw new Error("产品操作草稿服务尚未连接");
  },
  onConfirmHoldingOperationDraft = async () => {
    throw new Error("产品操作确认服务尚未连接");
  },
  onRejectHoldingOperationDraft = async () => {},
  onCreateHoldingOperationCorrectionDraft = async () => {
    throw new Error("产品操作冲销草稿服务尚未连接");
  },
  onConfirmHoldingOperationCorrectionDraft = async () => {
    throw new Error("产品操作冲销确认服务尚未连接");
  },
  onRejectHoldingOperationCorrectionDraft = async () => {},
  onCreateTransactionDraft = async () => {
    throw new Error("流水草稿服务尚未连接");
  },
  onConfirmTransactionDraft = async () => {
    throw new Error("流水确认服务尚未连接");
  },
  onRejectTransactionDraft = async () => {},
  onCreateTransactionCorrectionDraft = async () => {
    throw new Error("流水修正草稿服务尚未连接");
  },
  onConfirmTransactionCorrectionDraft = async () => {
    throw new Error("流水修正确认服务尚未连接");
  },
  onRejectTransactionCorrectionDraft = async () => {},
  onInspectTransactionImport = async () => {
    throw new Error("文件解析服务尚未连接");
  },
  onCreateTransactionImportDraft = async () => {
    throw new Error("导入草稿服务尚未连接");
  },
  onConfirmTransactionImportDraft = async () => {
    throw new Error("导入确认服务尚未连接");
  },
  onRejectTransactionImportDraft = async () => {},
  onCreateReminderDraft = async () => {
    throw new Error("事项草稿服务尚未连接");
  },
  onUpdateReminderDraft = async () => {
    throw new Error("事项编辑服务尚未连接");
  },
  onCompleteReminderDraft = async () => {
    throw new Error("事项完成服务尚未连接");
  },
  onArchiveReminderDraft = async () => {
    throw new Error("事项归档服务尚未连接");
  },
  onConfirmReminderDraft = async () => {
    throw new Error("事项确认服务尚未连接");
  },
  onRejectReminderDraft = async () => {},
  onSavePlanningDraft = async () => {
    throw new Error("规划草稿服务尚未连接");
  },
  onConfirmPlanningDraft = async () => {
    throw new Error("规划确认服务尚未连接");
  },
  onRejectPlanningDraft = async () => {},
  onRecordAiProposal = async () => {
    throw new Error("AI 提案证据服务尚未连接");
  },
  codexCliStatus = EMPTY_CODEX_CLI_STATUS,
  onRefreshCodexCliStatus = async () => EMPTY_CODEX_CLI_STATUS,
  onAnalyzeFinanceInputWithCodex = null,
  modelProviderStatus = EMPTY_MODEL_PROVIDER_STATUS,
  onExtractFinancialFactsWithModel = null,
  onRefreshModelProvider = async () => EMPTY_MODEL_PROVIDER_STATUS,
  onConfigureModelProvider = async () => {
    throw new Error("模型密钥保存服务尚未连接");
  },
  onRemoveModelProvider = async () => {
    throw new Error("模型密钥移除服务尚未连接");
  },
  onTestModelProvider = async () => {
    throw new Error("模型连接测试服务尚未连接");
  },
  aiInbox = [],
  aiInboxLoading = false,
  aiInboxError = "",
  onRefreshAiInbox = async () => [],
  onSelectDocumentEvidence = async () => {
    throw new Error("本地文件识别服务尚未连接");
  },
  documentCapability = "native",
  onTranscribeSpeech = null,
  onStopSpeechCapture = null,
  knownVaults = [],
  onCreateBackup = async () => {
    throw new Error("备份导出服务尚未连接");
  },
  onCreateDataExport = async () => {
    throw new Error("可移植数据导出服务尚未连接");
  },
  onSaveMarkdownExport = null,
  onClearAllData = async () => {
    throw new Error("数据清除服务尚未连接");
  },
  onSelectBackup = async () => ({ status: "cancelled" }),
  onInspectBackup = async () => {
    throw new Error("备份检查服务尚未连接");
  },
  onDiscardBackupSelection = async () => {},
  onConfirmBackupRestore = async () => {
    throw new Error("备份恢复服务尚未连接");
  },
  notificationStatus = {
    supported: true,
    permission: "not_determined",
    enabled: false,
    privacyMode: "generic",
    deliveryHour: 9,
    scheduledCount: 0,
    nextScheduledAt: null,
  },
  onEnableNotifications = async () => {
    throw new Error("系统通知服务尚未连接");
  },
  onDisableNotifications = async () => {
    throw new Error("系统通知服务尚未连接");
  },
  onEnableBiometric = async () => {
    throw new Error("Touch ID 设置服务尚未连接");
  },
  onDisableBiometric = async () => {
    throw new Error("Touch ID 设置服务尚未连接");
  },
  onChangePassword = async () => {
    throw new Error("应用密码修改服务尚未连接");
  },
  onBeginFullReimport = async () => {
    throw new Error("全量重录服务尚未连接");
  },
  onViewChange = () => {},
  onLock,
}) {
  const [active, setActiveState] = useState(initialView);
  const [navigationContext, setNavigationContext] = useState(null);
  const setActive = useCallback((nextActive, context = null) => {
    setNavigationContext(context);
    setActiveState(nextActive);
    onViewChange(nextActive);
  }, [onViewChange]);
  const [notice, setNotice] = useState(() => (
    initialNotice ? { message: initialNotice, tone: "warning" } : null
  ));
  const [voiceOpen, setVoiceOpen] = useState(Boolean(initialFullReimport));
  const [captureIntent, setCaptureIntent] = useState(initialFullReimport ? "file" : "voice");
  const [pendingFullReimport, setPendingFullReimport] = useState(initialFullReimport);
  const [fullReimportBatch, setFullReimportBatch] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [amountsHidden, setAmountsHidden] = useState(false);
  const [aiInboxOpen, setAiInboxOpen] = useState(false);
  const [dailyHighlightClock, setDailyHighlightClock] = useState(() => new Date());
  const [petState, setPetState] = useState(() => (
    import.meta.env.DEV && new URLSearchParams(window.location.search).get("pet-preview") === "rest"
      ? "rest"
      : "welcome"
  ));
  const [petActivityKey, setPetActivityKey] = useState(0);
  const syncConfigured = isNativeSyncConfigured(syncConfig);
  const nativeSyncController = useMemo(() => {
    if (!syncConfigured || !localRepository) return null;
    return createNativeSyncController({
      config: syncConfig,
      localRepository,
    });
  }, [
    localRepository,
    syncConfig?.passkeyAuthEnabled,
    syncConfig?.supabasePublishableKey,
    syncConfig?.supabaseUrl,
    syncConfigured,
  ]);
  const vault = snapshot?.vault ?? {};
  const rawAccounts = Array.isArray(snapshot?.accounts) ? snapshot.accounts : [];
  const balances = Array.isArray(snapshot?.balances) ? snapshot.balances : [];
  const holdings = Array.isArray(snapshot?.holdings) ? snapshot.holdings : [];
  const holdingOperations = Array.isArray(snapshot?.holdingOperations)
    ? snapshot.holdingOperations
    : [];
  const accounts = rawAccounts.map((account) => ({
    ...account,
    activeHoldingCount: Number.isSafeInteger(account.activeHoldingCount)
      ? account.activeHoldingCount
      : holdings.filter((holding) => (
        holding.accountId === account.id && !holding.archivedAt
      )).length,
  }));
  const transactions = Array.isArray(snapshot?.transactions) ? snapshot.transactions : [];
  const reminders = Array.isArray(snapshot?.reminders) ? snapshot.reminders : [];
  const activeReminderCount = reminders.filter((item) => item.status === "active").length;
  const imports = Array.isArray(snapshot?.imports) ? snapshot.imports : [];
  const planning = snapshot?.planning ?? null;
  const baseCurrency = vault.baseCurrency ?? "CNY";
  const dailyChanges = useMemo(() => deriveDailyChangeHighlights({
    accounts,
    holdings,
    holdingOperations,
    transactions,
    reminders,
    planning,
  }, new Date()), [
    accounts,
    dailyHighlightClock,
    holdingOperations,
    holdings,
    planning,
    reminders,
    transactions,
  ]);
  const {
    netMinor: totalMinor,
    assetMinor,
    availableCashMinor,
    availableCashAccountCount,
  } = summarizeBaseBalances({ balances, accounts, holdings, baseCurrency });
  const assetTrend = useMemo(() => deriveConfirmedAssetTrend({
    now: dailyHighlightClock,
    baseCurrency,
    accounts,
    balances,
    transactions,
  }), [accounts, balances, baseCurrency, dailyHighlightClock, transactions]);

  useEffect(() => {
    if (initialNotice) {
      setNotice({ message: initialNotice, tone: "warning" });
    }
  }, [initialNotice]);

  useEffect(() => {
    if (!NATIVE_DESKTOP_E2E) return;
    window.localStorage.setItem("folio-native-e2e-active-view", initialView);
  }, [initialView]);

  useEffect(() => {
    const now = new Date();
    const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const nextHighlightExpiry = Date.parse(dailyChanges.nextExpiryAt ?? "");
    const nextRefreshAt = Number.isFinite(nextHighlightExpiry)
      ? Math.min(nextDay.getTime(), nextHighlightExpiry)
      : nextDay.getTime();
    const timer = window.setTimeout(
      () => setDailyHighlightClock(new Date()),
      Math.max(250, nextRefreshAt - now.getTime() + 50),
    );
    return () => window.clearTimeout(timer);
  }, [dailyChanges.nextExpiryAt]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPetState((current) => current === "welcome" ? "idle" : current);
    }, 3200);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (petState !== "idle") return undefined;
    const timer = window.setTimeout(() => {
      setPetState((current) => current === "idle" ? "rest" : current);
    }, 45_000);
    return () => window.clearTimeout(timer);
  }, [petActivityKey, petState]);

  const registerPetActivity = (event) => {
    setPetActivityKey((current) => current + 1);
    if (event?.target?.closest?.(".folio-desk-pet")) return;
    setPetState((current) => current === "rest" ? "idle" : current);
  };

  const openCapture = (intent = "voice", pendingBatch = null) => {
    setCaptureIntent(intent);
    setPendingFullReimport(pendingBatch);
    setPetState("idle");
    setVoiceOpen(true);
  };

  const exportMarkdown = async () => {
    try {
      const content = serializeStructuredFolioMarkdown({
        ...snapshot,
        accounts,
        balances,
        holdings,
        transactions,
        reminders,
        planning,
      });
      const fileName = `Folio-data-${new Date().toISOString().slice(0, 10)}.md`;
      const result = onSaveMarkdownExport
        ? await onSaveMarkdownExport({ content, fileName })
        : downloadStructuredFolioMarkdown(content, fileName);
      if (result?.status !== "cancelled") {
        setNotice({ message: `Markdown 已导出：${result?.fileName ?? fileName}`, tone: "success" });
        window.setTimeout(() => setNotice(null), 4200);
      }
      return result;
    } catch (nextError) {
      setNotice({
        message: typeof nextError?.message === "string" ? nextError.message : "Markdown 导出失败，请稍后再试。",
        tone: "warning",
      });
      window.setTimeout(() => setNotice(null), 4200);
      return null;
    }
  };

  let content;
  if (active === "overview") {
    content = (
      <LocalOverview
        vault={vault}
        accounts={accounts}
        totalMinor={totalMinor}
        assetMinor={assetMinor}
        availableCashMinor={availableCashMinor}
        availableCashAccountCount={availableCashAccountCount}
        holdings={holdings}
        assetTrend={assetTrend}
        transactions={transactions}
        reminders={reminders}
        planning={planning}
        dailyChanges={dailyChanges}
        syncStatus={syncStatus}
        hidden={amountsHidden}
        onToggleHidden={() => setAmountsHidden((current) => !current)}
        onNavigate={setActive}
        onCapture={openCapture}
      />
    );
  } else if (active === "assets") {
    content = (
      <LocalAssets
        accounts={accounts}
        holdings={holdings}
        holdingOperations={holdingOperations}
        dailyChanges={dailyChanges}
        baseCurrency={baseCurrency}
        onCreateDraft={onCreateAccountDraft}
        onUpdateDraft={onUpdateAccountDraft}
        onArchiveDraft={onArchiveAccountDraft}
        onConfirmDraft={onConfirmAccountDraft}
        onRejectDraft={onRejectAccountDraft}
        onCreateHoldingDraft={onCreateHoldingDraft}
        onCreateHoldingValuationDraft={onCreateHoldingValuationDraft}
        onUpdateHoldingDraft={onUpdateHoldingDraft}
        onArchiveHoldingDraft={onArchiveHoldingDraft}
        onConfirmHoldingDraft={onConfirmHoldingDraft}
        onRejectHoldingDraft={onRejectHoldingDraft}
        onCreateHoldingOperationDraft={onCreateHoldingOperationDraft}
        onConfirmHoldingOperationDraft={onConfirmHoldingOperationDraft}
        onRejectHoldingOperationDraft={onRejectHoldingOperationDraft}
        onCreateHoldingOperationCorrectionDraft={onCreateHoldingOperationCorrectionDraft}
        onConfirmHoldingOperationCorrectionDraft={onConfirmHoldingOperationCorrectionDraft}
        onRejectHoldingOperationCorrectionDraft={onRejectHoldingOperationCorrectionDraft}
        onHoldingCommitted={(action) => {
          setNotice({
            message: action === "correction"
              ? "产品操作已补偿式冲销：原记录保留，反向估值与账本事件已原子追加。"
              : action === "operation"
              ? "产品操作已确认：持仓快照与必要的双边账本流水已原子写入。"
              : action === "valuation"
              ? "新估值已确认追加；历史估值继续保留，账户余额没有改变。"
              : action === "update"
                ? "持仓资料已确认更新；估值历史与账户余额保持不变。"
                : action === "archive"
                  ? "持仓已安全归档；全部历史估值继续保留。"
                  : "持仓与首个估值已确认写入本地数据；不会重复计入账户余额。",
            tone: "success",
          });
          window.setTimeout(() => setNotice(null), 4200);
        }}
        onCommitted={(action) => {
          setNotice({
            message: action === "update"
              ? "账户信息已确认更新，账本余额保持不变。"
              : action === "archive"
                ? "零余额账户已安全归档，历史账本仍然保留。"
                : "账户与期初余额已确认写入加密账本。",
            tone: "success",
          });
          window.setTimeout(() => setNotice(null), 4200);
        }}
        onNavigate={setActive}
        initialAccountId={navigationContext?.accountId ?? null}
      />
    );
  } else if (active === "cashflow") {
    content = (
      <LocalCashflow
        accounts={accounts}
        transactions={transactions}
        dailyChanges={dailyChanges}
        baseCurrency={baseCurrency}
        onNavigate={setActive}
        onCreateDraft={onCreateTransactionDraft}
        onConfirmDraft={onConfirmTransactionDraft}
        onRejectDraft={onRejectTransactionDraft}
        onCreateCorrectionDraft={onCreateTransactionCorrectionDraft}
        onConfirmCorrectionDraft={onConfirmTransactionCorrectionDraft}
        onRejectCorrectionDraft={onRejectTransactionCorrectionDraft}
        importHistory={imports}
        onInspectImport={onInspectTransactionImport}
        onCreateImportDraft={onCreateTransactionImportDraft}
        onConfirmImportDraft={onConfirmTransactionImportDraft}
        onRejectImportDraft={onRejectTransactionImportDraft}
        onCommitted={(action = "create") => {
          const message = action === "import"
            ? "文件流水已确认导入；来源指纹、逐行结果和对账报告已写入本地数据。"
            : action === "reverse"
            ? "流水已通过反向事件安全冲销，原记录与原因继续保留。"
            : action === "revise"
              ? "流水已原子修订：原记录已冲销，更正记录已写入。"
              : "流水已确认写入追加式加密账本。";
          setNotice({
            message,
            tone: "success",
          });
          window.setTimeout(() => setNotice(null), 4200);
        }}
      />
    );
  } else if (active === "reminders") {
    content = (
      <LocalReminders
        accounts={accounts}
        reminders={reminders}
        dailyChanges={dailyChanges}
        baseCurrency={baseCurrency}
        onCreateDraft={onCreateReminderDraft}
        onUpdateDraft={onUpdateReminderDraft}
        onCompleteDraft={onCompleteReminderDraft}
        onArchiveDraft={onArchiveReminderDraft}
        onConfirmDraft={onConfirmReminderDraft}
        onRejectDraft={onRejectReminderDraft}
        onCommitted={(action, nextDueOn) => {
          const messages = {
            create: "财务事项已确认添加，并进入本地加密日程。",
            update: "事项修改已确认保存，原始变化已写入审计记录。",
            complete: nextDueOn
              ? `本期事项已完成并留痕，下一期已安排至 ${nextDueOn}。`
              : "事项已标记完成，处理历史继续保留。",
            archive: "事项已归档，历史与审计记录继续保留。",
          };
          setNotice({ message: messages[action] ?? "事项变更已确认。", tone: "success" });
          window.setTimeout(() => setNotice(null), 4200);
        }}
      />
    );
  } else if (active === "planning") {
    content = (
      <LocalPlanning
        planning={planning}
        dailyChanges={dailyChanges}
        accounts={accounts}
        balances={balances}
        holdings={holdings}
        reminders={reminders}
        totalMinor={totalMinor}
        baseCurrency={baseCurrency}
        now={dailyHighlightClock}
        onSaveDraft={onSavePlanningDraft}
        onConfirmDraft={onConfirmPlanningDraft}
        onRejectDraft={onRejectPlanningDraft}
        onCreateReminderDraft={onCreateReminderDraft}
        onUpdateReminderDraft={onUpdateReminderDraft}
        onCompleteReminderDraft={onCompleteReminderDraft}
        onArchiveReminderDraft={onArchiveReminderDraft}
        onConfirmReminderDraft={onConfirmReminderDraft}
        onRejectReminderDraft={onRejectReminderDraft}
        onGoalCommitted={() => {
          setNotice({ message: "未来用款目标已确认，并同步进入财务事项。", tone: "success" });
          window.setTimeout(() => setNotice(null), 4200);
        }}
        onCommitted={() => {
          setNotice({
            message: "规划目标已明确确认并写入加密档案；真实余额和账本没有改变。",
            tone: "success",
          });
          window.setTimeout(() => setNotice(null), 4200);
        }}
      />
    );
  } else if (active === "profile") {
    content = (
      <LocalProfile
        vault={vault}
        biometric={biometric}
        syncStatus={syncStatus}
        onNavigate={setActive}
      />
    );
  } else if (active === "settings") {
    content = (
      <LocalSecuritySettings
        snapshot={{ ...snapshot, accounts, balances, holdings, transactions, reminders, planning }}
        accounts={accounts}
        localRepository={localRepository}
        biometric={biometric}
        vault={vault}
        syncConfigured={syncConfigured}
        syncController={nativeSyncController}
        syncStatus={syncStatus}
        onSyncStatusChange={onSyncStatusChange}
        onListSyncConflicts={onListSyncConflicts}
        onInspectSyncConflict={onInspectSyncConflict}
        onKeepLocalSyncConflict={onKeepLocalSyncConflict}
        knownVaults={knownVaults}
        onCreateBackup={onCreateBackup}
        onCreateDataExport={onCreateDataExport}
        onImportMarkdown={() => openCapture("file")}
        onExportMarkdown={exportMarkdown}
        onClearAllData={onClearAllData}
        onSelectBackup={onSelectBackup}
        onInspectBackup={onInspectBackup}
        onDiscardBackupSelection={onDiscardBackupSelection}
        onConfirmBackupRestore={onConfirmBackupRestore}
        notificationStatus={notificationStatus}
        codexCliStatus={codexCliStatus}
        onRefreshCodexCliStatus={onRefreshCodexCliStatus}
        modelProviderStatus={modelProviderStatus}
        onRefreshModelProvider={onRefreshModelProvider}
        onConfigureModelProvider={onConfigureModelProvider}
        onRemoveModelProvider={onRemoveModelProvider}
        onTestModelProvider={onTestModelProvider}
        onConfirmEmailDraft={onConfirmTransactionDraft}
        onRejectEmailDraft={onRejectTransactionDraft}
        onEnableNotifications={onEnableNotifications}
        onDisableNotifications={onDisableNotifications}
        onEnableBiometric={onEnableBiometric}
        onDisableBiometric={onDisableBiometric}
        onChangePassword={onChangePassword}
        onFullReimportReady={() => setFullReimportBatch({ stage: "intro" })}
      />
    );
  } else if (active === "assistant") {
    content = (
      <AssistantWorkspace
        snapshot={{ vault, accounts, balances, transactions, reminders }}
        onVoice={() => openCapture("voice")}
        onImportMarkdown={() => openCapture("file")}
        onExportMarkdown={exportMarkdown}
        aiInboxCount={aiInbox.filter((item) => item.draftStatus === "needs_review").length}
        onOpenInbox={() => {
          setPetState("idle");
          setAiInboxOpen(true);
          void onRefreshAiInbox();
        }}
        companion={(
          <FolioDeskPet
            state={petState}
            pendingCount={aiInbox.filter((item) => item.draftStatus === "needs_review").length}
            placement="assistant"
            onOpenInbox={() => {
              setPetState("idle");
              setAiInboxOpen(true);
              void onRefreshAiInbox();
            }}
          />
        )}
      />
    );
  } else {
    content = <LocalModule active={active} />;
  }

  if (active === "assets" || active === "cashflow") {
    content = (
      <LocalFinanceHub activeTab={active} onTabChange={setActive}>
        {content}
      </LocalFinanceHub>
    );
  }

  const notifyVoice = () => openCapture("voice");

  return (
    <div
      className="local-shell"
      onPointerDownCapture={registerPetActivity}
      onKeyDownCapture={registerPetActivity}
    >
      <aside className={`local-sidebar${mobileMenuOpen ? " mobile-open" : ""}`}>
        <Brand />
        <nav aria-label="Folio 主导航">
          {localNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={active === item.id ? "active" : ""}
                onClick={() => {
                  setActive(item.id);
                  setMobileMenuOpen(false);
                }}
                aria-label={item.label}
              >
                <Icon weight={active === item.id ? "fill" : "regular"} /><span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="local-security-card">
          <ShieldCheck weight="fill" />
          <span>
            <b>{syncStatus.enabled ? "端到端密文同步" : "仅保存在此 Mac"}</b>
            <small>{syncStatus.enabled ? "云端无法读取财务明文" : "数据未发送到云端"}</small>
          </span>
        </div>
        <button
          className={`local-settings-action${active === "settings" ? " active" : ""}`}
          onClick={() => setActive("settings")}
        >
          <Gear /> 安全设置
        </button>
        <button className="local-lock-action" onClick={onLock}><LockKey /> 暂时锁定</button>
        <div className="local-profile">
          <img src="/assets/brand/folio-cat-avatar.png" alt="被子beizi 的猫猫头像" />
          <span><b>被子beizi</b><small>{vault.displayName}</small></span>
        </div>
      </aside>
      {mobileMenuOpen && (
        <button
          type="button"
          className="local-mobile-scrim"
          onClick={() => setMobileMenuOpen(false)}
          aria-label="关闭模块菜单"
        />
      )}

      <main className="local-main">
        <header className="local-topbar">
          <div className="local-mobile-header">
            <button
              type="button"
              className="local-mobile-menu-button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="打开全部模块"
            >
              <ListChecks weight="bold" />
            </button>
            <Brand />
          </div>
          <div className="local-page-title">
            <span>{new Intl.DateTimeFormat("zh-CN", {
              year: "numeric",
              month: "long",
              day: "numeric",
              weekday: "short",
            }).format(new Date())}</span>
            <h1>{localViewLabels[active]}</h1>
          </div>
          <div className="local-top-actions">
            <button
              className="icon-button notice"
              onClick={() => setActive("reminders")}
              aria-label="打开提醒"
              title="提醒"
            >
              <Bell />
              {activeReminderCount > 0 && <i />}
            </button>
            <button
              type="button"
              className="local-top-lock-button"
              onClick={onLock}
              aria-label="暂时锁定 Folio"
              title="暂时锁定并隐藏资产信息"
            >
              <LockKey weight="bold" />
              <span>锁定</span>
            </button>
          </div>
        </header>
        <div className="local-content">{content}</div>
      </main>

      <nav className="local-mobile-nav" aria-label="移动端主导航">
        <button
          type="button"
          className={active === "overview" ? "active" : ""}
          onClick={() => setActive("overview")}
          aria-label="总览"
        >
          <HouseLine weight={active === "overview" ? "fill" : "regular"} />
          <span>总览</span>
        </button>
        <button
          type="button"
          className={active === "assets" || active === "cashflow" ? "active" : ""}
          onClick={() => setActive("assets")}
          aria-label="资产流水"
        >
          <Wallet weight={active === "assets" || active === "cashflow" ? "fill" : "regular"} />
          <span>资产流水</span>
        </button>
        <button
          type="button"
          className="local-mobile-voice"
          onClick={notifyVoice}
          aria-label="打开 AI 录入"
        >
          <i><Microphone weight="fill" /></i>
          <span>记一笔</span>
        </button>
        <button
          type="button"
          className={active === "reminders" ? "active" : ""}
          onClick={() => setActive("reminders")}
          aria-label="提醒"
        >
          <CalendarBlank weight={active === "reminders" ? "fill" : "regular"} />
          <span>提醒</span>
        </button>
        <button
          type="button"
          className={active === "profile" ? "active" : ""}
          onClick={() => setActive("profile")}
          aria-label="我的"
        >
          <UserCircle weight={active === "profile" ? "fill" : "regular"} />
          <span>我的</span>
        </button>
      </nav>

      {active !== "assistant" && (
        <button className="local-voice-button" onClick={notifyVoice}>
          <span><Sparkle weight="fill" /></span>
          <div><b>告诉 Folio 发生了什么</b><small>语音、截图或文字，先核对再写入</small></div>
          <Microphone weight="fill" />
        </button>
      )}
      {active !== "assistant" && (
        <FolioDeskPet
          state={petState}
          pendingCount={aiInbox.filter((item) => item.draftStatus === "needs_review").length}
          onOpenInbox={() => {
            setPetState("idle");
            setAiInboxOpen(true);
            void onRefreshAiInbox();
          }}
        />
      )}
      {aiInboxOpen && (
        <AiInboxDrawer
          items={aiInbox}
          loading={aiInboxLoading}
          error={aiInboxError}
          onClose={() => setAiInboxOpen(false)}
          onRefresh={onRefreshAiInbox}
          onNavigate={setActive}
        />
      )}
      {voiceOpen && (
        <LocalVoiceProposalModal
          context={active}
          initialMethod={captureIntent}
          accounts={accounts}
          balances={balances}
          holdings={holdings}
          planning={planning}
          baseCurrency={baseCurrency}
          onCreateAccountDraft={onCreateAccountDraft}
          onCreateHoldingDraft={onCreateHoldingDraft}
          onCreateHoldingOperationDraft={onCreateHoldingOperationDraft}
          onCreateTransactionDraft={onCreateTransactionDraft}
          onCreateReminderDraft={onCreateReminderDraft}
          onSavePlanningDraft={onSavePlanningDraft}
          onConfirmAccountDraft={onConfirmAccountDraft}
          onConfirmHoldingDraft={onConfirmHoldingDraft}
          onConfirmHoldingOperationDraft={onConfirmHoldingOperationDraft}
          onConfirmTransactionDraft={onConfirmTransactionDraft}
          onConfirmReminderDraft={onConfirmReminderDraft}
          onConfirmPlanningDraft={onConfirmPlanningDraft}
          onRejectAccountDraft={onRejectAccountDraft}
          onRejectHoldingDraft={onRejectHoldingDraft}
          onRejectHoldingOperationDraft={onRejectHoldingOperationDraft}
          onRejectTransactionDraft={onRejectTransactionDraft}
          onRejectReminderDraft={onRejectReminderDraft}
          onRejectPlanningDraft={onRejectPlanningDraft}
          onRecordAiProposal={onRecordAiProposal}
          codexCliStatus={codexCliStatus}
          onAnalyzeFinanceInputWithCodex={onAnalyzeFinanceInputWithCodex}
          modelProviderStatus={modelProviderStatus}
          onExtractFinancialFactsWithModel={onExtractFinancialFactsWithModel}
          onSelectDocumentEvidence={onSelectDocumentEvidence}
          documentCapability={documentCapability}
          onTranscribeSpeech={onTranscribeSpeech}
          onStopSpeechCapture={onStopSpeechCapture}
          pendingFullReimport={pendingFullReimport}
          onBeginFullReimport={(pendingBatch) => {
            setVoiceOpen(false);
            setFullReimportBatch(pendingBatch);
          }}
          onPetStateChange={setPetState}
          onCommitted={(kind) => {
            setNotice({
              message: kind === "cold_start"
                ? "冷启动数据已按账户、持仓、流水、事项和规划顺序确认写入；隔离项与说明性资料没有改账。"
                : kind === "account"
                ? "口述账户已明确确认并写入加密账本。"
                : kind === "holding_operation"
                  ? "口述产品操作已明确确认；持仓快照与必要账本事件已原子追加。"
                : kind === "reminder"
                  ? "口述事项已明确确认并写入本地加密日程。"
                  : kind === "planning"
                    ? "口述规划已明确确认并写入加密档案；真实余额没有改变。"
                  : "口述流水已明确确认并写入追加式账本。",
              tone: "success",
            });
            window.setTimeout(() => setPetState("done"), 0);
            window.setTimeout(() => {
              setPetState((current) => current === "done" ? "idle" : current);
            }, 4200);
            void onRefreshAiInbox();
            window.setTimeout(() => setNotice(null), 4200);
          }}
          onClose={() => {
            setVoiceOpen(false);
            setPendingFullReimport(null);
            onFullReimportConsumed();
            setPetState((current) => current === "done" ? current : "idle");
          }}
        />
      )}
      {fullReimportBatch && (
        <FullReimportModal
          vault={vault}
          pendingBatch={fullReimportBatch.stage === "intro" ? null : fullReimportBatch}
          onExportMarkdown={exportMarkdown}
          onReplaceAllData={onBeginFullReimport}
          onReady={(pendingBatch) => {
            setFullReimportBatch(null);
            openCapture("file", pendingBatch);
          }}
          onClose={() => setFullReimportBatch(null)}
        />
      )}
      {notice && (
        <div className={`local-notice ${notice.tone}`} role="status" aria-live="polite">
          {notice.tone === "warning" ? <WarningCircle weight="fill" /> : <Check weight="bold" />}
          {notice.message}
        </div>
      )}
    </div>
  );
}

const localVoiceExamples = Object.freeze({
  overview: "例如：今天从建行日常账户花了三百六十八元买日用品。",
  assets: "例如：今天申购金额500元的沪深300基金，操作后份额12.5份，操作后累计成本1500元，操作后当前市值1520元。",
  cashflow: "例如：今天从招行工资账户转账五万元到建行日常账户。",
  planning: "例如：把活期安全垫调整到八万元。",
  reminders: "例如：八月二日要缴保险一万二千八百元，提前三天提醒我。",
  assistant: "可说一笔收入、支出、转账、账户或财务事项，也可选择图片或 PDF。",
  settings: "设置口述目前只解析不保存，待偏好草稿接通后开放。",
});

function domainDraftRows(kind, draft, baseCurrency) {
  if (!draft) return [];
  if (kind === "account") {
    return [
      ["机构", draft.institutionName],
      ["账户", draft.displayName],
      ["类型", accountTypeLabel(draft.accountType)],
      ["期初余额", formatMinorAmount(draft.openingBalanceMinor ?? 0, draft.currency ?? baseCurrency)],
      ["余额日期", draft.balanceDate],
    ];
  }
  if (kind === "reminder") {
    return [
      ["事项", draft.title],
      ["类型", reminderCategoryLabel(draft.category)],
      ["关注日期", draft.dueOn],
      ["金额", formatReminderAmount(draft.amountMinor, draft.currency ?? baseCurrency)],
      ["提前提醒", `${draft.advanceDays} 天`],
    ];
  }
  if (kind === "planning") {
    return [
      ["规划", draft.name],
      ["现金安全垫", formatMinorAmount(draft.cashBufferMinor, draft.baseCurrency ?? baseCurrency)],
      ...draft.allocations.map((item) => {
        const label = PLANNING_ALLOCATIONS.find(({ category }) => category === item.category)?.label
          ?? item.category;
        return [`${label}目标`, `${item.targetBps / 100}%`];
      }),
    ];
  }
  if (kind === "holding_operation") {
    return [
      ["持仓", draft.holdingName],
      ["操作", holdingOperationLabel(draft.operationKind)],
      ["金额", formatMinorAmount(draft.amountMinor, draft.currency ?? baseCurrency)],
      ["结算", draft.balanceEffect === "none"
        ? "持仓内部，不生成资金流水"
        : draft.settlementAccountName ?? draft.holdingAccountName],
      ["操作后份额", draft.afterUnitsMicros == null
        ? "持仓不变"
        : `${formatUnitsMicros(draft.afterUnitsMicros)} 份`],
      ["操作后成本", draft.afterCostBasisMinor == null
        ? "持仓不变"
        : formatMinorAmount(draft.afterCostBasisMinor, draft.currency ?? baseCurrency)],
      ["操作后市值", draft.afterMarketValueMinor == null
        ? "持仓不变"
        : formatMinorAmount(draft.afterMarketValueMinor, draft.currency ?? baseCurrency)],
      ["发生日期", draft.occurredOn],
    ];
  }
  return [
    ["类型", transactionKindLabel(draft.transactionKind)],
    ["账户", draft.destinationAccountName
      ? `${draft.accountName} → ${draft.destinationAccountName}`
      : draft.accountName],
    ["金额", formatTransactionAmount(draft.transactionKind, draft.amountMinor, draft.currency ?? baseCurrency)],
    ["发生日期", draft.occurredOn],
    ["分类", draft.category ?? "未分类"],
  ];
}

function LocalVoiceProposalModal({
  context,
  initialMethod = "voice",
  accounts,
  balances,
  holdings,
  planning,
  baseCurrency,
  onCreateAccountDraft,
  onCreateHoldingDraft,
  onCreateHoldingOperationDraft,
  onCreateTransactionDraft,
  onCreateReminderDraft,
  onSavePlanningDraft,
  onConfirmAccountDraft,
  onConfirmHoldingDraft,
  onConfirmHoldingOperationDraft,
  onConfirmTransactionDraft,
  onConfirmReminderDraft,
  onConfirmPlanningDraft,
  onRejectAccountDraft,
  onRejectHoldingDraft,
  onRejectHoldingOperationDraft,
  onRejectTransactionDraft,
  onRejectReminderDraft,
  onRejectPlanningDraft,
  onRecordAiProposal,
  codexCliStatus = EMPTY_CODEX_CLI_STATUS,
  onAnalyzeFinanceInputWithCodex = null,
  modelProviderStatus = EMPTY_MODEL_PROVIDER_STATUS,
  onExtractFinancialFactsWithModel = null,
  onSelectDocumentEvidence,
  documentCapability = "native",
  onTranscribeSpeech,
  onStopSpeechCapture,
  pendingFullReimport = null,
  onBeginFullReimport,
  onPetStateChange = () => {},
  onCommitted,
  onClose,
}) {
  const [stage, setStage] = useState(pendingFullReimport ? "batch" : "input");
  const [transcript, setTranscript] = useState(pendingFullReimport?.text ?? "");
  const [inputKind, setInputKind] = useState(pendingFullReimport ? "file" : "text");
  const [captureMethod, setCaptureMethod] = useState(initialMethod);
  const [documentInfo, setDocumentInfo] = useState(pendingFullReimport?.documentInfo ?? null);
  const [proposal, setProposal] = useState(null);
  const [proposalQueue, setProposalQueue] = useState([]);
  const [proposalIndex, setProposalIndex] = useState(0);
  const [domainDraft, setDomainDraft] = useState(null);
  const [structuredBatch, setStructuredBatch] = useState(pendingFullReimport?.structuredBatch ?? null);
  const [batchStatuses, setBatchStatuses] = useState({});
  const [batchAccountIds, setBatchAccountIds] = useState({});
  const [batchFailure, setBatchFailure] = useState(null);
  const [batchStartedEmpty, setBatchStartedEmpty] = useState(Boolean(pendingFullReimport));
  const [fullReimportBusy, setFullReimportBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechStopping, setSpeechStopping] = useState(false);
  const [speechLevel, setSpeechLevel] = useState(0);
  const [speechProgress, setSpeechProgress] = useState("idle");
  const [parseProgress, setParseProgress] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recognitionRef = useRef(null);
  const transcriptRef = useRef("");
  const stopSpeechCaptureRef = useRef(onStopSpeechCapture);
  const nativeSpeechSupported = typeof onTranscribeSpeech === "function";
  const nativeSpeechStopSupported = typeof onStopSpeechCapture === "function";
  const webSpeechSupported = typeof window !== "undefined"
    && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  const speechSupported = nativeSpeechSupported || webSpeechSupported;
  const nativeCodexEnabled = typeof onAnalyzeFinanceInputWithCodex === "function";
  const externalModelEnabled = modelProviderStatus.configured
    && typeof onExtractFinancialFactsWithModel === "function";
  const semanticMode = nativeCodexEnabled && codexCliStatus.ready
    ? "codex"
    : externalModelEnabled
      ? "openai"
      : "local";
  const browserTextOnly = documentCapability === "browser_text_only";
  const example = localVoiceExamples[context] ?? localVoiceExamples.overview;
  const voiceTranscriptReady = inputKind === "voice" && Boolean(transcript.trim());
  const voiceReviewItems = useMemo(
    () => inputKind === "voice" ? splitVoiceReviewItems(transcript) : [],
    [inputKind, transcript],
  );
  const voiceReviewItemCount = voiceReviewItems.length;
  const formatCompletedVoiceTranscript = useCallback((rawTranscript) => {
    const review = organizeVoiceReview({
      transcript: rawTranscript,
      context,
      accounts,
      balances,
      holdings,
      planning,
      baseCurrency,
      now: new Date(),
    });
    return review.reviewText || rawTranscript;
  }, [accounts, balances, baseCurrency, context, holdings, planning]);

  useEffect(() => {
    stopSpeechCaptureRef.current = onStopSpeechCapture;
  }, [onStopSpeechCapture]);

  useEffect(() => {
    if (listening || busy) {
      onPetStateChange("processing");
      return;
    }
    if (stage === "proposal" && proposal?.status === "needs_input") {
      onPetStateChange("needs_input");
      return;
    }
    if (stage === "proposal" || stage === "domain") {
      onPetStateChange("ready");
      return;
    }
    onPetStateChange("idle");
  }, [busy, listening, onPetStateChange, proposal?.status, stage]);

  useEffect(() => () => {
    try {
      recognitionRef.current?.abort();
    } catch {
      // Recognition cleanup is best-effort; no transcript is persisted here.
    }
    if (typeof stopSpeechCaptureRef.current === "function") {
      void stopSpeechCaptureRef.current();
    }
  }, []);

  const rejectDomainDraft = useCallback(async () => {
    if (!domainDraft || !proposal) return;
    const reject = {
      account: onRejectAccountDraft,
      holding_operation: onRejectHoldingOperationDraft,
      transaction: onRejectTransactionDraft,
      reminder: onRejectReminderDraft,
      planning: onRejectPlanningDraft,
    }[proposal.kind];
    await reject(domainDraft.draftId);
    setDomainDraft(null);
  }, [
    domainDraft,
    onRejectAccountDraft,
    onRejectHoldingOperationDraft,
    onRejectReminderDraft,
    onRejectPlanningDraft,
    onRejectTransactionDraft,
    proposal,
  ]);

  const coldStartEligible = batchStartedEmpty;

  const beginFullReimport = async () => {
    if (!structuredBatch || typeof onBeginFullReimport !== "function") return;
    setFullReimportBusy(true);
    setError("");
    try {
      await onBeginFullReimport({
        text: transcript,
        structuredBatch,
        documentInfo,
      });
    } catch (nextError) {
      setError(
        typeof nextError?.message === "string"
          ? nextError.message
          : "没有进入全量重录流程；当前数据没有改变。",
      );
    } finally {
      setFullReimportBusy(false);
    }
  };

  const dismiss = async () => {
    if (busy || listening) return;
    setBusy(true);
    try {
      await rejectDomainDraft();
      onClose();
    } catch {
      setError("未能安全取消核对草稿，请稍后重试。");
      setBusy(false);
    }
  };

  const startSystemSpeech = async () => {
    if (!speechSupported || listening) return;
    setListening(true);
    setSpeechStopping(false);
    setSpeechProgress("starting");
    setSpeechLevel(0);
    setTranscript("");
    transcriptRef.current = "";
    setInputKind("voice");
    setDocumentInfo(null);
    setError("");
    if (nativeSpeechSupported) {
      try {
        const response = await onTranscribeSpeech({
          locale: "zh-CN",
          maxSeconds: 30,
          confirmedByUser: true,
        }, (event) => {
          if (event?.kind === "level") {
            setSpeechLevel(Number.isFinite(event.level) ? event.level : 0);
            return;
          }
          if (event?.kind === "listening") {
            setSpeechProgress("listening");
            return;
          }
          if ((event?.kind === "partial" || event?.kind === "final") && event.text) {
            const nextTranscript = event.text.slice(0, 40_000);
            transcriptRef.current = nextTranscript;
            setTranscript(nextTranscript);
            setInputKind("voice");
            setDocumentInfo(null);
            setSpeechProgress(event.kind === "final" ? "final" : "listening");
            return;
          }
          if (event?.kind === "stopped") {
            setSpeechLevel(0);
          }
        });
        const completedTranscript = formatCompletedVoiceTranscript(requireNativeSpeechText(response));
        transcriptRef.current = completedTranscript;
        setTranscript(completedTranscript);
        setInputKind("voice");
        setDocumentInfo(null);
        setSpeechProgress("final");
      } catch (speechError) {
        setSpeechProgress("idle");
        setError(
          typeof speechError?.message === "string"
            ? speechError.message
            : "设备内语音识别未完成，请重试或直接输入文字。",
        );
      } finally {
        setSpeechLevel(0);
        setSpeechStopping(false);
        setListening(false);
      }
      return;
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      setSpeechProgress("listening");
    };
    recognition.onresult = (event) => {
      const text = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join("");
      transcriptRef.current = text;
      setTranscript(text);
      setInputKind("voice");
      setDocumentInfo(null);
      setSpeechProgress(event.results[event.results.length - 1]?.isFinal ? "final" : "listening");
    };
    recognition.onerror = () => {
      setSpeechProgress("idle");
      setSpeechStopping(false);
      setListening(false);
      setError("系统语音识别未完成；可以继续使用 macOS 听写或直接输入文字。");
    };
    recognition.onend = () => {
      const completedTranscript = formatCompletedVoiceTranscript(transcriptRef.current);
      transcriptRef.current = completedTranscript;
      if (completedTranscript) setTranscript(completedTranscript);
      setSpeechStopping(false);
      setListening(false);
      setSpeechProgress((current) => (
        current === "listening" || current === "stopping" ? "final" : current
      ));
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setSpeechStopping(false);
      setListening(false);
      setSpeechProgress("idle");
      setError("系统语音识别没有启动；可以重试或直接输入文字。");
    }
  };

  const stopSystemSpeech = async () => {
    if (!listening || speechStopping || speechProgress === "starting") return;
    setSpeechStopping(true);
    setSpeechProgress("stopping");
    setSpeechLevel(0);
    setError("");
    try {
      if (nativeSpeechStopSupported) {
        await onStopSpeechCapture();
        return;
      }
      recognitionRef.current?.stop();
    } catch (stopError) {
      setSpeechStopping(false);
      setSpeechProgress("listening");
      setError(
        typeof stopError?.message === "string"
          ? stopError.message
          : "没有成功结束本次语音输入，请再试一次。",
      );
    }
  };

  const selectDocument = async () => {
    if (busy || listening) return;
    setBusy(true);
    setError("");
    try {
      const selected = await onSelectDocumentEvidence();
      if (selected?.status === "cancelled") return;
      if (selected?.status !== "extracted" || !selected.text) {
        throw new Error("文件没有返回可核对的文字。");
      }
      setTranscript(selected.text);
      setInputKind("file");
      setCaptureMethod("file");
      setDocumentInfo(selected);
      if (selected.format === "markdown" && isStructuredFolioMarkdown(selected.text)) {
        const parsed = parseStructuredFolioMarkdown(selected.text);
        setStructuredBatch(parsed);
        setBatchStatuses({});
        setBatchAccountIds({});
        setBatchFailure(null);
        setBatchStartedEmpty(accounts.length === 0 && holdings.length === 0 && !planning);
        setStage("batch");
      }
    } catch (selectionError) {
      setError(
        typeof selectionError?.message === "string"
          ? selectionError.message
          : String(selectionError || "无法在本机识别该文件。"),
      );
    } finally {
      setBusy(false);
    }
  };

  const updateBatchItem = (key, status, detail = "") => {
    setBatchStatuses((current) => ({
      ...current,
      [key]: { status, detail },
    }));
  };

  const importBatchGroup = async (group) => {
    if (!structuredBatch || busy || structuredBatch.status !== "reviewable") return;
    setBusy(true);
    setError("");
    setBatchFailure(null);
    let currentKey = "";
    let pendingDraft = null;
    let pendingReject = null;
    try {
      if (group === "accounts") {
        const nextAccountIds = { ...batchAccountIds };
        for (const item of structuredBatch.accounts) {
          currentKey = `account:${item.key}`;
          if (batchStatuses[currentKey]?.status === "confirmed") continue;
          updateBatchItem(currentKey, "processing");
          pendingReject = onRejectAccountDraft;
          pendingDraft = await onCreateAccountDraft(item.request);
          await onConfirmAccountDraft(pendingDraft.draftId);
          nextAccountIds[item.key] = pendingDraft.accountId;
          setBatchAccountIds({ ...nextAccountIds });
          updateBatchItem(currentKey, "confirmed");
          pendingDraft = null;
        }
      } else if (group === "holdings") {
        for (const item of structuredBatch.holdings) {
          currentKey = `holding:${item.key}`;
          if (batchStatuses[currentKey]?.status === "confirmed") continue;
          const accountId = batchAccountIds[item.accountKey];
          if (!accountId) throw new Error(`请先确认账户组：${item.accountKey}`);
          updateBatchItem(currentKey, "processing");
          pendingReject = onRejectHoldingDraft;
          pendingDraft = await onCreateHoldingDraft({
            ...item.request,
            accountId,
          });
          await onConfirmHoldingDraft(pendingDraft.draftId);
          updateBatchItem(currentKey, "confirmed");
          pendingDraft = null;
        }
      } else if (group === "transactions") {
        for (const item of structuredBatch.transactions) {
          currentKey = `transaction:${item.key}`;
          if (batchStatuses[currentKey]?.status === "confirmed") continue;
          const accountId = batchAccountIds[item.accountKey];
          const destinationAccountId = item.destinationAccountKey
            ? batchAccountIds[item.destinationAccountKey]
            : null;
          if (!accountId || (item.destinationAccountKey && !destinationAccountId)) {
            throw new Error("流水依赖的账户尚未确认");
          }
          updateBatchItem(currentKey, "processing");
          pendingReject = onRejectTransactionDraft;
          pendingDraft = await onCreateTransactionDraft({
            ...item.request,
            accountId,
            destinationAccountId,
          });
          await onConfirmTransactionDraft(pendingDraft.draftId);
          updateBatchItem(currentKey, "confirmed");
          pendingDraft = null;
        }
      } else if (group === "reminders") {
        for (const item of structuredBatch.reminders) {
          currentKey = `reminder:${item.key}`;
          if (batchStatuses[currentKey]?.status === "confirmed") continue;
          const linkedAccountId = item.accountKey ? batchAccountIds[item.accountKey] : null;
          if (item.accountKey && !linkedAccountId) {
            throw new Error("事项依赖的账户尚未确认");
          }
          updateBatchItem(currentKey, "processing");
          pendingReject = onRejectReminderDraft;
          pendingDraft = await onCreateReminderDraft({
            ...item.request,
            linkedAccountId,
          });
          await onConfirmReminderDraft(pendingDraft.draftId);
          updateBatchItem(currentKey, "confirmed");
          pendingDraft = null;
        }
      } else if (group === "planning" && structuredBatch.planning) {
        currentKey = "planning:planning";
        if (batchStatuses[currentKey]?.status !== "confirmed") {
          updateBatchItem(currentKey, "processing");
          pendingReject = onRejectPlanningDraft;
          pendingDraft = await onSavePlanningDraft(structuredBatch.planning.request);
          await onConfirmPlanningDraft(pendingDraft.draftId);
          updateBatchItem(currentKey, "confirmed");
          pendingDraft = null;
        }
      }
    } catch (batchError) {
      if (pendingDraft?.draftId && pendingReject) {
        try {
          await pendingReject(pendingDraft.draftId);
        } catch {
          // The unconfirmed draft cannot mutate formal data and remains visible for recovery.
        }
      }
      const detail = typeof batchError?.message === "string"
        ? batchError.message
        : "批次写入失败，未完成项没有写入正式数据。";
      if (currentKey) updateBatchItem(currentKey, "failed", detail);
      setBatchFailure({ group, key: currentKey, detail });
    } finally {
      setBusy(false);
    }
  };

  const batchGroupState = (group, items) => {
    const keys = group === "planning"
      ? (items.length ? ["planning:planning"] : [])
      : items.map((item) => `${group.slice(0, -1)}:${item.key}`);
    const confirmed = keys.filter((key) => batchStatuses[key]?.status === "confirmed").length;
    return {
      confirmed,
      total: keys.length,
      complete: confirmed === keys.length,
    };
  };

  const accountGroup = structuredBatch
    ? batchGroupState("accounts", structuredBatch.accounts)
    : { confirmed: 0, total: 0, complete: false };
  const holdingGroup = structuredBatch
    ? batchGroupState("holdings", structuredBatch.holdings)
    : { confirmed: 0, total: 0, complete: false };
  const transactionGroup = structuredBatch
    ? batchGroupState("transactions", structuredBatch.transactions)
    : { confirmed: 0, total: 0, complete: false };
  const reminderGroup = structuredBatch
    ? batchGroupState("reminders", structuredBatch.reminders)
    : { confirmed: 0, total: 0, complete: false };
  const planningGroup = structuredBatch
    ? batchGroupState("planning", structuredBatch.planning ? [structuredBatch.planning] : [])
    : { confirmed: 0, total: 0, complete: false };
  const batchComplete = accountGroup.complete
    && holdingGroup.complete
    && transactionGroup.complete
    && reminderGroup.complete
    && planningGroup.complete;

  const parse = async () => {
    if (isStructuredFolioMarkdown(transcript)) {
      const parsed = parseStructuredFolioMarkdown(transcript);
      setStructuredBatch(parsed);
      setBatchStatuses({});
      setBatchAccountIds({});
      setBatchFailure(null);
      setBatchStartedEmpty(accounts.length === 0 && holdings.length === 0 && !planning);
      setStage("batch");
      setError("");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const reviewInputs = inputKind === "voice"
        ? splitVoiceReviewItems(transcript)
        : [transcript];
      const nextProposals = [];
      for (const [reviewIndex, reviewText] of reviewInputs.entries()) {
        setParseProgress({ current: reviewIndex + 1, total: reviewInputs.length });
        if (semanticMode === "openai") {
          const extraction = await onExtractFinancialFactsWithModel({
            text: reviewText,
            moduleContext: context,
          });
          const records = Array.isArray(extraction?.records) ? extraction.records : [];
          if (records.length === 0) {
            const localOnly = localModelProvider.extract_proposal({
              transcript: reviewText,
              context,
              accounts,
              holdings,
              planning,
              now: new Date(),
              intentHint: "unsupported",
            });
            nextProposals.push({
              ...localOnly,
              warnings: [
                ...localOnly.warnings,
                ...(extraction?.warnings ?? []).map((warning) => `OpenAI：${warning}`),
                "外部模型没有提取出可核对的财务记录。",
              ],
            });
            continue;
          }
          for (const fact of records) {
            const factTranscript = excerptForModelFact(reviewText, fact.evidenceQuote);
            let next = localModelProvider.extract_proposal({
              transcript: factTranscript,
              context,
              accounts,
              holdings,
              planning,
              now: new Date(),
              intentHint: modelFactIntent(fact),
            });
            next = mergeExternalModelFact(next, extraction, fact);
            if (inputKind === "file" && documentInfo) {
              next = attachDocumentEvidence(next, documentInfo);
            }
            nextProposals.push(next);
          }
          continue;
        }
        const analysis = semanticMode === "codex"
          ? await onAnalyzeFinanceInputWithCodex({
              text: reviewText,
              moduleContext: context,
            })
          : null;
        let next = localModelProvider.extract_proposal({
          transcript: reviewText,
          context,
          accounts,
          holdings,
          planning,
          now: new Date(),
          intentHint: analysis?.intent ?? null,
        });
        if (analysis) {
          next = mergeCodexSemanticAnalysis(next, analysis);
        }
        if (inputKind === "file" && documentInfo) {
          next = attachDocumentEvidence(next, documentInfo);
        }
        nextProposals.push(next);
      }
      if (nextProposals.length === 0) {
        throw new Error("没有生成可核对的财务项目。");
      }
      setProposalQueue(nextProposals);
      setProposalIndex(0);
      setProposal(nextProposals[0]);
      setStage("proposal");
    } catch (parseError) {
      setError(
        typeof parseError?.message === "string"
          ? parseError.message
          : "AI 没有完成解析；本次没有生成或写入任何数据。",
      );
    } finally {
      setParseProgress(null);
      setBusy(false);
    }
  };

  const createReviewDraft = async () => {
    if (proposal?.status !== "reviewable" || !proposal.draftRequest) return;
    setBusy(true);
    setError("");
    let created;
    const create = {
      account: onCreateAccountDraft,
      holding_operation: onCreateHoldingOperationDraft,
      transaction: onCreateTransactionDraft,
      reminder: onCreateReminderDraft,
      planning: onSavePlanningDraft,
    }[proposal.kind];
    const reject = {
      account: onRejectAccountDraft,
      holding_operation: onRejectHoldingOperationDraft,
      transaction: onRejectTransactionDraft,
      reminder: onRejectReminderDraft,
      planning: onRejectPlanningDraft,
    }[proposal.kind];
    try {
      created = await create(proposal.draftRequest);
      await onRecordAiProposal({
        domainDraftId: created.draftId,
        inputKind,
        proposalKind: proposal.kind,
        moduleContext: context,
        providerId: proposal.providerId,
        parserVersion: proposal.parserVersion,
        transcript: proposal.transcript,
        confidenceBps: localModelProvider.proposalConfidenceBps(proposal),
        evidence: proposal.evidence,
      });
      setDomainDraft(created);
      setStage("domain");
    } catch (creationError) {
      if (created?.draftId) {
        try {
          await reject(created.draftId);
        } catch {
          // The original error is safer to show; the pending draft still cannot write itself.
        }
      }
      setError(
        typeof creationError?.message === "string"
          ? creationError.message
          : "无法生成核对草稿，请检查口述内容。",
      );
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!domainDraft || !proposal) return;
    setBusy(true);
    setError("");
    const confirmDraft = {
      account: onConfirmAccountDraft,
      holding_operation: onConfirmHoldingOperationDraft,
      transaction: onConfirmTransactionDraft,
      reminder: onConfirmReminderDraft,
      planning: onConfirmPlanningDraft,
    }[proposal.kind];
    try {
      await confirmDraft(domainDraft.draftId);
      setDomainDraft(null);
      onCommitted(proposal.kind);
      const nextIndex = proposalIndex + 1;
      if (nextIndex < proposalQueue.length) {
        setProposalIndex(nextIndex);
        setProposal(proposalQueue[nextIndex]);
        setStage("proposal");
      } else {
        onClose();
      }
    } catch (confirmationError) {
      setError(
        typeof confirmationError?.message === "string"
          ? confirmationError.message
          : "确认失败，正式数据没有改变。",
      );
    } finally {
      setBusy(false);
    }
  };

  const rows = domainDraftRows(proposal?.kind, domainDraft, baseCurrency);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) void dismiss();
    }}>
      <section className="local-ai-modal" role="dialog" aria-modal="true" aria-labelledby="local-ai-title">
        <button className="modal-close" onClick={() => void dismiss()} aria-label="关闭 AI 录入" disabled={busy || listening}><X /></button>

        {stage === "input" && (
          <>
            <header className="local-ai-heading">
              <span><Sparkle weight="fill" /></span>
              <div>
                <small>AI 收件箱 · 不自动改账</small>
                <h2 id="local-ai-title">把财务信息交给 Folio</h2>
                <p>语音、截图或文档都可以。</p>
              </div>
            </header>
            <div className="local-ai-methods" role="tablist" aria-label="选择录入方式">
              <button
                type="button"
                role="tab"
                aria-selected={captureMethod === "voice"}
                className={captureMethod === "voice" ? "active" : ""}
                onClick={() => {
                  setCaptureMethod("voice");
                  if (inputKind !== "voice") {
                    setTranscript("");
                    setInputKind("voice");
                    setDocumentInfo(null);
                  }
                }}
                disabled={listening}
              >
                <Microphone weight="fill" />
                <span><b>语音</b><small>随手说一段</small></span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={captureMethod === "file"}
                className={captureMethod === "file" ? "active" : ""}
                onClick={() => setCaptureMethod("file")}
                disabled={listening}
              >
                <FileText weight="duotone" />
                <span>
                  <b>{browserTextOnly ? "Markdown / 文本" : "截图 / 文档"}</b>
                  <small>{browserTextOnly ? "DEV 预览能力" : "图片、PDF、Markdown"}</small>
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={captureMethod === "text"}
                className={captureMethod === "text" ? "active" : ""}
                onClick={() => setCaptureMethod("text")}
                disabled={listening}
              >
                <PencilSimple />
                <span><b>文字</b><small>直接补充或修正</small></span>
              </button>
            </div>
            {captureMethod === "voice" && (
              <div className={`local-ai-speech ${listening ? "is-listening" : ""} ${voiceTranscriptReady && !listening ? "has-review" : ""}`}>
                <div className="local-ai-voice-stage">
                  <div className="local-ai-voice-copy" aria-live="polite">
                    <small>{listening
                      ? speechProgress === "starting"
                        ? "正在准备麦克风"
                        : speechStopping
                          ? "正在结束"
                          : "实时转写"
                      : voiceTranscriptReady
                        ? "语音已完成"
                        : "说出这笔变化"}</small>
                    <p className={voiceTranscriptReady ? "has-transcript" : ""}>{listening
                      ? transcript.trim() || (speechStopping
                        ? "正在整理本次语音稿…"
                        : "正在聆听，你说的话会在这里实时浮现…")
                      : voiceTranscriptReady
                        ? `已整理为 ${voiceReviewItemCount || 1} 项，请在下方核对账户、金额和日期。`
                        : example}</p>
                  </div>
                  <div className="local-ai-waveform">
                    <VoiceWaveCanvas active={listening} level={speechLevel} />
                  </div>
                  <button
                    type="button"
                    className={`local-ai-mic-orb ${listening && speechProgress !== "starting" ? "is-stop" : ""}`}
                    onClick={() => void (listening ? stopSystemSpeech() : startSystemSpeech())}
                    disabled={!speechSupported || speechStopping || (listening && speechProgress === "starting")}
                    aria-label={listening
                      ? speechStopping
                        ? "正在结束语音输入"
                        : speechProgress === "starting"
                          ? "正在准备设备内语音识别"
                          : "结束语音输入并核对"
                      : "开始实时语音输入"}
                  >
                    {listening && speechProgress !== "starting"
                      ? <><Stop weight="fill" /><span>{speechStopping ? "正在整理" : "结束并核对"}</span></>
                      : <Microphone weight="fill" />}
                  </button>
                  <small className="local-ai-voice-device">{listening
                    ? speechStopping
                      ? "请稍候，马上生成可编辑语音稿"
                      : speechProgress === "starting"
                        ? "正在请求麦克风与设备内识别"
                        : "可随时结束 · 最长 30 秒"
                    : voiceTranscriptReady
                      ? "点击话筒可重新录入"
                      : nativeSpeechSupported
                        ? "点击即开始设备内转写"
                        : webSpeechSupported
                          ? "点击即开始语音转写"
                          : "当前环境不支持语音转写"}</small>
                </div>
                {voiceTranscriptReady && !listening && (
                  <label className="local-ai-live-transcript">
                    <span>
                      <b>核对已整理的语音稿</b>
                      <small>{voiceReviewItemCount || 1} 项 · 可直接修改</small>
                    </span>
                    <textarea
                      value={transcript}
                      onChange={(event) => {
                        const nextTranscript = event.target.value.slice(0, 40_000);
                        transcriptRef.current = nextTranscript;
                        setTranscript(nextTranscript);
                        setInputKind("voice");
                        setDocumentInfo(null);
                        setError("");
                      }}
                      placeholder="Folio 会按事项分点整理；你可以在这里修改账户、金额或日期…"
                      aria-label="核对本次语音稿"
                      maxLength={40_000}
                    />
                  </label>
                )}
              </div>
            )}
            {captureMethod === "file" && (
              <div className="local-ai-document">
                <button type="button" onClick={() => void selectDocument()} disabled={busy || listening}>
                  <UploadSimple weight="bold" /> {busy ? "正在本机识别…" : "选择截图或文档"}
                </button>
                <span>
                  <b>{browserTextOnly ? "DEV 预览仅可读取 Markdown / 纯文本" : "图片 / PDF / Markdown / 文本"}</b>
                  <small>{browserTextOnly
                    ? "截图与 PDF 的设备内 OCR 请在 macOS App 中测试。"
                    : "原文件不保存；设备内提取文字，核对后再解析。"}</small>
                </span>
              </div>
            )}
            {captureMethod === "text" && (
              <div className="local-ai-text-hint">
                <PencilSimple />
                <span><b>直接描述即可</b><small>{example}</small></span>
              </div>
            )}
            {captureMethod !== "voice" && <label className="local-ai-transcript">
              <span>{inputKind === "file"
                ? "本机提取文字"
                : captureMethod === "voice"
                  ? "本次语音稿"
                  : "本次输入"}</span>
              <textarea
                autoFocus
                value={transcript}
                onChange={(event) => {
                  setTranscript(event.target.value.slice(0, 40_000));
                  setInputKind("text");
                  setDocumentInfo(null);
                  setError("");
                }}
                placeholder={captureMethod === "file"
                  ? browserTextOnly
                    ? "选择 Markdown 或文本后，会在这里显示读取内容…"
                    : "选择截图或文档后，会在这里显示设备内提取的文字…"
                  : captureMethod === "voice"
                    ? "识别完成后，可以在这里修正文字…"
                    : "例如：今天从日常账户花了 368 元买日用品。"}
                maxLength={40_000}
              />
              <small>{transcript.length} / 40000 · 解析前不会写入本地数据</small>
            </label>}
            {documentInfo && (
              <div className="local-ai-document-chip">
                <FileText weight="fill" />
                <span>
                  <b>{documentInfo.fileName}</b>
                  <small>
                    {documentInfo.format === "pdf"
                      ? `${documentInfo.pageCount} 页 PDF${documentInfo.ocrPageCount ? ` · ${documentInfo.ocrPageCount} 页设备内 OCR` : " · 本机文字提取"}`
                      : documentInfo.format === "image"
                        ? "本机图片 OCR"
                        : documentInfo.format === "markdown"
                          ? "Markdown · 本机读取"
                          : "纯文本 · 本机读取"}
                    {documentInfo.unreadablePageCount
                      ? ` · ${documentInfo.unreadablePageCount} 页未识别`
                      : documentInfo.truncated
                        ? " · 已截取前 4000 字"
                        : " · 已完成设备内提取"}
                  </small>
                </span>
                <ShieldCheck weight="fill" />
              </div>
            )}
            {error && <VaultError message={error} />}
            <div className="modal-actions compact">
              <button className="secondary" onClick={() => void dismiss()} disabled={busy || listening}>取消</button>
              <button
                className="primary"
                onClick={() => void parse()}
                disabled={!transcript.trim() || listening || busy}
              >
                {busy
                  ? semanticMode === "openai"
                    ? parseProgress?.total > 1
                      ? `AI 正在整理 ${parseProgress.current}/${parseProgress.total}`
                      : "AI 正在提取并整理…"
                    : parseProgress?.total > 1
                      ? `Codex 正在解析 ${parseProgress.current}/${parseProgress.total}`
                      : "Codex 正在解析…"
                  : semanticMode === "codex"
                    ? voiceReviewItemCount > 1 ? `用 Codex 解析 ${voiceReviewItemCount} 项` : "用 Codex 解析"
                    : semanticMode === "openai"
                      ? "用 AI 解析"
                      : "用本机规则解析"} {!busy && <ArrowRight />}
              </button>
            </div>
          </>
        )}

        {stage === "batch" && structuredBatch && (
          <>
            <header className="local-ai-heading">
              <span><Table weight="duotone" /></span>
              <div>
                <small>
                  {structuredBatch.meta.data_classification === "personal" ? "个人数据导入" : "结构化冷启动"}
                  {" · "}{structuredBatch.meta.dataset_name || "Folio 数据批次"}
                </small>
                <h2 id="local-ai-title">按依赖顺序核对并写入</h2>
                <p>文档只在当前内存中解析；每组都先创建原生草稿，再逐项明确确认。</p>
              </div>
            </header>

            <div className="local-cold-start-summary">
              <div><b>{structuredBatch.counts.accounts}</b><span>账户</span></div>
              <div><b>{structuredBatch.counts.holdings}</b><span>持仓</span></div>
              <div><b>{structuredBatch.counts.transactions}</b><span>流水</span></div>
              <div><b>{structuredBatch.counts.reminders}</b><span>事项</span></div>
              <div><b>{structuredBatch.counts.planning}</b><span>规划</span></div>
            </div>

            {!coldStartEligible && (
              <div className="local-reimport-choice">
                <div className="local-ai-issues">
                  <WarningCircle weight="fill" />
                  <span>
                    <b>这是一份全量快照，当前 Folio 已有数据</b>
                    <small>整份叠加会重复账户、期初余额和历史流水。请根据这次目的选择下一步。</small>
                  </span>
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setStage("input");
                      setStructuredBatch(null);
                      setBatchFailure(null);
                      setTranscript("");
                      setDocumentInfo(null);
                      setCaptureMethod("text");
                      setInputKind("text");
                    }}
                    disabled={busy || fullReimportBusy}
                  >
                    <Plus /> 只新增最近变化
                    <small>返回日常录入，按一笔流水、事项或估值逐项确认</small>
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => void beginFullReimport()}
                    disabled={busy || fullReimportBusy}
                  >
                    <Trash /> {fullReimportBusy ? "正在准备…" : "用这份快照重新开始"}
                    <small>先导出旧数据，再验证密码清空，随后回到本批次</small>
                  </button>
                </div>
              </div>
            )}

            {structuredBatch.status === "invalid" && (
              <div className="local-cold-start-errors">
                <header><WarningCircle weight="fill" /><b>发现 {structuredBatch.errors.length} 个阻断问题</b></header>
                {structuredBatch.errors.slice(0, 8).map((item, index) => (
                  <p key={`${item.scope}:${item.key}:${index}`}>
                    <span>{item.line ? `第 ${item.line} 行` : item.scope}</span>
                    {item.message}
                  </p>
                ))}
              </div>
            )}

            {structuredBatch.status === "reviewable" && (
              <div className="local-cold-start-groups">
                {[
                  {
                    id: "accounts",
                    order: 1,
                    title: "账户与期初余额",
                    detail: "建立账户主数据；正负余额按文档原值写入",
                    state: accountGroup,
                    enabled: coldStartEligible,
                  },
                  {
                    id: "holdings",
                    order: 2,
                    title: "账户内持仓与估值",
                    detail: "只做账户内部拆分，不重复增加净资产",
                    state: holdingGroup,
                    enabled: coldStartEligible && accountGroup.complete,
                  },
                  {
                    id: "transactions",
                    order: 3,
                    title: "历史流水",
                    detail: "收入、支出与同币种转账逐笔追加",
                    state: transactionGroup,
                    enabled: coldStartEligible && accountGroup.complete && holdingGroup.complete,
                  },
                  {
                    id: "reminders",
                    order: 4,
                    title: "财务事项",
                    detail: "租金、保险、到期、还款与法律事项",
                    state: reminderGroup,
                    enabled: coldStartEligible && accountGroup.complete && holdingGroup.complete && transactionGroup.complete,
                  },
                  {
                    id: "planning",
                    order: 5,
                    title: "长期规划",
                    detail: "六类目标合计 100%，不触发真实调仓",
                    state: planningGroup,
                    enabled: coldStartEligible && accountGroup.complete && holdingGroup.complete && transactionGroup.complete && reminderGroup.complete,
                  },
                ].map((group) => (
                  <article
                    key={group.id}
                    className={`${group.state.complete ? "complete" : ""}${group.enabled ? "" : " locked"}`}
                  >
                    <span className="local-cold-start-order">
                      {group.state.complete ? <Check weight="bold" /> : group.order}
                    </span>
                    <div>
                      <small>第 {group.order} 组</small>
                      <b>{group.title}</b>
                      <p>{group.detail}</p>
                    </div>
                    <em>{group.state.confirmed} / {group.state.total}</em>
                    <button
                      type="button"
                      disabled={!group.enabled || busy || group.state.complete}
                      onClick={() => void importBatchGroup(group.id)}
                    >
                      {group.state.complete
                        ? "已确认"
                        : busy && batchFailure?.group !== group.id
                          ? "处理中…"
                          : `核对并写入 ${group.state.total} 项`}
                    </button>
                  </article>
                ))}
              </div>
            )}

            <div className="local-cold-start-boundaries">
              <div>
                <ShieldCheck weight="fill" />
                <span>
                  <b>{structuredBatch.counts.informational} 组说明资料只保留在本次核对</b>
                  <small>保险、租赁、诉讼和市场观察不会被当成资产、负债或已确认收益。</small>
                </span>
              </div>
              <div>
                <WarningCircle weight="fill" />
                <span>
                  <b>{structuredBatch.counts.quarantined} 条测试项明确隔离</b>
                  <small>模糊金额、跨币种、预计红利和清仓指令均不会自动写入。</small>
                </span>
              </div>
            </div>

            {batchFailure && (
              <div className="local-ai-issues">
                <WarningCircle weight="fill" />
                <span>
                  <b>批次在 {batchFailure.key || batchFailure.group} 停止</b>
                  <small>{batchFailure.detail}</small>
                  <small>已确认项保持可见，未完成项没有写入；修正后可从当前组继续。</small>
                </span>
              </div>
            )}
            {error && <VaultError message={error} />}
            <div className="local-ai-guardrail">
              <ShieldCheck weight="fill" />
              <span>
                <b>金额不会由模型计算或补全</b>
                <small>原生领域层会再次校验金额、日期、币种、账户依赖和持仓对账关系。</small>
              </span>
            </div>
            <div className="modal-actions">
              <button
                className="secondary"
                onClick={() => {
                  setStage("input");
                  setStructuredBatch(null);
                  setBatchFailure(null);
                  setBatchStartedEmpty(false);
                }}
                disabled={busy || Object.values(batchStatuses).some((item) => item.status === "confirmed")}
              >
                返回重新选择
              </button>
              <button
                className="primary"
                disabled={!batchComplete || busy}
                onClick={() => {
                  onCommitted("cold_start");
                  onClose();
                }}
              >
                {batchComplete ? "完成冷启动并查看驾驶舱" : "按顺序完成全部核对"} <ArrowRight />
              </button>
            </div>
          </>
        )}

        {stage === "proposal" && proposal && (
          <>
            <header className="local-ai-heading">
              <span><Sparkle weight="fill" /></span>
              <div>
                <small>{proposal.providerId === "codex_cli_v1"
                  ? "Codex CLI 语义判断 · 原文规则提取"
                  : proposal.providerId === "openai_responses_v1"
                    ? `${proposal.model ?? "OpenAI"} · 结构化提取 · 本机规则复核`
                    : proposal.providerId === "local_rules_v1" ? "本地规则提案" : proposal.providerId}
                  {proposalQueue.length > 1 ? ` · 第 ${proposalIndex + 1} / ${proposalQueue.length} 项` : ""}</small>
                <h2 id="local-ai-title">
                  {proposal.status === "reviewable" ? "先核对识别结果" : "信息不足，暂不生成草稿"}
                </h2>
                <p>置信度 {Math.round((proposal.confidence ?? 0) * 100)}% · 原文仍保留在本次核对中</p>
              </div>
            </header>
            {proposal.analysisSummary && (
              <p className="local-ai-analysis-summary">
                {proposal.providerId === "codex_cli_v1" ? "Codex 判断" : "AI 提取摘要"}：{proposal.analysisSummary}
              </p>
            )}
            <blockquote className="local-ai-source">{proposal.transcript}</blockquote>
            <div className="local-ai-fields">
              {proposal.fields.map((item) => (
                <div key={item.key} className={item.issue ? "needs-review" : ""}>
                  <span>{item.label}<small>{Math.round(item.confidence * 100)}%</small></span>
                  <b>{String(item.value)}</b>
                  {item.issue && <i>{item.issue}</i>}
                </div>
              ))}
            </div>
            {proposal.unresolved.length > 0 && (
              <div className="local-ai-issues">
                <WarningCircle weight="fill" />
                <span><b>还不能生成正式核对草稿</b>{proposal.unresolved.map((item) => <small key={item}>{item}</small>)}</span>
              </div>
            )}
            {proposal.warnings.length > 0 && (
              <ul className="local-ai-warnings">
                {proposal.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            )}
            {error && <VaultError message={error} />}
            <div className="local-ai-guardrail">
              <ShieldCheck weight="fill" />
              <span>
                <b>{proposalQueue.length > 1 ? `本次共 ${proposalQueue.length} 项，逐项确认` : "下一步仍然只是 needs_review 草稿"}</b>
                <small>按钮不会直接写余额；每一项都会显示原生层重新校验后的最终核对页。</small>
              </span>
            </div>
            <div className="modal-actions">
              <button className="secondary" onClick={() => {
                if (proposalIndex > 0) {
                  void dismiss();
                  return;
                }
                setStage("input");
                setProposalQueue([]);
                setProposalIndex(0);
                setError("");
              }} disabled={busy}>{proposalIndex > 0 ? "结束本次核对" : "返回修改原文"}</button>
              <button className="primary" onClick={() => void createReviewDraft()} disabled={busy || proposal.status !== "reviewable"}>
                {busy
                  ? "正在生成…"
                  : proposalQueue.length > 1
                    ? `生成第 ${proposalIndex + 1} 项核对草稿`
                    : "生成核对草稿"} {!busy && <ArrowRight />}
              </button>
            </div>
          </>
        )}

        {stage === "domain" && domainDraft && proposal && (
          <>
            <header className="local-ai-heading">
              <span><ShieldCheck weight="fill" /></span>
              <div><small>原生层已重新校验 · 待明确确认{proposalQueue.length > 1 ? ` · 第 ${proposalIndex + 1} / ${proposalQueue.length} 项` : ""}</small><h2 id="local-ai-title">最后核对正式变更</h2><p>以下值来自 SQLCipher 草稿响应，不是模型自由文本。</p></div>
            </header>
            <div className="local-ai-fields exact">
              {rows.map(([label, value]) => (
                <div key={label}><span>{label}</span><b>{value ?? "未设置"}</b></div>
              ))}
            </div>
            <div className="local-ai-issues safe">
              <ShieldCheck weight="fill" />
              <span><b>尚未写入正式数据</b><small>只有点击下方“明确确认”后，领域层才会在单个事务中写入并追加审计。</small></span>
            </div>
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button className="secondary" onClick={() => void dismiss()} disabled={busy}>
                {proposalIndex > 0 ? "结束本次核对" : "取消并拒绝草稿"}
              </button>
              <button className="primary" onClick={() => void confirm()} disabled={busy}>
                {busy
                  ? "正在确认…"
                  : proposalIndex + 1 < proposalQueue.length
                    ? "明确确认并继续下一项"
                    : "明确确认并写入"} {!busy && <Check />}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function localCurrencyParts(minor, currency = "CNY") {
  const parts = new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(Number(minor ?? 0) / 100);
  return {
    symbol: parts.find((part) => part.type === "currency")?.value ?? currency,
    major: parts
      .filter((part) => part.type === "integer" || part.type === "group")
      .map((part) => part.value)
      .join(""),
    fraction: parts.find((part) => part.type === "fraction")?.value ?? "00",
  };
}

function localSignedMoney(minor, currency = "CNY", hidden = false) {
  if (hidden) return "••••••";
  const sign = minor > 0 ? "+" : minor < 0 ? "−" : "";
  return `${sign}${formatBalance({ balanceMinor: Math.abs(minor), currency })}`;
}

const LOCAL_CHART_COLORS = Object.freeze({
  lime: "#b8f246",
  purple: "#8875e9",
  ink: "#28292d",
  mint: "#9ee8cb",
  grey: "#cfd0d5",
});

function localCompactMoney(minor) {
  const yuan = Number(minor ?? 0) / 100;
  if (Math.abs(yuan) >= 10_000) {
    const value = yuan / 10_000;
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}万`;
  }
  if (Math.abs(yuan) >= 1_000) return `${(yuan / 1_000).toFixed(1)}千`;
  return String(Math.round(yuan));
}

function localAllocationSeries(holdings, baseCurrency) {
  const definitions = [
    { key: "cash", label: "活期", types: ["cash_management"], color: LOCAL_CHART_COLORS.lime },
    { key: "stable", label: "存款 / 理财", types: ["fixed_income"], color: LOCAL_CHART_COLORS.purple },
    { key: "fund", label: "基金 / 证券", types: ["fund", "security"], color: LOCAL_CHART_COLORS.ink },
    { key: "insurance", label: "保险", types: ["insurance"], color: LOCAL_CHART_COLORS.mint },
    { key: "other", label: "黄金 / 受限", types: ["other"], color: LOCAL_CHART_COLORS.grey },
  ];
  return definitions.map((definition) => ({
    ...definition,
    value: holdings
      .filter((holding) => (
        !holding.archivedAt
        && holding.currency === baseCurrency
        && definition.types.includes(holding.productType)
      ))
      .reduce((sum, holding) => sum + Number(holding.marketValueMinor ?? 0), 0),
  })).filter((item) => item.value > 0);
}

function localMonthlyCashflowSeries(transactions, baseCurrency, now = new Date()) {
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      month: `${date.getMonth() + 1}月`,
      incomeMinor: 0,
      expenseMinor: 0,
    };
  });
  const monthByKey = new Map(months.map((item) => [item.key, item]));
  for (const transaction of transactions) {
    if (transaction.reversed || transaction.currency !== baseCurrency) continue;
    const date = new Date(transaction.occurredAt ?? transaction.createdAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const month = monthByKey.get(key);
    if (!month) continue;
    if (transaction.kind === "income") month.incomeMinor += Number(transaction.amountMinor ?? 0);
    if (transaction.kind === "expense") month.expenseMinor += Number(transaction.amountMinor ?? 0);
  }
  return months;
}

function LocalOverviewMetric({ icon: Icon, label, value, hint, variant = "" }) {
  return (
    <article className={`metric-card ${variant}`.trim()}>
      <div className="metric-icon"><Icon weight="duotone" /></div>
      <div><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>
    </article>
  );
}

function DailyChangeBadge({ status }) {
  const label = dailyChangeLabel(status);
  if (!label) return null;
  return <span className={`daily-change-badge ${status}`}>{label}</span>;
}

function LocalOverview({
  vault,
  accounts,
  totalMinor,
  assetMinor = totalMinor,
  availableCashMinor = 0,
  availableCashAccountCount = 0,
  holdings = [],
  assetTrend = [],
  transactions = [],
  reminders = [],
  planning,
  dailyChanges = { accounts: {} },
  syncStatus = EMPTY_NATIVE_SYNC_STATUS,
  hidden = false,
  onToggleHidden,
  onNavigate,
  onCapture,
}) {
  const baseCurrency = vault.baseCurrency ?? "CNY";
  const now = new Date();
  const currentMonthTransactions = transactions.filter((item) => {
    if (item.reversed || (item.currency ?? baseCurrency) !== baseCurrency) return false;
    const date = new Date(item.occurredAt ?? item.createdAt);
    return !Number.isNaN(date.getTime())
      && date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth();
  });
  const incomeMinor = currentMonthTransactions
    .filter((item) => item.kind === "income")
    .reduce((sum, item) => sum + Number(item.amountMinor ?? 0), 0);
  const expenseMinor = currentMonthTransactions
    .filter((item) => item.kind === "expense")
    .reduce((sum, item) => sum + Number(item.amountMinor ?? 0), 0);
  const displayIncomeMinor = incomeMinor;
  const displayExpenseMinor = expenseMinor;
  const displayCashflowMinor = displayIncomeMinor - displayExpenseMinor;
  const allocationSeries = localAllocationSeries(holdings, baseCurrency);
  const allocationTotalMinor = allocationSeries.reduce((sum, item) => sum + item.value, 0);
  const assetTrendDomain = deriveAssetTrendYAxisDomain(assetTrend);
  const assetTrendChangeMinor = assetTrend.length > 1
    ? assetTrend.at(-1).totalMinor - assetTrend[0].totalMinor
    : 0;
  const activeReminders = reminders.filter((item) => item.status === "active");
  const nearestReminder = [...activeReminders]
    .sort((left, right) => String(left.dueOn).localeCompare(String(right.dueOn)))[0];
  const totalParts = localCurrencyParts(totalMinor, baseCurrency);
  const hero = accounts.length === 0
    ? {
        icon: UploadSimple,
        title: "先导入一份真实资料",
        body: "语音、截图、PDF 或 Markdown 都可以；Folio 会整理成待核对草稿。",
        action: "开始录入",
        onAction: () => onCapture("file"),
      }
    : nearestReminder
      ? {
          icon: CalendarCheck,
          title: `${activeReminders.length} 项财务事项待处理`,
          body: `${nearestReminder.title} · ${nearestReminder.dueOn}。完成本期后会保留记录并安排下一期。`,
          action: "查看事项",
          onAction: () => onNavigate("reminders"),
        }
      : {
          icon: Wallet,
          title: "账本已完成本地整理",
          body: `${accounts.length} 个账户均从加密账本读取，本月净现金流为 ${localSignedMoney(displayCashflowMinor, baseCurrency)}。`,
          action: "查看流水",
          onAction: () => onNavigate("cashflow"),
        };
  const HeroIcon = hero.icon;
  const planningHint = planning
    ? `现金安全垫 ${formatBalance({ balanceMinor: planning.cashBufferMinor, currency: baseCurrency })}`
    : "尚未设置长期规划";

  return (
    <div className="dashboard local-overview-v2">
      <section className="hero-grid">
        <article className="net-worth-card">
          <div className="net-top">
            <span>
              家庭净资产
              <button className="plain-icon" onClick={onToggleHidden} aria-label={hidden ? "显示金额" : "隐藏金额"}>
                {hidden ? <EyeSlash /> : <Eye />}
              </button>
            </span>
            <div className="sync-status"><i /> {syncStatus.enabled ? "密文同步" : "本地已保存"}</div>
          </div>
          <div className="net-value">
            <span>{totalParts.symbol}</span>
            <strong>{hidden ? "••••••" : totalParts.major}</strong>
            {!hidden && <small>.{totalParts.fraction}</small>}
          </div>
          <div className="net-change">
            <ArrowUp weight="bold" /> 本月现金流
            <b>{localSignedMoney(displayCashflowMinor, baseCurrency, hidden)}</b>
            <span>{currentMonthTransactions.length} 笔</span>
          </div>
          <div className="net-summary">
            <div><span>总资产</span><b>{hidden ? "••••••" : formatBalance({ balanceMinor: assetMinor, currency: baseCurrency })}</b></div>
            <div className="configurable-metric">
              <span>活期可用<button onClick={() => onNavigate("planning")} aria-label="配置首页指标"><Gear /></button></span>
              <b>{hidden ? "••••••" : formatBalance({ balanceMinor: availableCashMinor, currency: baseCurrency })}</b>
            </div>
            <div><span>待办事项</span><b>{activeReminders.length} 项</b></div>
          </div>
        </article>

        <article className="ai-focus-card">
          <div className="card-label">
            <span><Sparkle weight="fill" /> AI 今日重点</span>
            <div className="focus-controls"><small>1 / 1</small></div>
          </div>
          <div className="focus-body">
            <div className="focus-icon"><HeroIcon weight="duotone" /></div>
            <div>
              <h3>{hero.title}</h3>
              <p>{hero.body}</p>
              <button onClick={hero.onAction}>{hero.action} <ArrowRight /></button>
            </div>
          </div>
          <div className="focus-dots"><button className="active" aria-label="当前重点" /></div>
        </article>
      </section>

      <section className="metrics-row">
        <LocalOverviewMetric
          icon={Wallet}
          label="可用活期"
          value={hidden ? "••••••" : formatBalance({ balanceMinor: availableCashMinor, currency: baseCurrency })}
          hint={`${availableCashAccountCount} 项可用现金资产`}
          variant="lime"
        />
        <LocalOverviewMetric
          icon={ArrowDown}
          label="本月收入"
          value={hidden ? "••••••" : formatBalance({ balanceMinor: displayIncomeMinor, currency: baseCurrency })}
          hint={`${currentMonthTransactions.filter((item) => item.kind === "income").length} 笔已确认`}
        />
        <LocalOverviewMetric
          icon={ArrowUp}
          label="本月支出"
          value={hidden ? "••••••" : formatBalance({ balanceMinor: displayExpenseMinor, currency: baseCurrency })}
          hint={`${currentMonthTransactions.filter((item) => item.kind === "expense").length} 笔已确认`}
        />
        <LocalOverviewMetric
          icon={ChartDonut}
          label="规划状态"
          value={planning ? "已设置" : "待设置"}
          hint={planningHint}
        />
      </section>

      {accounts.length === 0 ? (
        <section className="local-empty local-onboarding local-v2-onboarding">
          <div className="local-empty-icon"><Sparkle weight="fill" /></div>
          <span>从这里开始</span>
          <h3>把资料交给 Folio</h3>
          <p>口述或导入截图、PDF、Markdown；AI 整理后由你确认。</p>
          <div className="local-empty-actions">
            <button onClick={() => onCapture("voice")}><Microphone weight="fill" /> 先说一段</button>
            <button className="secondary" onClick={() => onCapture("file")}><UploadSimple /> 导入资料</button>
          </div>
          <button className="local-empty-manual" onClick={() => onNavigate("assets")}>
            <Plus /> 或手动添加账户
          </button>
        </section>
      ) : (
        <>
        <section className="local-overview-insights">
          <article className="panel local-overview-trend-card">
            <header className="panel-head">
              <div>
                <h2>资产趋势</h2>
                <p>{assetTrend.length > 1
                  ? `近 6 个月变化 ${localSignedMoney(assetTrendChangeMinor, baseCurrency)}`
                  : "等待更多历史估值"}</p>
              </div>
              {assetTrend.length > 1 && <span className="local-preview-badge">已确认账本 · 区间缩放</span>}
            </header>
            {assetTrend.length > 1 ? (
              <button
                type="button"
                className="local-overview-chart local-overview-chart-action"
                aria-label="近六个月已确认资产趋势图，打开流水"
                onClick={() => onNavigate("cashflow")}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={assetTrend} margin={{ top: 18, right: 8, left: -14, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#e4e4e8" strokeDasharray="3 5" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#898b93", fontSize: 10 }} />
                    <YAxis domain={assetTrendDomain} allowDataOverflow axisLine={false} tickLine={false} tickFormatter={localCompactMoney} tick={{ fill: "#898b93", fontSize: 10 }} />
                    <Tooltip formatter={(value) => formatMinorAmount(Number(value), baseCurrency)} labelStyle={{ color: "#6f7179" }} />
                    <Area type="monotone" dataKey="totalMinor" stroke={LOCAL_CHART_COLORS.ink} strokeWidth={2.5} fill="#ece9fb" fillOpacity={0.72} dot={{ r: 2.8, fill: "#fff", stroke: LOCAL_CHART_COLORS.ink, strokeWidth: 1.5 }} activeDot={{ r: 4, fill: LOCAL_CHART_COLORS.lime, stroke: LOCAL_CHART_COLORS.ink }} />
                  </AreaChart>
                </ResponsiveContainer>
              </button>
            ) : (
              <div className="local-chart-empty">
                <ChartDonut weight="duotone" />
                <span>需要至少两个月的已确认资产变化</span>
                <small>补录历史收入、支出或估值后，这里会按月回溯总资产。</small>
                <button type="button" onClick={() => onCapture("file")}>导入历史资料 <ArrowRight /></button>
              </div>
            )}
          </article>

          <article className="panel local-overview-allocation-card">
            <header className="panel-head">
              <div><h2>资产配置</h2><p>按当前持仓市值计算</p></div>
              <button onClick={() => onNavigate("assets")}>查看明细 <ArrowRight /></button>
            </header>
            <div className="local-overview-allocation-body">
              <div className="local-overview-donut">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={allocationSeries} dataKey="value" innerRadius="64%" outerRadius="88%" paddingAngle={2} stroke="none">
                      {allocationSeries.map((item) => <Cell key={item.key} fill={item.color} />)}
                    </Pie>
                    <Tooltip formatter={(value) => formatMinorAmount(Number(value), baseCurrency)} />
                  </PieChart>
                </ResponsiveContainer>
                <span><b>{allocationSeries.length}</b><small>类资产</small></span>
              </div>
              <div className="local-overview-allocation-list">
                {allocationSeries.map((item) => (
                  <div key={item.key}>
                    <i style={{ background: item.color }} />
                    <span><b>{item.label}</b><small>{formatMinorAmount(item.value, baseCurrency)}</small></span>
                    <em>{allocationTotalMinor ? `${((item.value / allocationTotalMinor) * 100).toFixed(1)}%` : "0%"}</em>
                  </div>
                ))}
              </div>
            </div>
          </article>
        </section>

        <section className="panel local-v2-account-panel">
          <header className="panel-head">
            <div><h2>账户与资产</h2><p>真实余额来自当前已解锁的本地加密账本</p></div>
            <button onClick={() => onNavigate("assets")}>查看全部 <ArrowRight /></button>
          </header>
          <div className="local-account-grid">
            {accounts.map((account) => {
              const changeStatus = dailyChanges.accounts?.[account.id];
              return (
              <button
                type="button"
                key={account.id}
                className={changeStatus ? "is-daily-change" : ""}
                onClick={() => onNavigate("assets", { accountId: account.id })}
                aria-label={`查看 ${account.displayName} 资产详情`}
              >
                <Wallet weight="duotone" />
                <b>{account.displayName}</b>
                <small>{account.institutionName}</small>
                <DailyChangeBadge status={changeStatus} />
              </button>
              );
            })}
          </div>
        </section>
        </>
      )}
    </div>
  );
}

function LocalAssets({
  accounts,
  holdings = [],
  holdingOperations = [],
  dailyChanges = { accounts: {}, holdings: {} },
  baseCurrency,
  onCreateDraft,
  onUpdateDraft,
  onArchiveDraft,
  onConfirmDraft,
  onRejectDraft,
  onCreateHoldingDraft,
  onCreateHoldingValuationDraft,
  onUpdateHoldingDraft,
  onArchiveHoldingDraft,
  onConfirmHoldingDraft,
  onRejectHoldingDraft,
  onCreateHoldingOperationDraft,
  onConfirmHoldingOperationDraft,
  onRejectHoldingOperationDraft,
  onCreateHoldingOperationCorrectionDraft,
  onConfirmHoldingOperationCorrectionDraft,
  onRejectHoldingOperationCorrectionDraft,
  onHoldingCommitted,
  onCommitted,
  onNavigate,
  initialAccountId = null,
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [managedAccount, setManagedAccount] = useState(() => (
    initialAccountId ? accounts.find((account) => account.id === initialAccountId) ?? null : null
  ));
  const [holdingModalOpen, setHoldingModalOpen] = useState(false);
  const [valuedHolding, setValuedHolding] = useState(null);
  const [operatedHolding, setOperatedHolding] = useState(null);
  const [correctedOperation, setCorrectedOperation] = useState(null);
  const [managedHolding, setManagedHolding] = useState(null);
  const [holdingAccountFilter, setHoldingAccountFilter] = useState("all");
  const [holdingTypeFilter, setHoldingTypeFilter] = useState("all");
  const [holdingStatusFilter, setHoldingStatusFilter] = useState("active");
  const [section, setSection] = useState("资产明细");
  const [accountTypeFilter, setAccountTypeFilter] = useState("all");
  const assetCategoryFilters = [
    { value: "all", label: "全部" },
    { value: "cash", label: "活期" },
    { value: "investment", label: "理财" },
    { value: "fund", label: "基金" },
    { value: "insurance", label: "保险" },
  ];
  const activeHoldings = holdings.filter((holding) => !holding.archivedAt);
  const holdingTypesByAssetCategory = {
    cash: ["cash_management"],
    investment: ["fixed_income"],
    fund: ["fund", "security"],
    insurance: ["insurance"],
  };
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const filteredAssetRows = accountTypeFilter === "all"
    ? accounts.map((account) => ({
        kind: "account",
        key: account.id,
        account,
        amountMinor: Number(account.balanceMinor ?? 0),
      }))
    : [
        ...activeHoldings
          .filter((holding) => (
            holdingTypesByAssetCategory[accountTypeFilter]?.includes(holding.productType)
          ))
          .map((holding) => ({
            kind: "holding",
            key: holding.id,
            account: accountById.get(holding.accountId),
            holding,
            amountMinor: Number(holding.marketValueMinor ?? 0),
          })),
        ...(accountTypeFilter === "cash"
          ? accounts
              .filter((account) => (
                ["cash", "savings"].includes(account.accountType)
                && !activeHoldings.some((holding) => holding.accountId === account.id)
              ))
              .map((account) => ({
                kind: "account",
                key: account.id,
                account,
                amountMinor: Number(account.balanceMinor ?? 0),
              }))
          : []),
      ];
  const filteredAssetMinor = filteredAssetRows.reduce(
    (sum, row) => sum + row.amountMinor,
    0,
  );
  const filteredHoldings = holdings.filter((holding) => (
    (holdingAccountFilter === "all" || holding.accountId === holdingAccountFilter)
    && (holdingTypeFilter === "all" || holding.productType === holdingTypeFilter)
    && (
      holdingStatusFilter === "all"
      || (holdingStatusFilter === "active" && !holding.archivedAt)
      || (holdingStatusFilter === "archived" && Boolean(holding.archivedAt))
    )
  ));
  const baseCurrencyMarketMinor = activeHoldings
    .filter((holding) => holding.currency === baseCurrency)
    .reduce((sum, holding) => sum + Number(holding.marketValueMinor ?? 0), 0);
  const baseCurrencyTotalMinor = accounts
    .filter((account) => account.currency === baseCurrency)
    .reduce((sum, account) => sum + Number(account.balanceMinor ?? 0), 0);
  return (
    <>
      <div className="subpage local-assets-v2">
        <section className="page-summary">
          <div>
            <span>总资产</span>
            <strong>{formatMinorAmount(baseCurrencyTotalMinor, baseCurrency)}</strong>
            <small><ShieldCheck weight="fill" /> {accounts.length} 个账户已从本地加密账本读取</small>
          </div>
          <button onClick={() => setModalOpen(true)}><Plus /> 添加账户</button>
        </section>

        <section className="panel">
          <div className="panel-head responsive">
            <div><h2>资产配置</h2><p>从账户明细到产品表现与 AI 调仓建议</p></div>
            <div className="section-tabs">
              {["资产明细", "产品表现", "AI调仓建议"].map((item) => (
                <button
                  key={item}
                  className={section === item ? "active" : ""}
                  onClick={() => setSection(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          {section === "资产明细" && (
            <>
              <div className="filter-pills asset-filters">
                {assetCategoryFilters.map((option) => (
                  <button
                    key={option.value}
                    className={accountTypeFilter === option.value ? "active" : ""}
                    onClick={() => setAccountTypeFilter(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {accountTypeFilter !== "all" && (
                <div className="asset-filter-summary" aria-live="polite">
                  <span>{assetCategoryFilters.find((item) => item.value === accountTypeFilter)?.label}合计</span>
                  <strong>{formatMinorAmount(filteredAssetMinor, baseCurrency)}</strong>
                  <small>
                    {filteredAssetRows.length} 项账户内资产
                    {accountTypeFilter === "cash" ? " · 不含冻结资金" : ""}
                  </small>
                </div>
              )}
              {accounts.length === 0 ? (
                <div className="local-assets-empty local-v2-assets-empty">
                  <div><Buildings weight="duotone" /></div>
                  <span>支持手动录入 · CSV/TSV/XLSX · 飞书/Excel 主动粘贴</span>
                  <h3>添加第一个真实账户</h3>
                  <p>机构、账户名称、币种和期初余额会先生成草稿；关闭或返回修改不会影响正式账本。</p>
                  <button onClick={() => setModalOpen(true)}><Plus /> 添加账户</button>
                </div>
              ) : (
                <>
                  <div className="asset-table-head">
                    <span>{accountTypeFilter === "all" ? "机构 / 资产" : "机构 / 产品"}</span><span>类型</span><span>币种</span><span>{accountTypeFilter === "all" ? "余额" : "市值"}</span><span>操作</span>
                  </div>
                  <div className="asset-table">
                    {filteredAssetRows.map((row, index) => {
                      const account = row.account;
                      if (!account) return null;
                      const changeStatus = row.kind === "holding"
                        ? dailyChanges.holdings?.[row.holding.id]
                        : dailyChanges.accounts?.[account.id];
                      return (
                      <button
                        className={`asset-table-row ${changeStatus ? "is-daily-change" : ""}`}
                        key={row.key}
                        onClick={() => {
                          if (row.kind === "holding") {
                            setHoldingAccountFilter(account.id);
                            setHoldingTypeFilter(row.holding.productType);
                            setSection("产品表现");
                          } else {
                            setManagedAccount(account);
                          }
                        }}
                      >
                        <span className="asset-identity">
                          <i className={`bank-logo ${index % 3 === 0 ? "lime" : index % 3 === 1 ? "purple" : "mint"}`}>
                            {account.institutionName.slice(0, 1)}
                          </i>
                          <b>
                            {account.institutionName}
                            <small>{row.kind === "holding" ? row.holding.name : `${account.displayName}${account.maskedIdentifier ? ` · 尾号 ${account.maskedIdentifier}` : ""}`}</small>
                            <DailyChangeBadge status={changeStatus} />
                          </b>
                        </span>
                        <span>{row.kind === "holding" ? holdingTypeLabel(row.holding.productType) : accountTypeLabel(account.accountType)}</span>
                        <span>{row.kind === "holding" ? row.holding.currency : account.currency}</span>
                        <strong>{formatMinorAmount(row.amountMinor, row.kind === "holding" ? row.holding.currency : account.currency)}</strong>
                        <em>{row.kind === "holding" ? "查看产品" : "管理"}</em>
                      </button>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}

          {section === "AI调仓建议" && (
            <div className="rebalance-layout local-v2-rebalance">
              <article className="rebalance-card important">
                <span><Sparkle weight="fill" /></span>
                <div>
                  <small>先模拟，后决定</small>
                  <h3>{planning ? "当前规划可继续试算" : "先建立长期配置目标"}</h3>
                  <p>Folio 只根据本地已确认数据生成建议，不会直接申购、赎回或修改账户余额。</p>
                </div>
                <button onClick={() => onNavigate("planning")}>进入模拟沙盘 <ArrowRight /></button>
              </article>
              <article className="rebalance-card">
                <span><Coins weight="duotone" /></span>
                <div>
                  <small>产品覆盖</small>
                  <h3>{activeHoldings.length} 项有效持仓</h3>
                  <p>{formatMinorAmount(baseCurrencyMarketMinor, baseCurrency)} 已作为账户内部产品拆解，不会重复计入净资产。</p>
                </div>
                <button onClick={() => setSection("产品表现")}>查看产品 <ArrowRight /></button>
              </article>
              <div className="ai-disclaimer">
                <ShieldCheck weight="fill" />
                <span><b>所有建议都必须经过核对</b><small>高风险资金动作仍遵循解析 → 核对 → 明确确认。</small></span>
              </div>
            </div>
          )}
        </section>

        {section === "产品表现" && <section className="local-holdings-section">
          <header>
            <div>
              <span><Coins weight="duotone" /> 账户内部明细</span>
              <h2>持仓与产品</h2>
              <p>持仓用于拆解账户余额，不会重复计入净资产。</p>
            </div>
            <button
              type="button"
              onClick={() => setHoldingModalOpen(true)}
              disabled={accounts.length === 0}
            >
              <Plus /> 添加持仓
            </button>
          </header>

          <div className="local-holdings-summary">
            <article>
              <Coins weight="duotone" />
              <span><small>有效持仓</small><b>{activeHoldings.length}</b></span>
            </article>
            <article>
              <ChartDonut weight="duotone" />
              <span><small>{baseCurrency} 市值拆解</small><b>{formatMinorAmount(baseCurrencyMarketMinor, baseCurrency)}</b></span>
            </article>
            <article>
              <ShieldCheck weight="fill" />
              <span><small>汇总口径</small><b>不重复计入</b></span>
            </article>
          </div>

          <div className="local-holdings-toolbar">
            <label>
              <span>所属账户</span>
              <select
                value={holdingAccountFilter}
                onChange={(event) => setHoldingAccountFilter(event.target.value)}
              >
                <option value="all">全部账户</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.displayName}</option>
                ))}
              </select>
            </label>
            <label>
              <span>产品类型</span>
              <select
                value={holdingTypeFilter}
                onChange={(event) => setHoldingTypeFilter(event.target.value)}
              >
                <option value="all">全部类型</option>
                {HOLDING_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>状态</span>
              <select
                value={holdingStatusFilter}
                onChange={(event) => setHoldingStatusFilter(event.target.value)}
              >
                <option value="active">有效持仓</option>
                <option value="archived">已归档</option>
                <option value="all">全部状态</option>
              </select>
            </label>
            <span>{filteredHoldings.length} / {holdings.length} 项</span>
          </div>

          {holdings.length === 0 ? (
            <div className="local-holdings-empty">
              <Coins weight="duotone" />
              <span>持仓只拆解账户余额，不会额外增加净资产</span>
              <h3>记录第一个基金、理财或保险产品</h3>
              <p>持有数量、累计成本和当前市值会先生成核对草稿；后续估值以不可变快照追加。</p>
              <button
                type="button"
                onClick={() => setHoldingModalOpen(true)}
                disabled={accounts.length === 0}
              >
                <Plus /> 添加持仓
              </button>
            </div>
          ) : filteredHoldings.length === 0 ? (
            <div className="local-holdings-filter-empty">
              当前筛选条件下没有持仓。调整账户或产品类型后再查看。
            </div>
          ) : (
            <div className="local-holdings-grid">
              {filteredHoldings.map((holding) => {
                const gainMinor = Number(holding.gainMinor ?? 0);
                const returnBps = Number.isSafeInteger(holding.returnBps)
                  ? holding.returnBps
                  : null;
                const changeStatus = dailyChanges.holdings?.[holding.id];
                return (
                  <article key={holding.id} className={`${holding.archivedAt ? "archived" : ""} ${changeStatus ? "is-daily-change" : ""}`.trim()}>
                    <header>
                      <span><Coins weight="duotone" /></span>
                      <i>{holding.archivedAt ? "已归档" : holdingTypeLabel(holding.productType)}</i>
                    </header>
                    <DailyChangeBadge status={changeStatus} />
                    <small>{holding.accountName}</small>
                    <h3>{holding.name}</h3>
                    <p>
                      {holding.maskedIdentifier ? `尾号 ${holding.maskedIdentifier} · ` : ""}
                      {formatUnitsMicros(holding.unitsMicros)} 份
                    </p>
                    <strong>{formatMinorAmount(holding.marketValueMinor, holding.currency)}</strong>
                    <dl>
                      <div><dt>累计成本</dt><dd>{formatMinorAmount(holding.costBasisMinor, holding.currency)}</dd></div>
                      <div className={gainMinor >= 0 ? "positive" : "negative"}>
                        <dt>持仓收益</dt>
                        <dd>
                          {gainMinor >= 0 ? "+" : ""}
                          {formatMinorAmount(gainMinor, holding.currency)}
                          {returnBps == null
                            ? " · —"
                            : ` · ${returnBps >= 0 ? "+" : ""}${(returnBps / 100).toFixed(2)}%`}
                        </dd>
                      </div>
                    </dl>
                    <footer>
                      <span>{holding.archivedAt ? `归档于 ${holding.archivedAt.slice(0, 10)}` : `估值日 ${holding.asOfDate}`}</span>
                      {!holding.archivedAt && (
                        <div>
                          <button type="button" onClick={() => setManagedHolding(holding)}>
                            管理
                          </button>
                          <button type="button" onClick={() => setOperatedHolding(holding)}>
                            记交易
                          </button>
                          <button type="button" onClick={() => setValuedHolding(holding)}>
                            更新估值 <ArrowRight />
                          </button>
                        </div>
                      )}
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </section>}
      </div>

      {modalOpen && (
        <LocalAccountModal
          baseCurrency={baseCurrency}
          onCreateDraft={onCreateDraft}
          onConfirmDraft={onConfirmDraft}
          onRejectDraft={onRejectDraft}
          onCommitted={onCommitted}
          onClose={() => setModalOpen(false)}
        />
      )}
      {managedAccount && (
        <LocalAccountManagerModal
          account={managedAccount}
          onUpdateDraft={onUpdateDraft}
          onArchiveDraft={onArchiveDraft}
          onConfirmDraft={onConfirmDraft}
          onRejectDraft={onRejectDraft}
          onCommitted={onCommitted}
          onClose={() => setManagedAccount(null)}
        />
      )}
      {holdingModalOpen && (
        <LocalHoldingModal
          accounts={accounts}
          onCreateDraft={onCreateHoldingDraft}
          onConfirmDraft={onConfirmHoldingDraft}
          onRejectDraft={onRejectHoldingDraft}
          onCommitted={onHoldingCommitted}
          onClose={() => setHoldingModalOpen(false)}
        />
      )}
      {valuedHolding && (
        <LocalHoldingValuationModal
          holding={valuedHolding}
          onCreateDraft={onCreateHoldingValuationDraft}
          onConfirmDraft={onConfirmHoldingDraft}
          onRejectDraft={onRejectHoldingDraft}
          onCommitted={onHoldingCommitted}
          onClose={() => setValuedHolding(null)}
        />
      )}
      {operatedHolding && (
        <LocalHoldingOperationModal
          holding={operatedHolding}
          accounts={accounts}
          operations={holdingOperations.filter((item) => item.holdingId === operatedHolding.id)}
          onCreateDraft={onCreateHoldingOperationDraft}
          onConfirmDraft={onConfirmHoldingOperationDraft}
          onRejectDraft={onRejectHoldingOperationDraft}
          onCommitted={() => onHoldingCommitted("operation")}
          onCorrect={(operation) => {
            setOperatedHolding(null);
            setCorrectedOperation(operation);
          }}
          onClose={() => setOperatedHolding(null)}
        />
      )}
      {correctedOperation && (
        <LocalHoldingOperationCorrectionModal
          operation={correctedOperation}
          onCreateDraft={onCreateHoldingOperationCorrectionDraft}
          onConfirmDraft={onConfirmHoldingOperationCorrectionDraft}
          onRejectDraft={onRejectHoldingOperationCorrectionDraft}
          onCommitted={() => onHoldingCommitted("correction")}
          onClose={() => setCorrectedOperation(null)}
        />
      )}
      {managedHolding && (
        <LocalHoldingManagerModal
          holding={managedHolding}
          onUpdateDraft={onUpdateHoldingDraft}
          onArchiveDraft={onArchiveHoldingDraft}
          onConfirmDraft={onConfirmHoldingDraft}
          onRejectDraft={onRejectHoldingDraft}
          onCommitted={onHoldingCommitted}
          onClose={() => setManagedHolding(null)}
        />
      )}
    </>
  );
}

function LocalHoldingModal({
  accounts,
  onCreateDraft,
  onConfirmDraft,
  onRejectDraft,
  onCommitted,
  onClose,
}) {
  const [form, setForm] = useState(() => createEmptyHoldingForm(accounts));
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (field) => (event) => {
    const value = event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
  };
  const chooseAccount = (event) => {
    const account = accounts.find((item) => item.id === event.target.value);
    setForm((current) => ({
      ...current,
      accountId: account?.id ?? "",
      currency: account?.currency ?? current.currency,
    }));
    setError("");
  };
  const createDraft = async (event) => {
    event.preventDefault();
    const issue = validateHoldingForm(form, accounts);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    setError("");
    try {
      setDraft(await onCreateDraft(toHoldingDraftInput(form, accounts)));
    } catch (draftError) {
      setError(presentHoldingError(draftError));
    } finally {
      setBusy(false);
    }
  };
  const dismiss = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (draft?.draftId) await onRejectDraft(draft.draftId);
      onClose();
    } catch (draftError) {
      setError(presentHoldingError(draftError));
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!draft?.draftId || busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirmDraft(draft.draftId);
      onCommitted("create");
      onClose();
    } catch (confirmationError) {
      setError(presentHoldingError(confirmationError));
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card local-account-modal local-holding-modal" role="dialog" aria-modal="true" aria-labelledby="holding-modal-title">
        <header className="modal-header">
          <div><span><Coins weight="duotone" /></span><div><small>加密持仓明细</small><h2 id="holding-modal-title">{draft ? "核对持仓与首个估值" : "添加持仓"}</h2></div></div>
          <button type="button" onClick={() => void dismiss()} aria-label="关闭添加持仓弹窗"><X /></button>
        </header>
        {!draft ? (
          <form onSubmit={createDraft}>
            <div className="local-holding-boundary">
              <ShieldCheck weight="fill" />
              <span><b>不会改变所属账户余额</b><small>这里记录的是账户内部产品拆解；买入、赎回或转账仍需在流水中单独确认。</small></span>
            </div>
            <div className="form-grid local-account-form">
              <label><span>所属账户</span><select value={form.accountId} onChange={chooseAccount} required>{accounts.map((account) => <option key={account.id} value={account.id}>{account.displayName} · {account.currency}</option>)}</select></label>
              <label><span>产品类型</span><select value={form.productType} onChange={update("productType")}>{HOLDING_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label className="wide"><span>产品名称</span><input value={form.name} onChange={update("name")} maxLength={120} placeholder="例如：招商中证红利 A" required /></label>
              <label><span>产品尾号（可选）</span><input value={form.maskedIdentifier} onChange={update("maskedIdentifier")} maxLength={16} placeholder="只保留脱敏尾号" /></label>
              <label><span>估值日期</span><input type="date" value={form.asOfDate} onChange={update("asOfDate")} required /></label>
              <label><span>持有数量</span><input value={form.units} onChange={update("units")} inputMode="decimal" placeholder="最多六位小数" required /></label>
              <label><span>累计成本</span><div className="money-input"><b>{form.currency}</b><input value={form.costBasis} onChange={update("costBasis")} inputMode="decimal" required /></div></label>
              <label><span>当前市值</span><div className="money-input"><b>{form.currency}</b><input value={form.marketValue} onChange={update("marketValue")} inputMode="decimal" required /></div></label>
              <label className="wide"><span>备注（可选）</span><textarea value={form.notes} onChange={update("notes")} maxLength={1000} rows={3} /></label>
            </div>
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => void dismiss()} disabled={busy}>取消</button>
              <button type="submit" className="primary" disabled={busy}>{busy ? "正在生成核对稿…" : "生成核对稿"} {!busy && <ArrowRight />}</button>
            </div>
          </form>
        ) : (
          <>
            <div className="local-review-banner"><ShieldCheck weight="fill" /><span><b>请逐项核对</b><small>确认后只写入持仓和估值快照，不会写入账本流水。</small></span></div>
            <div className="local-draft-review-grid">
              <div><small>所属账户</small><b>{draft.accountName}</b></div>
              <div><small>产品类型</small><b>{holdingTypeLabel(draft.productType)}</b></div>
              <div><small>产品名称</small><b>{draft.name}</b></div>
              <div><small>持有数量</small><b>{formatUnitsMicros(draft.unitsMicros)}</b></div>
              <div><small>累计成本</small><b>{formatMinorAmount(draft.costBasisMinor, draft.currency)}</b></div>
              <div><small>当前市值</small><b>{formatMinorAmount(draft.marketValueMinor, draft.currency)}</b></div>
              <div><small>估值日期</small><b>{draft.asOfDate}</b></div>
              <div><small>净资产影响</small><b>无 · 已含在账户余额</b></div>
            </div>
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => void dismiss()} disabled={busy}>拒绝草稿</button>
              <button type="button" className="primary" onClick={() => void confirm()} disabled={busy}>{busy ? "正在确认…" : "明确确认并保存"} {!busy && <Check />}</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function LocalHoldingValuationModal({
  holding,
  onCreateDraft,
  onConfirmDraft,
  onRejectDraft,
  onCommitted,
  onClose,
}) {
  const [form, setForm] = useState(() => createHoldingValuationForm(holding));
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setError("");
  };
  const createDraft = async (event) => {
    event.preventDefault();
    const issue = validateHoldingValuationForm(form);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    setError("");
    try {
      setDraft(await onCreateDraft(toHoldingValuationDraftInput(form)));
    } catch (draftError) {
      setError(presentHoldingError(draftError));
    } finally {
      setBusy(false);
    }
  };
  const dismiss = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (draft?.draftId) await onRejectDraft(draft.draftId);
      onClose();
    } catch (draftError) {
      setError(presentHoldingError(draftError));
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!draft?.draftId || busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirmDraft(draft.draftId);
      onCommitted("valuation");
      onClose();
    } catch (confirmationError) {
      setError(presentHoldingError(confirmationError));
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card local-account-modal local-holding-modal" role="dialog" aria-modal="true" aria-labelledby="holding-valuation-title">
        <header className="modal-header">
          <div><span><ChartDonut weight="duotone" /></span><div><small>{holding.accountName}</small><h2 id="holding-valuation-title">{draft ? "核对新估值快照" : `更新 ${holding.name}`}</h2></div></div>
          <button type="button" onClick={() => void dismiss()} aria-label="关闭估值弹窗"><X /></button>
        </header>
        {!draft ? (
          <form onSubmit={createDraft}>
            <div className="local-holding-boundary">
              <Clock weight="duotone" />
              <span><b>历史估值不会被覆盖</b><small>确认后追加新快照；若有真实买入或赎回，还需要单独补充对应流水。</small></span>
            </div>
            <div className="form-grid local-account-form">
              <label><span>估值日期</span><input type="date" value={form.asOfDate} onChange={update("asOfDate")} required /></label>
              <label><span>持有数量</span><input value={form.units} onChange={update("units")} inputMode="decimal" required /></label>
              <label><span>累计成本</span><div className="money-input"><b>{holding.currency}</b><input value={form.costBasis} onChange={update("costBasis")} inputMode="decimal" required /></div></label>
              <label><span>当前市值</span><div className="money-input"><b>{holding.currency}</b><input value={form.marketValue} onChange={update("marketValue")} inputMode="decimal" required /></div></label>
            </div>
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => void dismiss()} disabled={busy}>取消</button>
              <button type="submit" className="primary" disabled={busy}>{busy ? "正在生成核对稿…" : "生成核对稿"} {!busy && <ArrowRight />}</button>
            </div>
          </form>
        ) : (
          <>
            <div className="local-review-banner"><ShieldCheck weight="fill" /><span><b>确认追加估值</b><small>原估值保持不可变，新快照不会改变所属账户余额。</small></span></div>
            <div className="local-draft-review-grid">
              <div><small>产品</small><b>{draft.name}</b></div>
              <div><small>所属账户</small><b>{draft.accountName}</b></div>
              <div><small>持有数量</small><b>{formatUnitsMicros(draft.unitsMicros)}</b></div>
              <div><small>累计成本</small><b>{formatMinorAmount(draft.costBasisMinor, draft.currency)}</b></div>
              <div><small>当前市值</small><b>{formatMinorAmount(draft.marketValueMinor, draft.currency)}</b></div>
              <div><small>估值日期</small><b>{draft.asOfDate}</b></div>
            </div>
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => void dismiss()} disabled={busy}>拒绝草稿</button>
              <button type="button" className="primary" onClick={() => void confirm()} disabled={busy}>{busy ? "正在确认…" : "明确确认并追加"} {!busy && <Check />}</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function LocalHoldingOperationModal({
  holding,
  accounts,
  operations,
  onCreateDraft,
  onConfirmDraft,
  onRejectDraft,
  onCommitted,
  onCorrect,
  onClose,
}) {
  const [form, setForm] = useState(() => createHoldingOperationForm(holding, accounts));
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setError("");
  };
  const selectKind = (kind) => {
    setForm((current) => changeHoldingOperationKind(current, kind, holding));
    setError("");
  };
  const createDraft = async (event) => {
    event.preventDefault();
    const issue = validateHoldingOperationForm(form, holding, accounts);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    setError("");
    try {
      setDraft(await onCreateDraft(toHoldingOperationDraftInput(form, holding, accounts)));
    } catch (draftError) {
      setError(presentHoldingOperationError(draftError));
    } finally {
      setBusy(false);
    }
  };
  const dismiss = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (draft?.draftId) await onRejectDraft(draft.draftId);
      onClose();
    } catch (draftError) {
      setError(presentHoldingOperationError(draftError));
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!draft?.draftId || busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirmDraft(draft.draftId);
      onCommitted();
      onClose();
    } catch (confirmationError) {
      setError(presentHoldingOperationError(confirmationError));
      setBusy(false);
    }
  };
  const affectsPosition = form.operationKind === "purchase" || form.operationKind === "redeem";
  const sameCurrencyAccounts = accounts.filter((account) => (
    account.currency === holding.currency && !account.archivedAt
  ));
  const balanceEffectText = draft
    ? draft.balanceEffect === "transfer"
      ? `${draft.operationKind === "purchase" ? draft.settlementAccountName : draft.holdingAccountName} → ${draft.operationKind === "purchase" ? draft.holdingAccountName : draft.settlementAccountName}（双边转账）`
      : draft.balanceEffect === "income"
        ? `+${formatMinorAmount(draft.amountMinor, draft.currency)} → ${draft.settlementAccountName}`
        : draft.balanceEffect === "expense"
          ? `-${formatMinorAmount(draft.amountMinor, draft.currency)} ← ${draft.settlementAccountName}`
          : "无 · 仅更新账户内部持仓"
    : "";
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card local-account-modal local-holding-modal local-holding-operation-modal" role="dialog" aria-modal="true" aria-labelledby="holding-operation-title">
        <header className="modal-header">
          <div><span><Receipt weight="duotone" /></span><div><small>{holding.accountName} · {holding.currency}</small><h2 id="holding-operation-title">{draft ? "核对产品操作" : `记录 ${holding.name} 交易`}</h2></div></div>
          <button type="button" onClick={() => void dismiss()} aria-label="关闭产品操作弹窗"><X /></button>
        </header>
        {!draft ? (
          <form onSubmit={createDraft}>
            <div className="local-operation-tabs" role="tablist" aria-label="产品操作类型">
              {HOLDING_OPERATION_OPTIONS.map((option) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={form.operationKind === option.value}
                  className={form.operationKind === option.value ? "active" : ""}
                  onClick={() => selectKind(option.value)}
                  key={option.value}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="local-holding-boundary">
              <ShieldCheck weight="fill" />
              <span>
                <b>{affectsPosition ? "申购/赎回会生成新的不可变持仓快照" : "分红/费用会写入真实收支账本"}</b>
                <small>{affectsPosition ? "选择外部结算账户时，确认会同时写入金额相等、方向相反的双边转账。" : "结算账户余额只会在下一步明确确认后改变。"}</small>
              </span>
            </div>
            <div className="form-grid local-account-form">
              <label>
                <span>操作金额</span>
                <div className="money-input"><b>{holding.currency}</b><input value={form.amount} onChange={update("amount")} inputMode="decimal" placeholder="0.00" required /></div>
              </label>
              <label><span>操作日期</span><input type="date" value={form.occurredOn} onChange={update("occurredOn")} required /></label>
              <label className="wide">
                <span>结算账户</span>
                <select value={form.settlementAccountId} onChange={update("settlementAccountId")} required={!affectsPosition}>
                  {affectsPosition && <option value="">账户内部资金（不改变账户总余额）</option>}
                  {sameCurrencyAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.id === holding.accountId ? `${account.displayName}（账户内部）` : account.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wide"><span>操作说明</span><input value={form.description} onChange={update("description")} maxLength={120} required /></label>
              {affectsPosition && (
                <>
                  <label><span>操作后数量</span><input value={form.resultingUnits} onChange={update("resultingUnits")} inputMode="decimal" required /></label>
                  <label><span>操作后累计成本</span><div className="money-input"><b>{holding.currency}</b><input value={form.resultingCostBasis} onChange={update("resultingCostBasis")} inputMode="decimal" required /></div></label>
                  <label><span>操作后市值</span><div className="money-input"><b>{holding.currency}</b><input value={form.resultingMarketValue} onChange={update("resultingMarketValue")} inputMode="decimal" required /></div></label>
                  <label><span>操作后估值日期</span><input type="date" value={form.valuationDate} onChange={update("valuationDate")} required /></label>
                </>
              )}
              <label className="wide"><span>备注（可选）</span><textarea value={form.notes} onChange={update("notes")} maxLength={1000} rows={2} /></label>
            </div>
            {operations.length > 0 && (
              <div className="local-operation-history">
                <small>最近操作</small>
                {operations.slice(0, 3).map((operation) => (
                  <article key={operation.id}>
                    <span>
                      <b>{holdingOperationLabel(operation.operationKind)}{operation.isReversal ? " · 冲销记录" : operation.reversed ? " · 已冲销" : ""}</b>
                      <small>{operation.occurredOn} · {formatMinorAmount(operation.amountMinor, operation.currency)}</small>
                    </span>
                    {!operation.isReversal && !operation.reversed && (
                      <button type="button" onClick={() => onCorrect(operation)}>冲销</button>
                    )}
                  </article>
                ))}
              </div>
            )}
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => void dismiss()} disabled={busy}>取消</button>
              <button type="submit" className="primary" disabled={busy}>{busy ? "正在生成核对稿…" : "生成核对稿"} {!busy && <ArrowRight />}</button>
            </div>
          </form>
        ) : (
          <>
            <div className="local-review-banner"><ShieldCheck weight="fill" /><span><b>请核对持仓与余额边界</b><small>确认会在同一个加密事务中写入操作历史、估值快照和必要的账本流水。</small></span></div>
            <div className="local-draft-review-grid">
              <div><small>操作类型</small><b>{holdingOperationLabel(draft.operationKind)}</b></div>
              <div><small>操作金额</small><b>{formatMinorAmount(draft.amountMinor, draft.currency)}</b></div>
              <div><small>操作日期</small><b>{draft.occurredOn}</b></div>
              <div><small>余额影响</small><b>{balanceEffectText}</b></div>
              <div><small>操作前数量</small><b>{formatUnitsMicros(draft.beforeUnitsMicros)}</b></div>
              <div><small>操作后数量</small><b>{draft.afterUnitsMicros == null ? "不变" : formatUnitsMicros(draft.afterUnitsMicros)}</b></div>
              <div><small>操作前成本</small><b>{formatMinorAmount(draft.beforeCostBasisMinor, draft.currency)}</b></div>
              <div><small>操作后成本</small><b>{draft.afterCostBasisMinor == null ? "不变" : formatMinorAmount(draft.afterCostBasisMinor, draft.currency)}</b></div>
              <div><small>操作后市值</small><b>{draft.afterMarketValueMinor == null ? "不变" : formatMinorAmount(draft.afterMarketValueMinor, draft.currency)}</b></div>
              <div><small>说明</small><b>{draft.description}</b></div>
            </div>
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => void dismiss()} disabled={busy}>拒绝草稿</button>
              <button type="button" className="primary" onClick={() => void confirm()} disabled={busy}>{busy ? "正在安全写入…" : "明确确认并写入"} {!busy && <Check />}</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function LocalHoldingOperationCorrectionModal({
  operation,
  onCreateDraft,
  onConfirmDraft,
  onRejectDraft,
  onCommitted,
  onClose,
}) {
  const [form, setForm] = useState(() => createHoldingOperationCorrectionForm(operation));
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setError("");
  };
  const createDraft = async (event) => {
    event.preventDefault();
    const issue = validateHoldingOperationCorrectionForm(form, operation);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    setError("");
    try {
      setDraft(await onCreateDraft(
        toHoldingOperationCorrectionDraftInput(form, operation),
      ));
    } catch (draftError) {
      setError(presentHoldingOperationError(draftError));
    } finally {
      setBusy(false);
    }
  };
  const dismiss = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (draft?.draftId) await onRejectDraft(draft.draftId);
      onClose();
    } catch (draftError) {
      setError(presentHoldingOperationError(draftError));
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!draft?.draftId || busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirmDraft(draft.draftId);
      onCommitted();
      onClose();
    } catch (confirmationError) {
      setError(presentHoldingOperationError(confirmationError));
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card local-account-modal local-holding-modal local-holding-correction-modal" role="dialog" aria-modal="true" aria-labelledby="holding-correction-title">
        <header className="modal-header">
          <div><span><Archive weight="duotone" /></span><div><small>{operation.holdingName} · 原操作永久保留</small><h2 id="holding-correction-title">{draft ? "核对补偿式冲销" : `冲销${holdingOperationLabel(operation.operationKind)}`}</h2></div></div>
          <button type="button" onClick={() => void dismiss()} aria-label="关闭产品操作冲销弹窗"><X /></button>
        </header>
        {!draft ? (
          <form onSubmit={createDraft}>
            <div className="local-confirm-warning">
              <ShieldCheck weight="duotone" />
              <span><b>不会修改或删除原操作</b><small>确认后追加方向相反的产品操作、估值快照和必要的账本冲销事件，完整保留审计链。</small></span>
            </div>
            <div className="local-correction-original">
              <span><Receipt weight="duotone" /></span>
              <div><small>{operation.occurredOn} · {operation.holdingAccountName}</small><b>{holdingOperationLabel(operation.operationKind)} · {formatMinorAmount(operation.amountMinor, operation.currency)}</b><p>{operation.description}</p></div>
            </div>
            <div className="form-grid local-account-form">
              <label><span>冲销日期</span><input type="date" value={form.occurredOn} onChange={update("occurredOn")} required /></label>
              <label className="wide"><span>冲销原因</span><textarea value={form.reason} onChange={update("reason")} maxLength={240} rows={3} placeholder="例如：重复录入、金额填写错误" required /></label>
            </div>
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => void dismiss()} disabled={busy}>取消</button>
              <button type="submit" className="danger-button" disabled={busy}>{busy ? "正在生成冲销草稿…" : "生成冲销核对稿"} {!busy && <ArrowRight />}</button>
            </div>
          </form>
        ) : (
          <>
            <div className="local-review-banner"><ShieldCheck weight="fill" /><span><b>最后核对补偿记录</b><small>原操作仍可追溯；只有明确确认后，以下反向记录才会原子写入。</small></span></div>
            <div className="local-draft-review-grid">
              <div><small>原操作</small><b>{holdingOperationLabel(draft.originalOperationKind)}</b></div>
              <div><small>补偿操作</small><b>{holdingOperationLabel(draft.compensatingOperationKind)}</b></div>
              <div><small>冲销金额</small><b>{formatMinorAmount(draft.amountMinor, draft.currency)}</b></div>
              <div><small>账本冲销事件</small><b>{draft.ledgerEventCount} 条</b></div>
              <div><small>恢复后数量</small><b>{draft.restoredUnitsMicros == null ? "持仓不变" : formatUnitsMicros(draft.restoredUnitsMicros)}</b></div>
              <div><small>恢复后成本</small><b>{draft.restoredCostBasisMinor == null ? "持仓不变" : formatMinorAmount(draft.restoredCostBasisMinor, draft.currency)}</b></div>
              <div><small>恢复后市值</small><b>{draft.restoredMarketValueMinor == null ? "持仓不变" : formatMinorAmount(draft.restoredMarketValueMinor, draft.currency)}</b></div>
              <div><small>冲销原因</small><b>{draft.reason}</b></div>
            </div>
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => void dismiss()} disabled={busy}>拒绝草稿</button>
              <button type="button" className="danger-button" onClick={() => void confirm()} disabled={busy}>{busy ? "正在安全冲销…" : "明确确认并追加冲销"} {!busy && <Archive />}</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function LocalHoldingManagerModal({
  holding,
  onUpdateDraft,
  onArchiveDraft,
  onConfirmDraft,
  onRejectDraft,
  onCommitted,
  onClose,
}) {
  const [mode, setMode] = useState("menu");
  const [form, setForm] = useState(() => createHoldingProfileForm(holding));
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setError("");
  };
  const discardDraft = useCallback(async () => {
    if (!draft?.draftId) return;
    try {
      await onRejectDraft(draft.draftId);
    } catch {
      // Unconfirmed holding drafts never change the encrypted record.
    }
  }, [draft?.draftId, onRejectDraft]);
  const dismiss = useCallback(async () => {
    if (busy) return;
    await discardDraft();
    onClose();
  }, [busy, discardDraft, onClose]);
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") void dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismiss]);
  const reviewUpdate = async (event) => {
    event.preventDefault();
    const issue = validateHoldingProfileForm(form);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    setError("");
    try {
      setDraft(await onUpdateDraft(toHoldingUpdateDraftInput(form)));
    } catch (draftError) {
      setError(presentHoldingError(draftError));
    } finally {
      setBusy(false);
    }
  };
  const reviewArchive = async () => {
    setBusy(true);
    setError("");
    try {
      setDraft(await onArchiveDraft(toHoldingArchiveDraftInput(holding.id)));
    } catch (draftError) {
      setError(presentHoldingError(draftError));
    } finally {
      setBusy(false);
    }
  };
  const backFromReview = async () => {
    const action = draft?.action;
    setBusy(true);
    await discardDraft();
    setDraft(null);
    setMode(action === "update" ? "edit" : "menu");
    setBusy(false);
  };
  const confirm = async () => {
    if (!draft?.draftId || busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirmDraft(draft.draftId);
      onCommitted(draft.action);
      onClose();
    } catch (confirmationError) {
      setError(presentHoldingError(confirmationError));
      setBusy(false);
    }
  };
  const title = draft
    ? draft.action === "archive" ? "确认归档持仓" : "核对持仓资料"
    : mode === "edit" ? "编辑持仓资料" : "管理持仓";
  return (
    <div className="modal-backdrop local-account-backdrop" role="presentation">
      <section className="action-modal local-account-modal local-account-manager local-holding-manager" role="dialog" aria-modal="true" aria-labelledby="local-holding-manager-title">
        <button type="button" className="modal-close" onClick={() => void dismiss()} aria-label="关闭持仓管理"><X /></button>
        <div className="action-modal-head">
          <span>{draft?.action === "archive" ? <Archive weight="duotone" /> : <Coins weight="duotone" />}</span>
          <div>
            <small>{draft ? "核对后才会生效" : holding.accountName}</small>
            <h2 id="local-holding-manager-title">{title}</h2>
            <p>资料修改和归档都不会改变所属账户余额；全部历史估值继续保留。</p>
          </div>
        </div>

        {!draft && mode === "menu" && (
          <div className="local-manage-menu">
            <div className="local-manage-account">
              <span><Coins weight="duotone" /></span>
              <div><small>{holdingTypeLabel(holding.productType)}</small><h3>{holding.name}</h3><p>估值日 {holding.asOfDate} · {holding.valuationCount} 个快照</p></div>
              <strong>{formatMinorAmount(holding.marketValueMinor, holding.currency)}</strong>
            </div>
            <button type="button" className="local-manage-choice" onClick={() => setMode("edit")}>
              <PencilSimple weight="duotone" />
              <span><b>编辑产品资料</b><small>修改名称、类型、脱敏尾号或备注；估值和账户不变。</small></span>
              <ArrowRight />
            </button>
            <button type="button" className="local-manage-choice danger" onClick={() => void reviewArchive()} disabled={busy}>
              <Archive weight="duotone" />
              <span><b>归档持仓</b><small>从有效持仓和市值拆解中移除，估值历史仍可筛选查看。</small></span>
              <ArrowRight />
            </button>
            {error && <VaultError message={error} />}
            <div className="modal-actions"><button type="button" className="secondary" onClick={() => void dismiss()} disabled={busy}>完成</button></div>
          </div>
        )}

        {!draft && mode === "edit" && (
          <form onSubmit={reviewUpdate}>
            <div className="form-grid local-account-form local-account-edit-form">
              <label className="full"><span>产品名称</span><input value={form.name} onChange={update("name")} maxLength={120} required /></label>
              <label><span>产品类型</span><select value={form.productType} onChange={update("productType")}>{HOLDING_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label><span>产品尾号（可选）</span><input value={form.maskedIdentifier} onChange={update("maskedIdentifier")} maxLength={16} autoComplete="off" /></label>
              <label className="full"><span>所属账户与币种</span><div className="local-locked-field"><LockKey /><b>{holding.accountName} · {holding.currency}</b><small>历史估值已绑定，不可直接迁移</small></div></label>
              <label className="full"><span>备注（可选）</span><textarea value={form.notes} onChange={update("notes")} rows="3" maxLength={1000} /></label>
            </div>
            {error && <VaultError message={error} />}
            <div className="local-account-guardrail"><ShieldCheck weight="fill" /><span><b>估值与账户余额不会改变</b><small>下一步只生成产品资料核对草稿</small></span></div>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => { setMode("menu"); setError(""); }} disabled={busy}><ArrowLeft /> 返回</button>
              <button type="submit" className="primary" disabled={busy}>{busy ? "正在生成草稿…" : "核对修改内容"} {!busy && <ArrowRight />}</button>
            </div>
          </form>
        )}

        {draft?.action === "update" && (
          <div className="local-account-review local-account-update-review">
            <div className="local-update-summary">
              <span><PencilSimple weight="duotone" /></span>
              <div><small>持仓资料修改</small><strong>{draft.name}</strong><p>{draft.accountName} · {holdingTypeLabel(draft.productType)}</p></div>
              <i>估值不变</i>
            </div>
            <dl>
              <div><dt>产品名称</dt><dd>{formatReviewedChange(draft.before?.name, draft.name)}</dd></div>
              <div><dt>产品类型</dt><dd>{formatReviewedChange(holdingTypeLabel(draft.before?.productType), holdingTypeLabel(draft.productType))}</dd></div>
              <div><dt>产品尾号</dt><dd>{formatReviewedChange(draft.before?.maskedIdentifier, draft.maskedIdentifier)}</dd></div>
              <div className="full"><dt>备注</dt><dd>{draft.notes || "未填写"}</dd></div>
            </dl>
            <div className="local-confirm-warning"><ShieldCheck weight="duotone" /><span><b>只更新产品主数据</b><small>历史估值、持有数量、累计成本、市值和所属账户均保持不变。</small></span></div>
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => void backFromReview()} disabled={busy}><ArrowLeft /> 返回修改</button>
              <button type="button" className="primary" onClick={() => void confirm()} disabled={busy}>{busy ? "正在安全更新…" : "确认更新资料"} {!busy && <Check weight="bold" />}</button>
            </div>
          </div>
        )}

        {draft?.action === "archive" && (
          <div className="local-account-review local-account-archive-review">
            <div className="local-review-amount">
              <span>归档前最新市值</span>
              <strong>{formatMinorAmount(draft.marketValueMinor, draft.currency)}</strong>
              <small>{draft.accountName} · {draft.name} · {draft.asOfDate}</small>
            </div>
            <div className="local-archive-consequences">
              <div><Check weight="bold" /><span><b>从有效持仓拆解中移除</b><small>归档后不会出现在默认有效持仓筛选中。</small></span></div>
              <div><Clock weight="duotone" /><span><b>保留全部估值历史</b><small>产品与所有不可变估值快照都不会删除。</small></span></div>
              <div><LockKey weight="duotone" /><span><b>确认时再次检查版本</b><small>若资料或最新估值发生变化，原生事务会拒绝归档。</small></span></div>
            </div>
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => void backFromReview()} disabled={busy}><ArrowLeft /> 返回</button>
              <button type="button" className="danger-button" onClick={() => void confirm()} disabled={busy}>{busy ? "正在安全归档…" : "确认归档持仓"} {!busy && <Archive />}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function LocalAccountModal({
  baseCurrency,
  onCreateDraft,
  onConfirmDraft,
  onRejectDraft,
  onCommitted,
  onClose,
}) {
  const [form, setForm] = useState(() => ({
    ...createEmptyAccountForm(),
    currency: ["CNY", "USD", "HKD"].includes(baseCurrency) ? baseCurrency : "CNY",
  }));
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setError("");
  };

  const discardDraft = useCallback(async () => {
    if (!draft?.draftId) return;
    try {
      await onRejectDraft(draft.draftId);
    } catch {
      // The draft remains isolated from the ledger even if cleanup is interrupted.
    }
  }, [draft?.draftId, onRejectDraft]);

  const dismiss = useCallback(async () => {
    if (busy) return;
    await discardDraft();
    onClose();
  }, [busy, discardDraft, onClose]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") void dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismiss]);

  const review = async (event) => {
    event.preventDefault();
    const issue = validateAccountForm(form);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const nextDraft = await onCreateDraft(toAccountDraftInput(form));
      setDraft(nextDraft);
    } catch (draftError) {
      setError(presentAccountError(draftError));
    } finally {
      setBusy(false);
    }
  };

  const backToEdit = async () => {
    setBusy(true);
    await discardDraft();
    setDraft(null);
    setBusy(false);
  };

  const confirm = async () => {
    if (!draft?.draftId) return;
    setBusy(true);
    setError("");
    try {
      await onConfirmDraft(draft.draftId);
      setDraft(null);
      onCommitted("create");
      onClose();
    } catch (confirmationError) {
      setError(presentAccountError(confirmationError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop local-account-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) void dismiss();
      }}
    >
      <section
        className="action-modal local-account-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-account-title"
      >
        <button type="button" className="modal-close" onClick={() => void dismiss()} aria-label="关闭添加账户">
          <X />
        </button>
        <div className="action-modal-head">
          <span>{draft ? <Check weight="bold" /> : <Wallet weight="duotone" />}</span>
          <div>
            <small>{draft ? "第 2 步 · 核对确认" : "第 1 步 · 填写账户"}</small>
            <h2 id="local-account-title">{draft ? "确认账户信息" : "添加账户"}</h2>
            <p>{draft ? "请逐项核对。确认后账户和期初余额将以追加事件写入加密账本。" : "先填写基础信息；此步骤不会改变任何正式余额。"}</p>
          </div>
        </div>

        <div className="local-account-steps" aria-label="添加账户进度">
          <span className="active"><i>1</i>填写</span>
          <b />
          <span className={draft ? "active" : ""}><i>2</i>核对并确认</span>
        </div>

        {!draft ? (
          <form onSubmit={review}>
            <div className="form-grid local-account-form">
              <label>
                <span>机构名称</span>
                <input value={form.institutionName} onChange={update("institutionName")} placeholder="例如：招商银行" maxLength={80} required />
              </label>
              <label>
                <span>账户名称</span>
                <input value={form.displayName} onChange={update("displayName")} placeholder="例如：日常收支" maxLength={80} required />
              </label>
              <label>
                <span>账户类型</span>
                <select value={form.accountType} onChange={update("accountType")}>
                  {ACCOUNT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label>
                <span>币种</span>
                <select value={form.currency} onChange={update("currency")}>
                  <option value="CNY">人民币 · CNY</option>
                  <option value="USD">美元 · USD</option>
                  <option value="HKD">港币 · HKD</option>
                </select>
              </label>
              <label>
                <span>账户尾号（可选）</span>
                <input value={form.maskedIdentifier} onChange={update("maskedIdentifier")} placeholder="例如：3619" maxLength={8} autoComplete="off" />
              </label>
              <label>
                <span>余额日期</span>
                <input type="date" value={form.balanceDate} onChange={update("balanceDate")} required />
              </label>
              <label className="full">
                <span>期初余额</span>
                <div className="money-input">
                  <b>{form.currency}</b>
                  <input value={form.openingBalance} onChange={update("openingBalance")} inputMode="decimal" placeholder="0.00" required />
                </div>
              </label>
              <label className="full">
                <span>备注（可选）</span>
                <textarea value={form.notes} onChange={update("notes")} rows="2" maxLength={1000} placeholder="记录账户用途或对账线索；内容只保存在本机。" />
              </label>
            </div>
            {error && <VaultError message={error} />}
            <div className="local-account-guardrail"><ShieldCheck weight="fill" /><span><b>尚未写入真实账本</b><small>下一步只生成待核对草稿</small></span></div>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => void dismiss()} disabled={busy}>取消</button>
              <button type="submit" className="primary" disabled={busy}>{busy ? "正在生成草稿…" : "核对账户信息"} {!busy && <ArrowRight />}</button>
            </div>
          </form>
        ) : (
          <div className="local-account-review">
            <div className="local-review-amount">
              <span>确认写入的期初余额</span>
              <strong>{formatMinorAmount(draft.openingBalanceMinor, draft.currency)}</strong>
              <small>余额日期 · {draft.balanceDate}</small>
            </div>
            <dl>
              <div><dt>机构</dt><dd>{draft.institutionName}</dd></div>
              <div><dt>账户名称</dt><dd>{draft.displayName}</dd></div>
              <div><dt>账户类型</dt><dd>{accountTypeLabel(draft.accountType)}</dd></div>
              <div><dt>币种</dt><dd>{draft.currency}</dd></div>
              <div><dt>账户尾号</dt><dd>{draft.maskedIdentifier || "未填写"}</dd></div>
              <div><dt>备注</dt><dd>{draft.notes || "未填写"}</dd></div>
            </dl>
            <div className="local-confirm-warning">
              <CalendarCheck weight="duotone" />
              <span><b>确认后将追加两类记录</b><small>账户主数据 + 一笔不可原地修改的期初余额事件，并记录本地审计日志。</small></span>
            </div>
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={backToEdit} disabled={busy}><ArrowLeft /> 返回修改</button>
              <button type="button" className="primary" onClick={confirm} disabled={busy}>{busy ? "正在安全写入…" : "确认并写入账本"} {!busy && <Check weight="bold" />}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function LocalAccountManagerModal({
  account,
  onUpdateDraft,
  onArchiveDraft,
  onConfirmDraft,
  onRejectDraft,
  onCommitted,
  onClose,
}) {
  const [mode, setMode] = useState("menu");
  const [form, setForm] = useState(() => createAccountProfileForm(account));
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const balanceMinor = Number(account.balanceMinor ?? 0);
  const activeHoldingCount = Number(account.activeHoldingCount ?? 0);
  const canArchive = balanceMinor === 0 && activeHoldingCount === 0;

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setError("");
  };

  const discardDraft = useCallback(async () => {
    if (!draft?.draftId) return;
    try {
      await onRejectDraft(draft.draftId);
    } catch {
      // An unconfirmed draft never mutates account state.
    }
  }, [draft?.draftId, onRejectDraft]);

  const dismiss = useCallback(async () => {
    if (busy) return;
    await discardDraft();
    onClose();
  }, [busy, discardDraft, onClose]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") void dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismiss]);

  const reviewUpdate = async (event) => {
    event.preventDefault();
    const issue = validateAccountProfileForm(form);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const nextDraft = await onUpdateDraft(
        toAccountUpdateDraftInput(account.id, form),
      );
      setDraft(nextDraft);
    } catch (draftError) {
      setError(presentAccountError(draftError));
    } finally {
      setBusy(false);
    }
  };

  const reviewArchive = async () => {
    if (!canArchive) return;
    setBusy(true);
    setError("");
    try {
      const nextDraft = await onArchiveDraft(account.id);
      setDraft(nextDraft);
    } catch (draftError) {
      setError(presentAccountError(draftError));
    } finally {
      setBusy(false);
    }
  };

  const backFromReview = async () => {
    const action = draft?.action;
    setBusy(true);
    await discardDraft();
    setDraft(null);
    setMode(action === "update" ? "edit" : "menu");
    setBusy(false);
  };

  const confirm = async () => {
    if (!draft?.draftId) return;
    setBusy(true);
    setError("");
    try {
      await onConfirmDraft(draft.draftId);
      const action = draft.action;
      setDraft(null);
      onCommitted(action);
      onClose();
    } catch (confirmationError) {
      setError(presentAccountError(confirmationError));
    } finally {
      setBusy(false);
    }
  };

  const title = draft
    ? draft.action === "archive" ? "确认归档账户" : "确认账户修改"
    : mode === "edit" ? "编辑账户信息" : "管理账户";

  return (
    <div
      className="modal-backdrop local-account-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) void dismiss();
      }}
    >
      <section
        className="action-modal local-account-modal local-account-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-account-manager-title"
      >
        <button
          type="button"
          className="modal-close"
          onClick={() => void dismiss()}
          aria-label="关闭账户管理"
        >
          <X />
        </button>
        <div className="action-modal-head">
          <span>
            {draft?.action === "archive"
              ? <Archive weight="duotone" />
              : <PencilSimple weight="duotone" />}
          </span>
          <div>
            <small>{draft ? "核对后才会生效" : "账户生命周期管理"}</small>
            <h2 id="local-account-manager-title">{title}</h2>
            <p>
              {draft
                ? "请逐项核对；只有明确确认后，原生加密账户记录才会改变。"
                : "编辑不会改变余额；归档只允许余额已经结清的账户。"}
            </p>
          </div>
        </div>

        {!draft && mode === "menu" && (
          <div className="local-manage-menu">
            <div className="local-manage-account">
              <span><Wallet weight="duotone" /></span>
              <div>
                <small>{account.institutionName}</small>
                <h3>{account.displayName}</h3>
                <p>{accountTypeLabel(account.accountType)}{account.maskedIdentifier ? ` · 尾号 ${account.maskedIdentifier}` : ""}</p>
              </div>
              <strong>{formatMinorAmount(balanceMinor, account.currency)}</strong>
            </div>
            <button type="button" className="local-manage-choice" onClick={() => setMode("edit")}>
              <PencilSimple weight="duotone" />
              <span><b>编辑账户信息</b><small>修改机构、名称、类型、尾号或备注；币种与余额不变。</small></span>
              <ArrowRight />
            </button>
            <button
              type="button"
              className="local-manage-choice danger"
              onClick={reviewArchive}
              disabled={!canArchive || busy}
            >
              <Archive weight="duotone" />
              <span>
                <b>归档账户</b>
                <small>
                  {canArchive
                    ? "从活跃账户中隐藏，历史流水和审计记录继续保留。"
                    : balanceMinor !== 0
                      ? "当前余额不为 0，请先转出或结清余额。"
                      : `仍有 ${activeHoldingCount} 项有效持仓，请先归档这些持仓。`}
                </small>
              </span>
              {canArchive && <ArrowRight />}
            </button>
            {!canArchive && (
              <div className="local-archive-blocked">
                <ShieldCheck weight="fill" />
                <span><b>安全规则已阻止归档</b><small>{balanceMinor !== 0 ? "这样可以避免账户消失后导致资产汇总少计。" : "先处理账户内持仓，避免留下挂在已归档账户下的有效产品。"}</small></span>
              </div>
            )}
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => void dismiss()} disabled={busy}>完成</button>
            </div>
          </div>
        )}

        {!draft && mode === "edit" && (
          <form onSubmit={reviewUpdate}>
            <div className="form-grid local-account-form local-account-edit-form">
              <label>
                <span>机构名称</span>
                <input value={form.institutionName} onChange={update("institutionName")} maxLength={80} required />
              </label>
              <label>
                <span>账户名称</span>
                <input value={form.displayName} onChange={update("displayName")} maxLength={80} required />
              </label>
              <label>
                <span>账户类型</span>
                <select value={form.accountType} onChange={update("accountType")}>
                  {ACCOUNT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label>
                <span>账户尾号（可选）</span>
                <input value={form.maskedIdentifier} onChange={update("maskedIdentifier")} maxLength={8} autoComplete="off" />
              </label>
              <label className="full">
                <span>币种</span>
                <div className="local-locked-field"><LockKey /><b>{form.currency}</b><small>已有账本事件，币种不可直接修改</small></div>
              </label>
              <label className="full">
                <span>备注（可选）</span>
                <textarea value={form.notes} onChange={update("notes")} rows="2" maxLength={1000} />
              </label>
            </div>
            {error && <VaultError message={error} />}
            <div className="local-account-guardrail">
              <ShieldCheck weight="fill" />
              <span><b>余额与历史流水不会改变</b><small>下一步只生成账户资料核对草稿</small></span>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => { setMode("menu"); setError(""); }} disabled={busy}><ArrowLeft /> 返回</button>
              <button type="submit" className="primary" disabled={busy}>{busy ? "正在生成草稿…" : "核对修改内容"} {!busy && <ArrowRight />}</button>
            </div>
          </form>
        )}

        {draft && draft.action === "update" && (
          <div className="local-account-review local-account-update-review">
            <div className="local-update-summary">
              <span><PencilSimple weight="duotone" /></span>
              <div><small>账户资料修改</small><strong>{draft.displayName}</strong><p>{draft.institutionName} · {accountTypeLabel(draft.accountType)}</p></div>
              <i>余额不变</i>
            </div>
            <dl>
              <div><dt>账户名称</dt><dd>{formatReviewedChange(account.displayName, draft.displayName)}</dd></div>
              <div><dt>机构</dt><dd>{formatReviewedChange(account.institutionName, draft.institutionName)}</dd></div>
              <div><dt>账户类型</dt><dd>{formatReviewedChange(accountTypeLabel(account.accountType), accountTypeLabel(draft.accountType))}</dd></div>
              <div><dt>账户尾号</dt><dd>{formatReviewedChange(account.maskedIdentifier, draft.maskedIdentifier)}</dd></div>
              <div className="full"><dt>备注</dt><dd>{draft.notes || "未填写"}</dd></div>
            </dl>
            <div className="local-confirm-warning">
              <ShieldCheck weight="duotone" />
              <span><b>只更新账户主数据</b><small>已有账本事件、余额、币种和审计历史均保持不变。</small></span>
            </div>
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={backFromReview} disabled={busy}><ArrowLeft /> 返回修改</button>
              <button type="button" className="primary" onClick={confirm} disabled={busy}>{busy ? "正在安全更新…" : "确认更新账户"} {!busy && <Check weight="bold" />}</button>
            </div>
          </div>
        )}

        {draft && draft.action === "archive" && (
          <div className="local-account-review local-account-archive-review">
            <div className="local-review-amount">
              <span>归档前已确认余额</span>
              <strong>{formatMinorAmount(draft.openingBalanceMinor ?? 0, draft.currency)}</strong>
              <small>{draft.institutionName} · {draft.displayName}</small>
            </div>
            <div className="local-archive-consequences">
              <div><Check weight="bold" /><span><b>从活跃资产页隐藏</b><small>不再参与当前账户数量和资产汇总。</small></span></div>
              <div><Vault weight="duotone" /><span><b>保留历史记录</b><small>账户、零余额账本事件和审计日志不会删除。</small></span></div>
              <div><LockKey weight="duotone" /><span><b>确认时再次检查余额</b><small>若余额发生变化，原生事务会拒绝归档。</small></span></div>
            </div>
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={backFromReview} disabled={busy}><ArrowLeft /> 返回</button>
              <button type="button" className="danger-button" onClick={confirm} disabled={busy}>{busy ? "正在安全归档…" : "确认归档账户"} {!busy && <Archive />}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function LocalCashflow({
  accounts,
  transactions,
  dailyChanges = { transactions: {} },
  baseCurrency,
  onNavigate,
  onCreateDraft,
  onConfirmDraft,
  onRejectDraft,
  onCreateCorrectionDraft,
  onConfirmCorrectionDraft,
  onRejectCorrectionDraft,
  importHistory,
  onInspectImport,
  onCreateImportDraft,
  onConfirmImportDraft,
  onRejectImportDraft,
  onCommitted,
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const baseTransactions = transactions.filter((item) => (
    item.currency === baseCurrency && !item.reversed
  ));
  const now = new Date();
  const currentMonthTransactions = baseTransactions.filter((item) => {
    const date = new Date(item.occurredAt ?? item.createdAt);
    return !Number.isNaN(date.getTime())
      && date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth();
  });
  const incomeMinor = currentMonthTransactions
    .filter((item) => item.kind === "income")
    .reduce((sum, item) => sum + Number(item.amountMinor ?? 0), 0);
  const expenseMinor = currentMonthTransactions
    .filter((item) => item.kind === "expense")
    .reduce((sum, item) => sum + Number(item.amountMinor ?? 0), 0);
  const netMinor = incomeMinor - expenseMinor;
  const cashflowSeries = localMonthlyCashflowSeries(transactions, baseCurrency, now);
  const displayTransactions = transactions;

  return (
    <>
      <div className="subpage local-cashflow-v2">
        <section className="metrics-row three">
          <LocalOverviewMetric
            icon={ArrowDown}
            label="本月收入"
            value={formatMinorAmount(incomeMinor, baseCurrency)}
            hint={`${currentMonthTransactions.filter((item) => item.kind === "income").length} 笔已确认`}
            variant="lime"
          />
          <LocalOverviewMetric
            icon={ArrowUp}
            label="本月支出"
            value={formatMinorAmount(expenseMinor, baseCurrency)}
            hint={`${currentMonthTransactions.filter((item) => item.kind === "expense").length} 笔已确认`}
          />
          <LocalOverviewMetric
            icon={Coins}
            label="净现金流"
            value={formatTransactionAmount(netMinor >= 0 ? "income" : "expense", Math.abs(netMinor), baseCurrency)}
            hint="已排除冲销与外币"
          />
        </section>


        <section className="panel local-cashflow-chart-card">
          <header className="panel-head">
            <div><h2>收支变化</h2><p>收入、支出与结余趋势</p></div>
            <span className="local-preview-badge">近 6 个月</span>
          </header>
          <div className="local-cashflow-chart" aria-label="近六个月收支变化图">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cashflowSeries} margin={{ top: 18, right: 16, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e4e4e8" strokeDasharray="3 5" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#898b93", fontSize: 10 }} />
                <YAxis axisLine={false} tickLine={false} tickFormatter={localCompactMoney} tick={{ fill: "#898b93", fontSize: 10 }} />
                <Tooltip formatter={(value, name) => [formatMinorAmount(Number(value), baseCurrency), name === "incomeMinor" ? "收入" : "支出"]} />
                <Line type="monotone" dataKey="incomeMinor" stroke={LOCAL_CHART_COLORS.purple} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="expenseMinor" stroke={LOCAL_CHART_COLORS.ink} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="local-chart-legend"><span className="income">收入</span><span className="expense">支出</span></div>
        </section>

        <section className="panel transactions-panel local-v2-cashflow-panel">
          <header className="panel-head">
            <div>
              <h2>全部流水</h2>
              <span>追加式加密账本 · 写入前均需核对</span>
            </div>
          <div className="local-cashflow-actions">
            <button className="secondary" onClick={() => setImportModalOpen(true)} disabled={accounts.length === 0}><UploadSimple /> 导入流水</button>
            <button onClick={() => setModalOpen(true)} disabled={accounts.length === 0}><Plus /> 记一笔</button>
          </div>
        </header>

        {accounts.length === 0 ? (
          <div className="local-cashflow-empty">
            <div><Wallet weight="duotone" /></div>
            <span>开始记账前</span>
            <h3>请先添加一个账户</h3>
            <p>流水必须关联到加密账户；账户创建同样需要核对确认。</p>
            <button onClick={() => onNavigate("assets")}><Plus /> 前往添加账户</button>
          </div>
        ) : displayTransactions.length === 0 ? (
          <div className="local-cashflow-empty">
            <div><Receipt weight="duotone" /></div>
            <span>真实流水从这里开始</span>
            <h3>还没有正式流水</h3>
            <p>记录第一笔收入、支出或账户间转账；确认前不会影响任何余额。</p>
            <button onClick={() => setModalOpen(true)}><Plus /> 记一笔</button>
          </div>
        ) : (
          <div className="local-transaction-list">
            <header>
              <span>已确认流水</span>
              <small>
                {displayTransactions.filter((item) => !item.reversed).length} 笔有效
                {displayTransactions.some((item) => item.reversed) ? ` · ${displayTransactions.filter((item) => item.reversed).length} 笔已冲销` : ""}
              </small>
            </header>
            {displayTransactions.map((transaction) => {
              const Icon = transaction.kind === "income"
                ? ArrowDown
                : transaction.kind === "expense" ? ArrowUp : ArrowsLeftRight;
              const changeStatus = dailyChanges.transactions?.[transaction.id];
              return (
                <article key={transaction.id} className={`${transaction.reversed ? "reversed" : ""} ${changeStatus ? "is-daily-change" : ""}`.trim()}>
                  <span className={transaction.kind}><Icon weight="bold" /></span>
                  <div>
                    <small>
                      {transactionKindLabel(transaction.kind)} · {transaction.category || "未分类"}
                      {transaction.reversed ? " · 已冲销" : transaction.revisesTransactionId ? " · 修订后" : ""}
                    </small>
                    <h3>{transaction.description || transactionKindLabel(transaction.kind)}</h3>
                    <DailyChangeBadge status={changeStatus} />
                    <p>
                      {transaction.accountName}
                      {transaction.kind === "transfer" ? ` → ${transaction.destinationAccountName}` : ""}
                      {" · "}
                      {transaction.occurredAt?.slice(0, 10)}
                    </p>
                  </div>
                  <strong className={transaction.kind}>
                    {formatTransactionAmount(transaction.kind, transaction.amountMinor, transaction.currency)}
                  </strong>
                  {!transaction.reversed && (
                    <button
                      className="local-transaction-manage"
                      aria-label={`管理流水 ${transaction.description || transactionKindLabel(transaction.kind)}`}
                      onClick={() => setSelectedTransaction(transaction)}
                    >
                      <DotsThree weight="bold" />
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {importHistory.length > 0 && (
          <div className="local-import-history">
            <header><span>最近导入</span><small>来源指纹已记录</small></header>
            {importHistory.slice(0, 3).map((batch) => (
              <article key={batch.id}>
                <span><FileText weight="duotone" /></span>
                <div>
                  <b>{batch.sourceName}</b>
                  <small>{batch.sourceType.toUpperCase()} · {batch.rowCount - batch.errorCount} 笔有效 · {batch.errorCount} 条错误</small>
                </div>
                <i className={batch.status}>{batch.status === "confirmed" ? "已确认" : batch.status === "rejected" ? "已取消" : "待核对"}</i>
              </article>
            ))}
          </div>
        )}
        </section>
      </div>

      {modalOpen && (
        <LocalTransactionModal
          accounts={accounts}
          onCreateDraft={onCreateDraft}
          onConfirmDraft={onConfirmDraft}
          onRejectDraft={onRejectDraft}
          onCommitted={() => onCommitted("create")}
          onClose={() => setModalOpen(false)}
        />
      )}
      {selectedTransaction && (
        <LocalTransactionCorrectionModal
          transaction={selectedTransaction}
          accounts={accounts}
          onCreateDraft={onCreateCorrectionDraft}
          onConfirmDraft={onConfirmCorrectionDraft}
          onRejectDraft={onRejectCorrectionDraft}
          onCommitted={onCommitted}
          onClose={() => setSelectedTransaction(null)}
        />
      )}
      {importModalOpen && (
        <LocalTransactionImportModal
          accounts={accounts}
          onInspect={onInspectImport}
          onCreateDraft={onCreateImportDraft}
          onConfirmDraft={onConfirmImportDraft}
          onRejectDraft={onRejectImportDraft}
          onCommitted={() => onCommitted("import")}
          onClose={() => setImportModalOpen(false)}
        />
      )}
    </>
  );
}

function LocalTransactionModal({
  accounts,
  onCreateDraft,
  onConfirmDraft,
  onRejectDraft,
  onCommitted,
  onClose,
}) {
  const [form, setForm] = useState(() => createEmptyTransactionForm(accounts));
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selectedAccount = accounts.find((item) => item.id === form.accountId) ?? accounts[0];
  const availableDestinations = accounts.filter((item) => (
    item.id !== form.accountId && item.currency === selectedAccount?.currency
  ));

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setError("");
  };

  const chooseKind = (transactionKind) => {
    setForm((current) => ({
      ...current,
      transactionKind,
      category: TRANSACTION_CATEGORIES[transactionKind][0],
      destinationAccountId: transactionKind === "transfer"
        ? accounts.find((item) => (
            item.id !== current.accountId
            && item.currency === accounts.find((account) => account.id === current.accountId)?.currency
          ))?.id ?? ""
        : "",
    }));
    setError("");
  };

  const chooseAccount = (event) => {
    const accountId = event.target.value;
    const account = accounts.find((item) => item.id === accountId);
    setForm((current) => ({
      ...current,
      accountId,
      destinationAccountId: current.transactionKind === "transfer"
        ? accounts.find((item) => item.id !== accountId && item.currency === account?.currency)?.id ?? ""
        : "",
    }));
    setError("");
  };

  const discardDraft = useCallback(async () => {
    if (!draft?.draftId) return;
    try {
      await onRejectDraft(draft.draftId);
    } catch {
      // Unconfirmed transaction drafts do not affect the ledger.
    }
  }, [draft?.draftId, onRejectDraft]);

  const dismiss = useCallback(async () => {
    if (busy) return;
    await discardDraft();
    onClose();
  }, [busy, discardDraft, onClose]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") void dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismiss]);

  const review = async (event) => {
    event.preventDefault();
    const issue = validateTransactionForm(form, accounts);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    setError("");
    try {
      setDraft(await onCreateDraft(toTransactionDraftInput(form, accounts)));
    } catch (draftError) {
      setError(presentTransactionError(draftError));
    } finally {
      setBusy(false);
    }
  };

  const backToEdit = async () => {
    setBusy(true);
    await discardDraft();
    setDraft(null);
    setBusy(false);
  };

  const confirm = async () => {
    if (!draft?.draftId) return;
    setBusy(true);
    setError("");
    try {
      await onConfirmDraft(draft.draftId);
      setDraft(null);
      onCommitted();
      onClose();
    } catch (confirmationError) {
      setError(presentTransactionError(confirmationError));
    } finally {
      setBusy(false);
    }
  };

  const DraftIcon = draft?.transactionKind === "income"
    ? ArrowDown
    : draft?.transactionKind === "expense" ? ArrowUp : ArrowsLeftRight;

  return (
    <div
      className="modal-backdrop local-transaction-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) void dismiss();
      }}
    >
      <section
        className="action-modal local-account-modal local-transaction-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-transaction-title"
      >
        <button type="button" className="modal-close" onClick={() => void dismiss()} aria-label="关闭流水录入"><X /></button>
        <div className="action-modal-head">
          <span>{draft ? <DraftIcon weight="bold" /> : <Receipt weight="duotone" />}</span>
          <div>
            <small>{draft ? "第 2 步 · 核对确认" : "第 1 步 · 填写流水"}</small>
            <h2 id="local-transaction-title">{draft ? `确认${transactionKindLabel(draft.transactionKind)}` : "记一笔流水"}</h2>
            <p>{draft ? "请核对金额、账户与日期；确认后只会追加账本事件。" : "先填写真实发生的信息；当前步骤不会改变余额。"}</p>
          </div>
        </div>

        {!draft ? (
          <form onSubmit={review}>
            <div className="local-transaction-tabs" role="group" aria-label="流水类型">
              {TRANSACTION_KIND_OPTIONS.map((option) => {
                const Icon = option.value === "income"
                  ? ArrowDown : option.value === "expense" ? ArrowUp : ArrowsLeftRight;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={form.transactionKind === option.value ? "active" : ""}
                    onClick={() => chooseKind(option.value)}
                  >
                    <Icon weight="bold" /> {option.label}
                  </button>
                );
              })}
            </div>
            <div className="form-grid local-account-form local-transaction-form">
              <label>
                <span>{form.transactionKind === "transfer" ? "转出账户" : "关联账户"}</span>
                <select value={form.accountId} onChange={chooseAccount}>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.displayName} · {account.currency}</option>
                  ))}
                </select>
              </label>
              {form.transactionKind === "transfer" ? (
                <label>
                  <span>转入账户</span>
                  <select value={form.destinationAccountId} onChange={update("destinationAccountId")} required>
                    <option value="">请选择转入账户</option>
                    {availableDestinations.map((account) => (
                      <option key={account.id} value={account.id}>{account.displayName} · {account.currency}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <label>
                  <span>分类</span>
                  <select value={form.category} onChange={update("category")}>
                    {TRANSACTION_CATEGORIES[form.transactionKind].map((category) => <option key={category}>{category}</option>)}
                  </select>
                </label>
              )}
              <label>
                <span>金额</span>
                <div className="money-input">
                  <b>{selectedAccount?.currency ?? "CNY"}</b>
                  <input value={form.amount} onChange={update("amount")} inputMode="decimal" placeholder="0.00" required />
                </div>
              </label>
              <label>
                <span>发生日期</span>
                <input type="date" value={form.occurredOn} onChange={update("occurredOn")} required />
              </label>
              <label className="full">
                <span>流水说明</span>
                <input value={form.description} onChange={update("description")} maxLength={120} placeholder={form.transactionKind === "income" ? "例如：7 月租金" : form.transactionKind === "expense" ? "例如：日常用品" : "例如：转入储蓄账户"} required />
              </label>
              {form.transactionKind === "transfer" && (
                <label className="full">
                  <span>分类</span>
                  <select value={form.category} onChange={update("category")}>
                    {TRANSACTION_CATEGORIES.transfer.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </label>
              )}
              <label className="full">
                <span>备注（可选）</span>
                <textarea value={form.notes} onChange={update("notes")} rows="2" maxLength={1000} placeholder="只保存在本机，可记录对账线索。" />
              </label>
            </div>
            {error && <VaultError message={error} />}
            <div className="local-account-guardrail">
              <ShieldCheck weight="fill" />
              <span><b>尚未写入真实账本</b><small>{form.transactionKind === "transfer" ? "下一步会核对双边转账事件" : "下一步只生成待核对草稿"}</small></span>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => void dismiss()} disabled={busy}>取消</button>
              <button type="submit" className="primary" disabled={busy}>{busy ? "正在生成草稿…" : "核对流水信息"} {!busy && <ArrowRight />}</button>
            </div>
          </form>
        ) : (
          <div className="local-account-review local-transaction-review">
            <div className={`local-transaction-review-amount ${draft.transactionKind}`}>
              <span>{transactionKindLabel(draft.transactionKind)}金额</span>
              <strong>{formatTransactionAmount(draft.transactionKind, draft.amountMinor, draft.currency)}</strong>
              <small>{draft.occurredOn} · {draft.category || "未分类"}</small>
            </div>
            <div className="local-transfer-route">
              <div><small>{draft.transactionKind === "transfer" ? "转出账户" : "关联账户"}</small><b>{draft.accountName}</b></div>
              {draft.transactionKind === "transfer" && (
                <>
                  <ArrowsLeftRight weight="bold" />
                  <div><small>转入账户</small><b>{draft.destinationAccountName}</b></div>
                </>
              )}
            </div>
            <dl>
              <div><dt>流水说明</dt><dd>{draft.description}</dd></div>
              <div><dt>币种</dt><dd>{draft.currency}</dd></div>
              <div className="full"><dt>备注</dt><dd>{draft.notes || "未填写"}</dd></div>
            </dl>
            <div className="local-confirm-warning">
              <ShieldCheck weight="duotone" />
              <span>
                <b>{draft.transactionKind === "transfer" ? "确认后原子追加两笔关联事件" : "确认后追加一笔不可原地修改的事件"}</b>
                <small>{draft.transactionKind === "transfer" ? "转出与转入金额相等、方向相反，不计入收入或支出。" : "需要修正时将通过后续冲销事件完成。"}</small>
              </span>
            </div>
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={backToEdit} disabled={busy}><ArrowLeft /> 返回修改</button>
              <button type="button" className="primary" onClick={confirm} disabled={busy}>{busy ? "正在安全写入…" : "确认并写入账本"} {!busy && <Check weight="bold" />}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function LocalTransactionImportModal({
  accounts,
  onInspect,
  onCreateDraft,
  onConfirmDraft,
  onRejectDraft,
  onCommitted,
  onClose,
}) {
  const [filePayload, setFilePayload] = useState(null);
  const [inspection, setInspection] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pastedTable, setPastedTable] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const modalRef = useRef(null);

  const discardDraft = useCallback(async () => {
    if (!draft?.draftId) return;
    try {
      await onRejectDraft(draft.draftId);
    } catch {
      // Unconfirmed import drafts never append ledger events.
    }
  }, [draft?.draftId, onRejectDraft]);

  const dismiss = useCallback(async () => {
    if (busy) return;
    await discardDraft();
    setFilePayload(null);
    onClose();
  }, [busy, discardDraft, onClose]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") void dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismiss]);

  const inspectPayload = async (payload) => {
    setBusy(true);
    setError("");
    setInspection(null);
    setMapping(null);
    try {
      const nextInspection = await onInspect(payload);
      setFilePayload(payload);
      setInspection(nextInspection);
      setMapping(createImportMapping(nextInspection));
    } catch (inspectionError) {
      setFilePayload(null);
      setError(presentImportError(inspectionError));
    } finally {
      setBusy(false);
    }
  };

  const chooseFile = async (event) => {
    const file = event.target.files?.[0];
    const issue = validateImportFileMeta(file);
    if (issue) {
      setError(issue);
      event.target.value = "";
      return;
    }
    try {
      await inspectPayload(await readImportFile(file));
      setPasteMode(false);
      setPastedTable("");
    } finally {
      event.target.value = "";
    }
  };

  const inspectPastedTable = async () => {
    try {
      await inspectPayload(createPastedTablePayload(pastedTable));
    } catch (pasteError) {
      setError(presentImportError(pasteError));
    }
  };

  const updateMapping = (field) => (event) => {
    setMapping((current) => ({ ...current, [field]: event.target.value }));
    setError("");
  };

  const createReview = async (event) => {
    event.preventDefault();
    const issue = validateImportMapping(mapping, inspection, accountId);
    if (issue) {
      setError(issue);
      return;
    }
    if (!filePayload) {
      setError("文件内容已从内存中释放，请重新选择文件。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const nextDraft = await onCreateDraft(
        toImportDraftInput(filePayload, accountId, mapping),
      );
      setDraft(nextDraft);
      setFilePayload(null);
      setPastedTable("");
    } catch (draftError) {
      setError(presentImportError(draftError));
    } finally {
      setBusy(false);
    }
  };

  const backToMapping = async () => {
    setBusy(true);
    await discardDraft();
    setDraft(null);
    setInspection(null);
    setMapping(null);
    setFilePayload(null);
    setPastedTable("");
    setPasteMode(false);
    setBusy(false);
  };

  const confirm = async () => {
    if (!draft?.draftId) return;
    setBusy(true);
    setError("");
    try {
      await onConfirmDraft(draft.draftId);
      setDraft(null);
      onCommitted();
      onClose();
    } catch (confirmationError) {
      setError(presentImportError(confirmationError));
    } finally {
      setBusy(false);
    }
  };

  const headers = inspection?.headers ?? [];
  const account = accounts.find((item) => item.id === accountId);
  const isReview = Boolean(draft);
  const isDuplicate = Boolean(draft?.alreadyImported);
  const title = isDuplicate ? "文件已经导入" : isReview ? "确认导入流水" : "导入流水";
  const report = draft?.report;

  useEffect(() => {
    modalRef.current?.scrollTo({ top: 0 });
  }, [isReview, isDuplicate]);

  const mappingSelect = (field, label, required = false) => (
    <label>
      <span>{label}</span>
      <select value={mapping?.[field] ?? ""} onChange={updateMapping(field)} required={required}>
        {!required && <option value="">不使用此列</option>}
        {required && <option value="">请选择列</option>}
        {headers.map((header) => <option key={`${field}-${header}`} value={header}>{header}</option>)}
      </select>
    </label>
  );

  return (
    <div
      className="modal-backdrop local-import-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) void dismiss();
      }}
    >
      <section
        ref={modalRef}
        className="action-modal local-account-modal local-import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-import-title"
      >
        <button type="button" className="modal-close" onClick={() => void dismiss()} aria-label="关闭流水导入"><X /></button>
        <div className="action-modal-head">
          <span>{isReview ? <ShieldCheck weight="duotone" /> : <UploadSimple weight="duotone" />}</span>
          <div>
            <small>{isDuplicate ? "幂等保护" : isReview ? "第 2 步 · 核对与对账" : "第 1 步 · 选择文件与字段"}</small>
            <h2 id="local-import-title">{title}</h2>
            <p>
              {isDuplicate
                ? "来源指纹与已确认批次一致，系统不会重复增加余额。"
                : isReview
                  ? "有效行和错误行已分开；明确确认后，有效流水才会原子写入账本。"
                  : "CSV/TSV/XLSX 与主动粘贴的表格只在本机内存中解析；不会读取系统剪贴板、复制到项目仓库或发送到外部服务。"}
            </p>
          </div>
        </div>

        {!isReview && (
          <form onSubmit={createReview}>
            <div className={`local-import-picker${inspection ? " selected" : ""}`}>
              <input
                type="file"
                accept=".csv,.tsv,.xlsx,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={chooseFile}
                aria-label="选择 CSV、TSV 或 XLSX 文件"
                disabled={busy}
              />
              <UploadSimple weight="duotone" />
              <div>
                <b>{busy ? "正在本机解析…" : inspection ? inspection.fileName : "选择 CSV、TSV 或 XLSX 文件"}</b>
                <small>
                  {inspection
                    ? `${inspection.format.toUpperCase()} · ${inspection.rowCount} 行${inspection.sheetName ? ` · ${inspection.sheetName}` : ""}`
                    : "最大 10 MB；第一行必须是字段名称"}
                </small>
              </div>
              <span>{inspection ? "重新选择" : "浏览文件"}</span>
            </div>
            <div className="local-import-alternatives">
              <a className="local-import-template" href="/assets/templates/folio-transaction-import-template.csv" download>
                <FileText /> 下载虚构 CSV 模板
              </a>
              <button type="button" onClick={() => { setPasteMode((current) => !current); setError(""); }}>
                <Receipt /> {pasteMode ? "收起粘贴输入" : "粘贴飞书 / Excel 表格"}
              </button>
            </div>

            {pasteMode && (
              <div className="local-import-paste">
                <label>
                  <span>表格文本</span>
                  <textarea
                    value={pastedTable}
                    onChange={(event) => { setPastedTable(event.target.value); setError(""); }}
                    rows="6"
                    placeholder={"从飞书 Sheet/Base、Excel 或 Numbers 复制包含表头的单元格后粘贴到这里\n日期\t金额\t类型\t说明\t分类\t币种\t流水号\n2026-07-01\t-368.50\t支出\t虚构日常用品\t购物\tCNY\tdemo-001"}
                    aria-label="粘贴表格文本"
                  />
                </label>
                <div className="local-import-paste-privacy">
                  <ShieldCheck weight="duotone" />
                  <span><b>只处理你主动粘贴的内容</b><small>Folio 不申请剪贴板读取权限；关闭弹窗会释放尚未生成草稿的原始文本。</small></span>
                </div>
                <button type="button" onClick={() => void inspectPastedTable()} disabled={busy || !pastedTable.trim()}>
                  {busy ? "正在解析…" : "本机解析粘贴表格"} <ArrowRight />
                </button>
              </div>
            )}

            {inspection && mapping && (
              <>
                <div className="local-import-summary-strip">
                  <div><Table weight="duotone" /><span><small>识别字段</small><b>{headers.length} 列</b></span></div>
                  <div><Receipt weight="duotone" /><span><small>数据行</small><b>{inspection.rowCount} 行</b></span></div>
                  <div><ShieldCheck weight="duotone" /><span><small>来源指纹</small><b>{inspection.sourceFingerprint.slice(0, 10)}…</b></span></div>
                </div>

                <div className="form-grid local-account-form local-import-mapping">
                  <label className="full">
                    <span>这份文件所属账户</span>
                    <select value={accountId} onChange={(event) => { setAccountId(event.target.value); setError(""); }} required>
                      {accounts.map((item) => <option key={item.id} value={item.id}>{item.displayName} · {item.currency}</option>)}
                    </select>
                  </label>
                  {mappingSelect("date", "日期列", true)}
                  {mappingSelect("amount", "金额列", true)}
                  {mappingSelect("transactionType", "收支类型列")}
                  {mappingSelect("description", "流水说明列")}
                  {mappingSelect("category", "分类列")}
                  {mappingSelect("currency", "币种列")}
                  {mappingSelect("externalId", "外部流水号列")}
                </div>

                <div className="local-import-preview-table">
                  <header><span>文件预览</span><small>前 {Math.min(inspection.sampleRows.length, 5)} 行</small></header>
                  <div className="local-import-table-scroll">
                    <table>
                      <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
                      <tbody>
                        {inspection.sampleRows.map((row, rowIndex) => (
                          <tr key={`sample-${rowIndex}`}>
                            {headers.map((header, columnIndex) => <td key={`${header}-${columnIndex}`}>{row[columnIndex] || "—"}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="local-account-guardrail">
                  <ShieldCheck weight="fill" />
                  <span><b>尚未改变正式余额</b><small>下一步由 Rust 再次解析、精确校验金额并生成导入草稿</small></span>
                </div>
              </>
            )}

            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => void dismiss()} disabled={busy}>取消</button>
              <button type="submit" className="primary" disabled={busy || !inspection}>
                {busy ? "正在生成草稿…" : "生成导入核对草稿"} {!busy && <ArrowRight />}
              </button>
            </div>
          </form>
        )}

        {isReview && (
          <div className="local-import-review">
            <div className={`local-import-review-hero${isDuplicate ? " duplicate" : ""}`}>
              <span>{isDuplicate ? <ShieldCheck weight="fill" /> : <FileText weight="duotone" />}</span>
              <div>
                <small>{draft.sourceFormat.toUpperCase()}{draft.sheetName ? ` · ${draft.sheetName}` : ""}</small>
                <h3>{draft.sourceName}</h3>
                <p>{draft.accountName} · {draft.currency}</p>
              </div>
              <i>{isDuplicate ? "不会重复写入" : "等待明确确认"}</i>
            </div>

            <div className="local-import-reconciliation">
              <article><small>可导入</small><strong>{report.acceptedCount} 笔</strong></article>
              <article className={report.errorCount ? "warning" : ""}><small>需修正</small><strong>{report.errorCount} 行</strong></article>
              <article className="income"><small>收入合计</small><strong>{formatMinorAmount(report.totalIncomeMinor, report.currency)}</strong></article>
              <article className="expense"><small>支出合计</small><strong>{formatMinorAmount(report.totalExpenseMinor, report.currency)}</strong></article>
              <article className="net"><small>余额净变化</small><strong>{formatMinorAmount(report.netChangeMinor, report.currency)}</strong></article>
            </div>

            {draft.rows.length > 0 && (
              <div className="local-import-row-list">
                <header><span>{isDuplicate ? "已导入的流水" : "将写入的流水"}</span><small>{draft.rows.length > 12 ? `显示前 12 笔，共 ${draft.rows.length} 笔` : `${draft.rows.length} 笔`}</small></header>
                {draft.rows.slice(0, 12).map((row) => (
                  <article key={row.eventId}>
                    <span className={row.transactionKind}>{row.transactionKind === "income" ? <ArrowDown /> : <ArrowUp />}</span>
                    <div><b>{row.description}</b><small>第 {row.row} 行 · {row.occurredOn} · {row.category || "未分类"}</small></div>
                    <strong>{formatTransactionAmount(row.transactionKind, row.amountMinor, row.currency)}</strong>
                  </article>
                ))}
              </div>
            )}

            {draft.errors.length > 0 && (
              <div className="local-import-errors">
                <header><WarningCircle weight="fill" /><span><b>{draft.errors.length} 行不会导入</b><small>请修正源文件后另行导入；本次确认只写入上方有效行。</small></span></header>
                {draft.errors.slice(0, 12).map((item) => <p key={`${item.row}-${item.message}`}><b>第 {item.row} 行</b>{presentImportRowError(item.message)}</p>)}
              </div>
            )}

            <div className="local-confirm-warning">
              <ShieldCheck weight="duotone" />
              <span>
                <b>{isDuplicate ? "来源指纹已经确认过" : "有效流水将在单个事务中原子写入"}</b>
                <small>{isDuplicate ? "即使文件改名，只要内容一致，也不会重复增加余额。" : "任一写入失败都会整体回滚；来源指纹和逐行证据会保存在本地数据中。"}</small>
              </span>
            </div>
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              {isDuplicate ? (
                <button type="button" className="primary" onClick={() => void dismiss()}><Check /> 我知道了</button>
              ) : (
                <>
                  <button type="button" className="secondary" onClick={() => void backToMapping()} disabled={busy}><ArrowLeft /> 重新选择文件</button>
                  <button type="button" className="primary" onClick={() => void confirm()} disabled={busy}>
                    {busy ? "正在原子写入…" : `确认导入 ${report.acceptedCount} 笔`} {!busy && <Check weight="bold" />}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function LocalTransactionCorrectionModal({
  transaction,
  accounts,
  onCreateDraft,
  onConfirmDraft,
  onRejectDraft,
  onCommitted,
  onClose,
}) {
  const [mode, setMode] = useState("menu");
  const [form, setForm] = useState(() => createTransactionFormFromTransaction(transaction, accounts));
  const [reason, setReason] = useState("");
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selectedAccount = accounts.find((item) => item.id === form.accountId) ?? accounts[0];
  const availableDestinations = accounts.filter((item) => (
    item.id !== form.accountId && item.currency === selectedAccount?.currency
  ));

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setError("");
  };

  const chooseKind = (transactionKind) => {
    setForm((current) => ({
      ...current,
      transactionKind,
      category: TRANSACTION_CATEGORIES[transactionKind][0],
      destinationAccountId: transactionKind === "transfer"
        ? accounts.find((item) => item.id !== current.accountId && item.currency === selectedAccount?.currency)?.id ?? ""
        : "",
    }));
    setError("");
  };

  const chooseAccount = (event) => {
    const accountId = event.target.value;
    const account = accounts.find((item) => item.id === accountId);
    setForm((current) => ({
      ...current,
      accountId,
      destinationAccountId: current.transactionKind === "transfer"
        ? accounts.find((item) => item.id !== accountId && item.currency === account?.currency)?.id ?? ""
        : "",
    }));
    setError("");
  };

  const discardDraft = useCallback(async () => {
    if (!draft?.draftId) return;
    try {
      await onRejectDraft(draft.draftId);
    } catch {
      // Unconfirmed correction drafts never mutate the ledger.
    }
  }, [draft?.draftId, onRejectDraft]);

  const dismiss = useCallback(async () => {
    if (busy) return;
    await discardDraft();
    onClose();
  }, [busy, discardDraft, onClose]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") void dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismiss]);

  const review = async (event) => {
    event.preventDefault();
    const issue = validateTransactionCorrection(mode, reason, form, accounts);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    setError("");
    try {
      setDraft(await onCreateDraft(toTransactionCorrectionDraftInput({
        transactionId: transaction.id,
        correctionKind: mode,
        reason,
        form,
        accounts,
      })));
    } catch (draftError) {
      setError(presentTransactionError(draftError));
    } finally {
      setBusy(false);
    }
  };

  const backToEdit = async () => {
    setBusy(true);
    await discardDraft();
    setDraft(null);
    setBusy(false);
  };

  const confirm = async () => {
    if (!draft?.draftId) return;
    setBusy(true);
    setError("");
    try {
      await onConfirmDraft(draft.draftId);
      const action = draft.action;
      setDraft(null);
      onCommitted(action);
      onClose();
    } catch (confirmationError) {
      setError(presentTransactionError(confirmationError));
    } finally {
      setBusy(false);
    }
  };

  const title = draft
    ? draft.action === "revise" ? "确认修订流水" : "确认冲销流水"
    : mode === "menu" ? "管理正式流水" : mode === "revise" ? "修订流水" : "冲销流水";

  return (
    <div
      className="modal-backdrop local-transaction-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) void dismiss();
      }}
    >
      <section
        className="action-modal local-account-modal local-transaction-correction-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-transaction-correction-title"
      >
        <button type="button" className="modal-close" onClick={() => void dismiss()} aria-label="关闭流水管理"><X /></button>
        <div className="action-modal-head">
          <span>{draft ? <ShieldCheck weight="duotone" /> : <PencilSimple weight="duotone" />}</span>
          <div>
            <small>{draft ? "第 2 步 · 核对确认" : mode === "menu" ? "追加式账本修正" : "第 1 步 · 填写修正"}</small>
            <h2 id="local-transaction-correction-title">{title}</h2>
            <p>{draft ? "请核对原流水、修正原因和更正结果；确认后只追加新事件。" : mode === "menu" ? "正式流水不能原地修改。冲销追加反向事件，修订会原子写入反向与更正事件。" : "此步骤只生成核对草稿，不会立即改变账户余额。"}</p>
          </div>
        </div>

        {!draft && mode === "menu" && (
          <div className="local-correction-menu">
            <div className="local-correction-original">
              <span className={transaction.kind}>
                {transaction.kind === "income" ? <ArrowDown /> : transaction.kind === "expense" ? <ArrowUp /> : <ArrowsLeftRight />}
              </span>
              <div><small>{transactionKindLabel(transaction.kind)} · {transaction.category || "未分类"}</small><h3>{transaction.description}</h3><p>{transaction.accountName}{transaction.kind === "transfer" ? ` → ${transaction.destinationAccountName}` : ""} · {transaction.occurredAt?.slice(0, 10)}</p></div>
              <strong>{formatTransactionAmount(transaction.kind, transaction.amountMinor, transaction.currency)}</strong>
            </div>
            <button className="local-manage-choice" onClick={() => { setMode("revise"); setError(""); }}>
              <PencilSimple weight="duotone" />
              <span><b>修订流水</b><small>在一个原子事务中冲销原记录，并写入更正后的流水。</small></span>
              <ArrowRight />
            </button>
            <button className="local-manage-choice danger" onClick={() => { setMode("reverse"); setError(""); }}>
              <Archive weight="duotone" />
              <span><b>冲销流水</b><small>追加等额反向事件，原始流水和原因继续保留。</small></span>
              <ArrowRight />
            </button>
            <div className="modal-actions"><button className="secondary" onClick={() => void dismiss()}>完成</button></div>
          </div>
        )}

        {!draft && mode === "reverse" && (
          <form onSubmit={review} className="local-correction-form">
            <div className="local-correction-impact">
              <Archive weight="duotone" />
              <span><b>将追加 {transaction.kind === "transfer" ? "两笔" : "一笔"}等额反向事件</b><small>账户余额会回到这笔流水发生前；原始事件不会删除。</small></span>
            </div>
            <label className="local-correction-reason">
              <span>冲销原因</span>
              <textarea value={reason} onChange={(event) => { setReason(event.target.value); setError(""); }} rows="4" maxLength={240} placeholder="例如：重复录入、账户选择错误或交易未实际发生" required />
            </label>
            {error && <VaultError message={error} />}
            <div className="local-account-guardrail"><ShieldCheck weight="fill" /><span><b>尚未改变正式余额</b><small>下一步只生成冲销核对草稿</small></span></div>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setMode("menu")}><ArrowLeft /> 返回</button>
              <button type="submit" className="primary" disabled={busy}>{busy ? "正在生成草稿…" : "核对冲销影响"} {!busy && <ArrowRight />}</button>
            </div>
          </form>
        )}

        {!draft && mode === "revise" && (
          <form onSubmit={review}>
            <div className="local-transaction-tabs" role="group" aria-label="更正后的流水类型">
              {TRANSACTION_KIND_OPTIONS.map((option) => {
                const Icon = option.value === "income" ? ArrowDown : option.value === "expense" ? ArrowUp : ArrowsLeftRight;
                return <button key={option.value} type="button" className={form.transactionKind === option.value ? "active" : ""} onClick={() => chooseKind(option.value)}><Icon weight="bold" /> {option.label}</button>;
              })}
            </div>
            <div className="form-grid local-account-form local-transaction-form">
              <label>
                <span>{form.transactionKind === "transfer" ? "更正后转出账户" : "更正后关联账户"}</span>
                <select value={form.accountId} onChange={chooseAccount}>
                  {accounts.map((account) => <option key={account.id} value={account.id}>{account.displayName} · {account.currency}</option>)}
                </select>
              </label>
              {form.transactionKind === "transfer" ? (
                <label>
                  <span>更正后转入账户</span>
                  <select value={form.destinationAccountId} onChange={update("destinationAccountId")} required>
                    <option value="">请选择转入账户</option>
                    {availableDestinations.map((account) => <option key={account.id} value={account.id}>{account.displayName} · {account.currency}</option>)}
                  </select>
                </label>
              ) : (
                <label><span>分类</span><select value={form.category} onChange={update("category")}>{TRANSACTION_CATEGORIES[form.transactionKind].map((category) => <option key={category}>{category}</option>)}</select></label>
              )}
              <label><span>更正后金额</span><div className="money-input"><b>{selectedAccount?.currency ?? "CNY"}</b><input value={form.amount} onChange={update("amount")} inputMode="decimal" required /></div></label>
              <label><span>发生日期</span><input type="date" value={form.occurredOn} onChange={update("occurredOn")} required /></label>
              <label className="full"><span>流水说明</span><input value={form.description} onChange={update("description")} maxLength={120} required /></label>
              {form.transactionKind === "transfer" && <label className="full"><span>分类</span><select value={form.category} onChange={update("category")}>{TRANSACTION_CATEGORIES.transfer.map((category) => <option key={category}>{category}</option>)}</select></label>}
              <label className="full"><span>修订原因</span><textarea value={reason} onChange={(event) => { setReason(event.target.value); setError(""); }} rows="2" maxLength={240} placeholder="说明为什么需要修改正式流水" required /></label>
              <label className="full"><span>备注（可选）</span><textarea value={form.notes} onChange={update("notes")} rows="2" maxLength={1000} /></label>
            </div>
            {error && <VaultError message={error} />}
            <div className="local-account-guardrail"><ShieldCheck weight="fill" /><span><b>尚未改变正式余额</b><small>确认时才会原子冲销原记录并写入更正记录</small></span></div>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setMode("menu")}><ArrowLeft /> 返回</button>
              <button type="submit" className="primary" disabled={busy}>{busy ? "正在生成草稿…" : "核对修订结果"} {!busy && <ArrowRight />}</button>
            </div>
          </form>
        )}

        {draft && (
          <div className="local-account-review local-correction-review">
            <div className="local-correction-comparison">
              <div className="original">
                <small>原流水 · 将冲销</small>
                <h3>{draft.original.description}</h3>
                <strong>{formatTransactionAmount(draft.original.transactionKind, draft.original.amountMinor, draft.original.currency)}</strong>
                <span>{draft.original.accountName} · {draft.original.occurredOn}</span>
              </div>
              <ArrowRight weight="bold" />
              {draft.action === "revise" ? (
                <div className="replacement">
                  <small>更正后流水 · 将写入</small>
                  <h3>{draft.replacement.description}</h3>
                  <strong>{formatTransactionAmount(draft.replacement.transactionKind, draft.replacement.amountMinor, draft.replacement.currency)}</strong>
                  <span>{draft.replacement.accountName} · {draft.replacement.occurredOn}</span>
                </div>
              ) : (
                <div className="replacement void">
                  <small>冲销结果</small>
                  <h3>不写入替代流水</h3>
                  <strong>余额回退</strong>
                  <span>原记录继续保留并标记已冲销</span>
                </div>
              )}
            </div>
            <dl><div className="full"><dt>修正原因</dt><dd>{draft.reason}</dd></div></dl>
            <div className="local-confirm-warning">
              <ShieldCheck weight="duotone" />
              <span><b>{draft.action === "revise" ? "反向事件与更正事件原子写入" : "只追加反向事件，不删除原记录"}</b><small>任何一步失败都会整体回滚；重复确认不会重复影响余额。</small></span>
            </div>
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button className="secondary" onClick={() => void backToEdit()} disabled={busy}><ArrowLeft /> 返回修改</button>
              <button className={draft.action === "reverse" ? "danger-button" : "primary"} onClick={() => void confirm()} disabled={busy}>
                {busy ? "正在安全写入…" : draft.action === "revise" ? "确认原子修订" : "确认冲销流水"}
                {!busy && (draft.action === "revise" ? <Check weight="bold" /> : <Archive />)}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function reminderIcon(category) {
  if (category === "rent") return Buildings;
  if (category === "insurance") return ShieldCheck;
  if (category === "maturity" || category === "investment") return Coins;
  if (category === "repayment") return Receipt;
  if (category === "idle_cash") return Wallet;
  return CalendarCheck;
}

function daysUntil(dateValue) {
  const due = new Date(`${dateValue}T00:00:00.000Z`);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((due.getTime() - today) / 86_400_000);
}

function dueLabel(reminder) {
  if (reminder.status === "completed") return "已完成";
  const remaining = daysUntil(reminder.dueOn);
  if (remaining < 0) return `逾期 ${Math.abs(remaining)} 天`;
  if (remaining === 0) return "今天";
  if (remaining === 1) return "明天";
  return `${remaining} 天后`;
}

function nextPreviewReminderDueOn(dueOn, recurrenceRule) {
  if (!recurrenceRule) return null;
  const [year, month, day] = dueOn.split("-").map(Number);
  const targetYear = recurrenceRule === "yearly" ? year + 1 : month === 12 ? year + 1 : year;
  const targetMonth = recurrenceRule === "yearly" ? month : month === 12 ? 1 : month + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function LocalReminders({
  accounts,
  reminders,
  dailyChanges = { reminders: {} },
  baseCurrency,
  onCreateDraft,
  onUpdateDraft,
  onCompleteDraft,
  onArchiveDraft,
  onConfirmDraft,
  onRejectDraft,
  onCommitted,
}) {
  const [filter, setFilter] = useState("all");
  const [modalState, setModalState] = useState(null);
  const activeItems = reminders.filter((item) => item.status === "active" || item.status === "snoozed");
  const completedItems = reminders.filter((item) => item.status === "completed");
  const visible = filter === "all"
    ? reminders
    : filter === "completed"
      ? completedItems
      : reminders.filter((item) => item.category === filter);
  const nextItem = [...activeItems].sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
  const filterOptions = [
    { value: "all", label: "全部" },
    { value: "rent", label: "租金" },
    { value: "insurance", label: "保险" },
    { value: "maturity", label: "到期" },
    { value: "repayment", label: "还款" },
    { value: "completed", label: "已完成" },
  ];
  const managerConfigs = [
    {
      category: "rent",
      tone: "rent",
      title: "租金管家",
      subtitle: "租金与房产事项",
      icon: Buildings,
      action: "管理租金",
    },
    {
      category: "insurance",
      tone: "insurance",
      title: "保险管家",
      subtitle: "保单续期与复核",
      icon: ShieldCheck,
      action: "管理保单",
    },
    {
      category: "maturity",
      tone: "maturity",
      title: "到期管家",
      subtitle: "理财、定期与到期提醒",
      icon: Clock,
      action: "管理到期",
    },
  ];

  return (
    <>
      <div className="subpage reminders-page local-reminders-v2">
        <section className="reminder-hero">
          <div>
            <span>下一个重要节点</span>
            <strong>{nextItem ? dueLabel(nextItem) : "暂无事项"}</strong>
            <p>{nextItem
              ? `${nextItem.title}${nextItem.amountMinor ? ` · ${formatReminderAmount(nextItem.amountMinor, nextItem.currency ?? baseCurrency)}` : ""}`
              : "添加租金、保险、到期或还款事项"}</p>
          </div>
          <button onClick={() => setModalState({ reminder: null })}><Plus /> 添加事项</button>
        </section>

        <section className="manager-grid">
          {managerConfigs.map((manager) => {
            const items = activeItems.filter((item) => (
              manager.category === "maturity"
                ? item.category === "maturity" || item.category === "investment"
                : item.category === manager.category
            ));
            const item = [...items].sort((left, right) => left.dueOn.localeCompare(right.dueOn))[0];
            const ManagerIcon = manager.icon;
            return (
              <article className={`manager-card ${manager.tone}`} key={manager.category}>
                <div className="manager-title">
                  <span><ManagerIcon weight="duotone" /></span>
                  <div><h3>{manager.title}</h3><p>{items.length} 项待处理 · {manager.subtitle}</p></div>
                  <em>{item ? dueLabel(item) : "暂无"}</em>
                </div>
                <div className="manager-primary">
                  <span>
                    <small>{item?.title ?? "尚未添加事项"}</small>
                    <b>{item ? formatReminderAmount(item.amountMinor, item.currency ?? baseCurrency) : "—"}</b>
                  </span>
                  <strong>{item?.linkedAccountName ?? "本地加密日程"}</strong>
                </div>
                <button onClick={() => item ? setModalState({ reminder: item }) : setModalState({ reminder: null })}>
                  {item ? <PencilSimple /> : <Plus />} {item ? manager.action : "添加事项"}
                </button>
              </article>
            );
          })}
        </section>

        <section className="panel local-reminder-calendar">
          <div className="panel-head responsive">
            <div><h2>财务日程</h2><p>{activeItems.length} 项待处理 · {completedItems.length} 项已完成</p></div>
            <button className="round-add" aria-label="添加事项" onClick={() => setModalState({ reminder: null })}><Plus /></button>
          </div>

          <div className="local-reminder-toolbar">
            <div className="local-reminder-filters" aria-label="事项筛选">
              {filterOptions.map((item) => (
                <button
                  key={item.value}
                  className={filter === item.value ? "active" : ""}
                  onClick={() => setFilter(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <small>{visible.length} 项记录</small>
          </div>

          {visible.length === 0 ? (
            <div className="local-reminder-empty">
              <div><CalendarBlank weight="duotone" /></div>
              <span>{reminders.length ? "当前筛选下没有事项" : "真实事项从这里开始"}</span>
              <h3>{reminders.length ? "换一个分类看看" : "还没有财务事项"}</h3>
              <p>{reminders.length ? "已完成和其他类型的事项仍保留在加密记录中。" : "添加租金、保险、到期、还款或自定义事项；确认前不会写入正式数据。"}</p>
              {!reminders.length && <button onClick={() => setModalState({ reminder: null })}><Plus /> 添加第一项</button>}
            </div>
          ) : (
            <div className="local-reminder-list">
              {visible.map((reminder) => {
                const Icon = reminderIcon(reminder.category);
                const date = new Date(`${reminder.dueOn}T00:00:00.000Z`);
                const amountCurrency = reminder.currency ?? baseCurrency;
                const changeStatus = dailyChanges.reminders?.[reminder.id];
                return (
                  <article key={reminder.id} className={`${reminder.status === "completed" ? "completed" : ""} ${changeStatus ? "is-daily-change" : ""}`.trim()}>
                    <div className="local-reminder-date"><b>{date.getUTCDate()}</b><span>{date.getUTCMonth() + 1} 月</span></div>
                    <span className={`local-reminder-type ${reminder.category}`}><Icon weight="duotone" /></span>
                    <div className="local-reminder-copy">
                      <small>{reminderCategoryLabel(reminder.category)} · {reminderStatusLabel(reminder.status)}</small>
                      <h3>{reminder.title}</h3>
                      <DailyChangeBadge status={changeStatus} />
                      <p>
                        {reminder.linkedAccountName || "未关联账户"} · 提前 {reminder.advanceDays} 天
                        {reminder.recurrenceRule ? ` · ${reminderRecurrenceLabel(reminder.recurrenceRule)}` : ""}
                        {Number(reminder.completedOccurrences) > 0 ? ` · 已完成 ${reminder.completedOccurrences} 期` : ""}
                      </p>
                    </div>
                    <div className="local-reminder-value">
                      <strong>{formatReminderAmount(reminder.amountMinor, amountCurrency)}</strong>
                      <span className={daysUntil(reminder.dueOn) < 0 && reminder.status !== "completed" ? "overdue" : ""}>{dueLabel(reminder)}</span>
                    </div>
                    <button className="local-reminder-manage" aria-label={`管理事项 ${reminder.title}`} onClick={() => setModalState({ reminder })}>
                      <DotsThree weight="bold" />
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {modalState && (
        <LocalReminderModal
          key={modalState.reminder?.id ?? "new-reminder"}
          reminder={modalState.reminder}
          accounts={accounts}
          baseCurrency={baseCurrency}
          onCreateDraft={onCreateDraft}
          onUpdateDraft={onUpdateDraft}
          onCompleteDraft={onCompleteDraft}
          onArchiveDraft={onArchiveDraft}
          onConfirmDraft={onConfirmDraft}
          onRejectDraft={onRejectDraft}
          onCommitted={onCommitted}
          onClose={() => setModalState(null)}
        />
      )}
    </>
  );
}

function LocalReminderModal({
  reminder,
  accounts,
  baseCurrency,
  planningGoal = false,
  onCreateDraft,
  onUpdateDraft,
  onCompleteDraft,
  onArchiveDraft,
  onConfirmDraft,
  onRejectDraft,
  onCommitted,
  onClose,
}) {
  const [mode, setMode] = useState(reminder ? "menu" : "edit");
  const [form, setForm] = useState(() => {
    const initial = createReminderForm(reminder);
    return !reminder && planningGoal ? { ...initial, category: "custom" } : initial;
  });
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selectedAccount = accounts.find((item) => item.id === form.linkedAccountId);
  const amountCurrency = selectedAccount?.currency ?? reminder?.currency ?? baseCurrency;

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setError("");
  };

  const discardDraft = useCallback(async () => {
    if (!draft?.draftId) return;
    try {
      await onRejectDraft(draft.draftId);
    } catch {
      // Rejected reminder drafts never mutate formal reminder data.
    }
  }, [draft?.draftId, onRejectDraft]);

  const dismiss = useCallback(async () => {
    if (busy) return;
    await discardDraft();
    onClose();
  }, [busy, discardDraft, onClose]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") void dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismiss]);

  const reviewForm = async (event) => {
    event.preventDefault();
    const issue = validateReminderForm(form, accounts);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    setError("");
    try {
      setDraft(reminder
        ? await onUpdateDraft(toReminderUpdateDraftInput(reminder.id, form, accounts))
        : await onCreateDraft(toReminderDraftInput(form, accounts)));
    } catch (draftError) {
      setError(presentReminderError(draftError));
    } finally {
      setBusy(false);
    }
  };

  const reviewAction = async (action) => {
    setBusy(true);
    setError("");
    try {
      setDraft(action === "complete"
        ? await onCompleteDraft(reminder.id)
        : await onArchiveDraft(reminder.id));
    } catch (draftError) {
      setError(presentReminderError(draftError));
    } finally {
      setBusy(false);
    }
  };

  const backToEdit = async () => {
    const action = draft?.action;
    setBusy(true);
    await discardDraft();
    setDraft(null);
    setMode(action === "update" || action === "create" ? "edit" : "menu");
    setBusy(false);
  };

  const confirm = async () => {
    if (!draft?.draftId) return;
    setBusy(true);
    setError("");
    try {
      await onConfirmDraft(draft.draftId);
      const action = draft.action;
      setDraft(null);
      onCommitted(action, draft.nextDueOn ?? null);
      onClose();
    } catch (confirmationError) {
      setError(presentReminderError(confirmationError));
    } finally {
      setBusy(false);
    }
  };

  const actionTitles = {
    create: "确认添加事项",
    update: "确认事项修改",
    complete: "确认完成事项",
    archive: "确认归档事项",
  };
  const title = draft
    ? actionTitles[draft.action]
    : mode === "menu"
      ? planningGoal ? "管理未来用款目标" : "管理财务事项"
      : reminder
        ? planningGoal ? "编辑未来用款目标" : "编辑财务事项"
        : planningGoal ? "添加未来用款目标" : "添加事项";
  const reviewCurrency = draft?.currency ?? amountCurrency;

  return (
    <div
      className="modal-backdrop local-reminder-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) void dismiss();
      }}
    >
      <section
        className="action-modal local-account-modal local-reminder-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-reminder-title"
      >
        <button type="button" className="modal-close" onClick={() => void dismiss()} aria-label="关闭事项管理"><X /></button>
        <div className="action-modal-head">
          <span>{draft ? <CalendarCheck weight="duotone" /> : <Bell weight="duotone" />}</span>
          <div>
            <small>{draft ? "第 2 步 · 核对确认" : mode === "menu" ? "事项生命周期管理" : "第 1 步 · 填写事项"}</small>
            <h2 id="local-reminder-title">{title}</h2>
            <p>{draft
              ? "请核对日期、金额和提醒规则；明确确认后才会更新正式事项。"
              : mode === "menu"
                ? "编辑、完成和归档都会先进入核对草稿，并保留变化历史。"
                : planningGoal
                  ? "记录未来 12 个月确定用款；确认后会同时进入财务事项。"
                  : "记录需要准备、核对或跟进的事项；不会生成或发送催收信息。"}</p>
          </div>
        </div>

        {!draft && mode === "menu" && (
          <div className="local-reminder-menu">
            <div className="local-reminder-menu-summary">
              <span><CalendarBlank weight="duotone" /></span>
              <div><small>{reminderCategoryLabel(reminder.category)} · {reminderStatusLabel(reminder.status)}</small><h3>{reminder.title}</h3><p>{reminder.dueOn} · 提前 {reminder.advanceDays} 天</p></div>
              <strong>{formatReminderAmount(reminder.amountMinor, reminder.currency ?? baseCurrency)}</strong>
            </div>
            {reminder.status !== "completed" && (
              <>
                <button className="local-manage-choice" onClick={() => setMode("edit")}>
                  <PencilSimple weight="duotone" />
                  <span><b>编辑事项</b><small>修改日期、金额、关联账户或提醒规则。</small></span>
                  <ArrowRight />
                </button>
                <button className="local-manage-choice" onClick={() => void reviewAction("complete")} disabled={busy}>
                  <Check weight="bold" />
                  <span>
                    <b>{reminder.recurrenceRule ? "完成本期事项" : "标记为已完成"}</b>
                    <small>{reminder.recurrenceRule ? "本期留痕后自动安排下一期，不会覆盖历史。" : "保留事项与处理历史，不删除记录。"}</small>
                  </span>
                  <ArrowRight />
                </button>
              </>
            )}
            <button className="local-manage-choice danger" onClick={() => void reviewAction("archive")} disabled={busy}>
              <Archive weight="duotone" />
              <span><b>归档事项</b><small>从当前事项列表移除，历史与审计记录继续保留。</small></span>
              <ArrowRight />
            </button>
            {error && <VaultError message={error} />}
            <div className="modal-actions"><button className="secondary" onClick={() => void dismiss()}>完成</button></div>
          </div>
        )}

        {!draft && mode === "edit" && (
          <form onSubmit={reviewForm}>
            <div className="form-grid local-account-form local-reminder-form">
              <label>
                <span>事项类型</span>
                <select value={form.category} onChange={update("category")}>
                  {REMINDER_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label>
                <span>关联账户（可选）</span>
                <select value={form.linkedAccountId} onChange={update("linkedAccountId")}>
                  <option value="">不关联账户</option>
                  {accounts.map((account) => <option key={account.id} value={account.id}>{account.displayName} · {account.currency}</option>)}
                </select>
              </label>
              <label className="full">
                <span>事项标题</span>
                <input value={form.title} onChange={update("title")} maxLength={120} placeholder="例如：确认保险续缴安排" required />
              </label>
              <label>
                <span>相关金额（可选）</span>
                <div className="money-input">
                  <b>{amountCurrency}</b>
                  <input value={form.amount} onChange={update("amount")} inputMode="decimal" placeholder="留空表示无金额" />
                </div>
              </label>
              <label>
                <span>关注日期</span>
                <input type="date" value={form.dueOn} onChange={update("dueOn")} required />
              </label>
              <label>
                <span>提前提醒</span>
                <select value={form.advanceDays} onChange={update("advanceDays")}>
                  {[0, 1, 3, 7, 15, 30].map((days) => <option key={days} value={days}>{days === 0 ? "当天" : `提前 ${days} 天`}</option>)}
                </select>
              </label>
              <label>
                <span>重复规则</span>
                <select value={form.recurrenceRule} onChange={update("recurrenceRule")}>
                  {REMINDER_RECURRENCES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label className="full">
                <span>备注（可选）</span>
                <textarea value={form.notes} onChange={update("notes")} rows="3" maxLength={1000} placeholder="记录需要准备、核对或跟进的内容；只保存在本机。" />
              </label>
            </div>
            {error && <VaultError message={error} />}
            <div className="local-account-guardrail"><ShieldCheck weight="fill" /><span><b>尚未写入正式事项</b><small>下一步只生成待核对草稿</small></span></div>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => reminder ? setMode("menu") : void dismiss()} disabled={busy}>取消</button>
              <button type="submit" className="primary" disabled={busy}>{busy ? "正在生成草稿…" : "核对事项信息"} {!busy && <ArrowRight />}</button>
            </div>
          </form>
        )}

        {draft && (
          <div className={`local-account-review local-reminder-review ${draft.action}`}>
            <div className="local-reminder-review-hero">
              <span>{reminderCategoryLabel(draft.category)} · {draft.action === "archive" ? "将归档" : reminderStatusLabel(draft.status)}</span>
              <h3>{draft.title}</h3>
              <strong>{formatReminderAmount(draft.amountMinor, reviewCurrency)}</strong>
              <small>
                {draft.nextDueOn
                  ? `完成本期 ${draft.completedDueOn} · 下一期 ${draft.nextDueOn}`
                  : `${draft.dueOn} · 提前 ${draft.advanceDays} 天`}
              </small>
            </div>
            <dl>
              <div><dt>关联账户</dt><dd>{draft.linkedAccountName || "未关联账户"}</dd></div>
              <div><dt>重复规则</dt><dd>{reminderRecurrenceLabel(draft.recurrenceRule)}</dd></div>
              <div className="full"><dt>备注</dt><dd>{draft.notes || "未填写"}</dd></div>
            </dl>
            <div className="local-confirm-warning">
              <ShieldCheck weight="duotone" />
              <span>
                <b>{draft.action === "archive" ? "归档不会删除历史" : draft.nextDueOn ? "本期完成记录不可覆盖" : "确认后追加事项变化与审计记录"}</b>
                <small>{draft.nextDueOn ? `确认后本期将永久留痕，事项继续进行并在 ${draft.nextDueOn} 再次提醒。` : draft.action === "complete" ? "事项将标记完成，仍可在已完成筛选中查看。" : draft.action === "archive" ? "事项从当前列表移除，历史事件仍保存在本地数据中。" : "取消或返回修改不会改变正式事项。"}</small>
              </span>
            </div>
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button className="secondary" onClick={() => void backToEdit()} disabled={busy}><ArrowLeft /> 返回</button>
              <button className={draft.action === "archive" ? "danger-button" : "primary"} onClick={() => void confirm()} disabled={busy}>
                {busy ? "正在安全保存…" : draft.action === "archive" ? "确认归档事项" : draft.action === "complete" ? draft.nextDueOn ? "确认完成本期" : "确认标记完成" : draft.action === "update" ? "确认更新事项" : "确认添加事项"}
                {!busy && (draft.action === "archive" ? <Archive /> : <Check weight="bold" />)}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function DataExportModal({ vault, onCreateDataExport, onClose }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [includeAuditLog, setIncludeAuditLog] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    if (currentPassword.length < 12) {
      setError("请输入当前应用密码。");
      return;
    }
    if (!acknowledged) {
      setError("请确认你理解导出包是未加密明文，并会安全保管。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const exported = await onCreateDataExport({
        currentPassword,
        includeAuditLog,
        confirmedByUser: true,
      });
      setCurrentPassword("");
      if (exported.status === "cancelled") {
        setError("没有选择保存位置，数据包未导出。");
      } else {
        setResult(exported);
      }
    } catch (exportError) {
      setCurrentPassword("");
      setError(
        typeof exportError?.message === "string"
          ? exportError.message
          : "数据导出失败；本地数据没有改变。",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="action-modal local-account-modal local-backup-modal local-data-export-modal" role="dialog" aria-modal="true" aria-labelledby="data-export-title">
        <button className="modal-close" onClick={onClose} aria-label="关闭可移植数据导出"><X /></button>
        <div className="action-modal-head">
          <span><Table weight="duotone" /></span>
          <div>
            <small>{result ? "导出完成 · 明文数据" : "重新认证 · 数据可迁移"}</small>
            <h2 id="data-export-title">{result ? "可移植数据包已保存" : "导出标准 CSV 数据包"}</h2>
            <p>{result
              ? "这个 ZIP 可以用普通表格和审计工具打开，请像保护银行流水一样保管。"
              : "导出包包含账户、追加式账本、事项、规划和导入批次。它不加密，便于迁移和独立核查。"}</p>
          </div>
        </div>
        {result ? (
          <div className="local-backup-result">
            <div><WarningCircle weight="fill" /><span><small>明文 ZIP 文件</small><b>{result.fileName}</b></span></div>
            <dl>
              <div><dt>文件大小</dt><dd>{formatBackupBytes(result.byteCount)}</dd></div>
              <div><dt>导出时间</dt><dd>{result.exportedAt?.slice(0, 19).replace("T", " ")}</dd></div>
              <div><dt>账户</dt><dd>{result.accountCount ?? 0}</dd></div>
              <div><dt>账本事件</dt><dd>{result.ledgerEventCount ?? 0}</dd></div>
              <div><dt>事项</dt><dd>{result.reminderCount ?? 0}</dd></div>
              <div><dt>审计事件</dt><dd>{result.auditEventCount ?? 0}</dd></div>
              <div className="full"><dt>SHA-256 指纹</dt><dd>{result.fingerprint?.slice(0, 24)}…</dd></div>
            </dl>
            <div className="local-confirm-warning warning">
              <WarningCircle weight="duotone" />
              <span><b>此文件不受应用密码保护</b><small>不要上传到公开网盘、GitHub 或聊天群；使用后请移动到受控位置或安全删除。</small></span>
            </div>
            <div className="modal-actions"><button className="primary" onClick={onClose}><Check /> 完成</button></div>
          </div>
        ) : (
          <form onSubmit={submit} className="local-backup-form">
            <div className="local-backup-context">
              <Vault weight="duotone" />
              <span><small>正在导出</small><b>{vault.displayName}</b><i>{vault.baseCurrency}</i></span>
            </div>
            <div className="local-confirm-warning warning">
              <WarningCircle weight="duotone" />
              <span><b>即将生成未加密的明文财务文件</b><small>ZIP 内为 UTF-8 CSV，可被 Excel、Numbers 和数据库工具直接读取。</small></span>
            </div>
            <PasswordField
              label="当前应用密码"
              value={currentPassword}
              onChange={(value) => {
                setCurrentPassword(value);
                setError("");
              }}
              visible={visible}
              onToggle={() => setVisible((value) => !value)}
              autoComplete="current-password"
            />
            <label className="local-export-option">
              <input
                type="checkbox"
                checked={includeAuditLog}
                onChange={(event) => setIncludeAuditLog(event.target.checked)}
              />
              <span><Check weight="bold" /></span>
              <div><b>包含审计日志</b><small>用于核查创建、修改、导入、备份和确认记录；可能包含变更前后摘要。</small></div>
            </label>
            <label className="local-export-option critical">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => {
                  setAcknowledged(event.target.checked);
                  setError("");
                }}
              />
              <span><Check weight="bold" /></span>
              <div><b>我理解这是明文敏感数据</b><small>我会将文件保存在受控位置，不提交到 GitHub 或公开分享。</small></div>
            </label>
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={onClose} disabled={busy}>取消</button>
              <button className="primary" type="submit" disabled={busy || !acknowledged}>
                {busy ? "正在生成标准数据包…" : "选择位置并导出"} {!busy && <Table />}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function ClearAllDataModal({ vault, onClearAllData, onClose }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    if (currentPassword.length < 12) {
      setError("请输入当前应用密码。");
      return;
    }
    if (!acknowledged) {
      setError("请再次确认你理解当前 Folio 数据将被永久清除。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onClearAllData({
        vaultId: vault.id ?? vault.vaultId,
        currentPassword,
      });
      setCurrentPassword("");
      setBusy(false);
      onClose();
    } catch (nextError) {
      setCurrentPassword("");
      setError(
        typeof nextError?.message === "string"
          ? nextError.message
          : "清除失败；当前数据没有改变。",
      );
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="action-modal local-account-modal local-backup-modal local-clear-data-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clear-data-title"
      >
        <button className="modal-close" onClick={onClose} disabled={busy} aria-label="关闭清除全部数据">
          <X />
        </button>
        <div className="action-modal-head danger">
          <span><Trash weight="duotone" /></span>
          <div>
            <small>不可撤销 · 当前 Folio 数据</small>
            <h2 id="clear-data-title">清除全部数据</h2>
            <p>账户、持仓、流水、事项、AI 草稿、导入记录、同步元数据和邮箱数据源都会被永久销毁。</p>
          </div>
        </div>
        <form onSubmit={submit} className="local-backup-form">
          <div className="local-backup-context danger">
            <WarningCircle weight="fill" />
            <span>
              <small>即将永久清除</small>
              <b>{vault.displayName}</b>
              <i>{vault.baseCurrency}</i>
            </span>
          </div>
          <div className="local-confirm-warning warning">
            <WarningCircle weight="duotone" />
            <span>
              <b>请先确认已有可用的加密备份</b>
              <small>已导出的 Markdown 不会被删除；Codex 登录仍由 ChatGPT 管理。清除后当前数据无法恢复。</small>
            </span>
          </div>
          <PasswordField
            label="再次输入当前应用密码"
            value={currentPassword}
            onChange={(value) => {
              setCurrentPassword(value);
              setError("");
            }}
            visible={visible}
            onToggle={() => setVisible((value) => !value)}
            autoComplete="current-password"
          />
          <label className="local-export-option critical">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => {
                setAcknowledged(event.target.checked);
                setError("");
              }}
            />
            <span><Check weight="bold" /></span>
            <div>
              <b>我确认永久清除当前 Folio 全部数据</b>
              <small>此操作会销毁本机解密材料，且不能通过撤销恢复。</small>
            </div>
          </label>
          {error && <VaultError message={error} />}
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button className="danger-button" type="submit" disabled={busy || !acknowledged}>
              {busy ? "正在安全清除…" : "确认并永久清除"} {!busy && <Trash />}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function FullReimportModal({
  vault,
  pendingBatch = null,
  onExportMarkdown,
  onReplaceAllData,
  onReady,
  onClose,
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [exported, setExported] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const exportCurrent = async () => {
    setBusy("export");
    setError("");
    try {
      const result = await onExportMarkdown();
      if (result?.status === "cancelled" || !result) {
        setError("没有完成旧数据导出；当前数据没有改变。");
        return;
      }
      setExported(true);
    } catch (nextError) {
      setError(typeof nextError?.message === "string" ? nextError.message : "旧数据导出失败。");
    } finally {
      setBusy("");
    }
  };

  const replace = async (event) => {
    event.preventDefault();
    if (!pendingBatch) {
      onClose();
      onReady(null);
      return;
    }
    if (!exported) {
      setError("请先导出当前 Markdown，给旧数据留一份可恢复副本。");
      return;
    }
    if (currentPassword.length < 12) {
      setError("请输入当前应用密码。");
      return;
    }
    if (!acknowledged) {
      setError("请确认你理解当前数据会被替换。新的批次仍需逐组核对确认。");
      return;
    }
    setBusy("replace");
    setError("");
    try {
      await onReplaceAllData({
        vaultId: vault.id ?? vault.vaultId,
        currentPassword,
        pendingBatch,
      });
    } catch (nextError) {
      setCurrentPassword("");
      setError(
        typeof nextError?.message === "string"
          ? nextError.message
          : "全量重录准备失败；当前数据没有改变。",
      );
      setBusy("");
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="action-modal local-account-modal local-backup-modal local-full-reimport-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="full-reimport-title"
      >
        <button className="modal-close" type="button" onClick={onClose} disabled={Boolean(busy)} aria-label="关闭全量重录">
          <X />
        </button>
        <div className="action-modal-head danger">
          <span><Table weight="duotone" /></span>
          <div>
            <small>完整快照 · 替换而非叠加</small>
            <h2 id="full-reimport-title">重新录入全量数据</h2>
            <p>{pendingBatch
              ? "这份快照会在旧数据安全清空后重新进入逐组核对，不会直接写入。"
              : "先导出当前数据，再选择新的完整 Markdown。日常新增请回到“新增或导入资料”。"}</p>
          </div>
        </div>
        <form onSubmit={replace} className="local-backup-form">
          <div className="full-reimport-steps">
            <article className={exported ? "complete" : "active"}>
              <b>1</b><span><strong>导出旧数据</strong><small>保留一份结构化 Markdown，避免误操作后无从核对。</small></span>
              <button type="button" onClick={() => void exportCurrent()} disabled={Boolean(busy)}>
                {busy === "export" ? "正在导出…" : exported ? "重新导出" : "导出当前 Markdown"}
              </button>
            </article>
            <article className={pendingBatch ? "active" : ""}>
              <b>2</b><span><strong>准备完整快照</strong><small>{pendingBatch ? `已读取：${pendingBatch.documentInfo?.fileName ?? "本次结构化 Markdown"}` : "下一步选择新的完整 Markdown。"}</small></span>
              {!pendingBatch && <button type="submit" disabled={Boolean(busy)}>选择新快照</button>}
            </article>
            <article>
              <b>3</b><span><strong>清空后逐组核对</strong><small>账户 → 持仓 → 流水 → 事项 → 规划，仍需逐组确认。</small></span>
            </article>
          </div>
          {pendingBatch && (
            <>
              <PasswordField
                label="再次输入当前应用密码"
                value={currentPassword}
                onChange={(value) => {
                  setCurrentPassword(value);
                  setError("");
                }}
                visible={visible}
                onToggle={() => setVisible((value) => !value)}
                autoComplete="current-password"
              />
              <label className="local-export-option critical">
                <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
                <span><Check weight="bold" /></span>
                <div><b>我确认以本次完整快照替换当前数据</b><small>旧数据会被清空；新快照不会自动完成，仍需逐组明确确认。</small></div>
              </label>
            </>
          )}
          {error && <VaultError message={error} />}
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose} disabled={Boolean(busy)}>取消</button>
            {pendingBatch && (
              <button className="danger-button" type="submit" disabled={Boolean(busy) || !exported || !acknowledged}>
                {busy === "replace" ? "正在安全准备…" : "验证密码并开始重录"} {busy !== "replace" && <ArrowRight />}
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

function BackupExportModal({ vault, onCreateBackup, onClose }) {
  const [form, setForm] = useState({
    currentPassword: "",
    backupPassword: "",
    backupConfirmation: "",
  });
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const update = (field) => (value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
  };

  const submit = async (event) => {
    event.preventDefault();
    const issue = validateBackupExportForm(form);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const exported = await onCreateBackup({
        currentPassword: form.currentPassword,
        backupPassword: form.backupPassword,
        confirmedByUser: true,
      });
      setForm({ currentPassword: "", backupPassword: "", backupConfirmation: "" });
      if (exported.status === "cancelled") {
        setError("没有选择保存位置，数据未导出。");
      } else {
        setResult(exported);
      }
    } catch (exportError) {
      setForm((current) => ({ ...current, currentPassword: "" }));
      setError(presentBackupError(exportError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="action-modal local-account-modal local-backup-modal" role="dialog" aria-modal="true" aria-labelledby="backup-export-title">
        <button className="modal-close" onClick={onClose} aria-label="关闭备份导出"><X /></button>
        <div className="action-modal-head">
          <span><Archive weight="duotone" /></span>
          <div>
            <small>{result ? "导出完成" : "重新认证 · 独立加密"}</small>
            <h2 id="backup-export-title">{result ? "加密备份已保存" : "导出完整加密备份"}</h2>
            <p>{result ? "请把备份密码与文件分开保管；Folio 无法替你找回备份密码。" : "完整备份包含账户、账本、事项和审计。导出前需要再次验证当前应用密码。"}</p>
          </div>
        </div>
        {result ? (
          <div className="local-backup-result">
            <div><ShieldCheck weight="fill" /><span><small>文件</small><b>{result.fileName}</b></span></div>
            <dl>
              <div><dt>容器大小</dt><dd>{formatBackupBytes(result.byteCount)}</dd></div>
              <div><dt>创建时间</dt><dd>{result.createdAt?.slice(0, 19).replace("T", " ")}</dd></div>
              <div className="full"><dt>文件指纹</dt><dd>{result.fingerprint?.slice(0, 20)}…</dd></div>
            </dl>
            <div className="local-confirm-warning">
              <LockKey weight="duotone" />
              <span><b>备份文件已认证加密</b><small>密码错误、文件被篡改或内容损坏时，恢复会在写入前停止。</small></span>
            </div>
            <div className="modal-actions"><button className="primary" onClick={onClose}><Check /> 完成</button></div>
          </div>
        ) : (
          <form onSubmit={submit} className="local-backup-form">
            <div className="local-backup-context">
              <Vault weight="duotone" />
              <span><small>正在备份</small><b>{vault.displayName}</b><i>{vault.baseCurrency}</i></span>
            </div>
            <PasswordField
              label="当前应用密码"
              value={form.currentPassword}
              onChange={update("currentPassword")}
              visible={visible}
              onToggle={() => setVisible((value) => !value)}
              autoComplete="current-password"
            />
            <div className="local-backup-password-grid">
              <PasswordField
                label="设置备份密码"
                value={form.backupPassword}
                onChange={update("backupPassword")}
                visible={visible}
                autoComplete="new-password"
              />
              <PasswordField
                label="再次输入备份密码"
                value={form.backupConfirmation}
                onChange={update("backupConfirmation")}
                visible={visible}
                autoComplete="new-password"
              />
            </div>
            <div className="local-account-guardrail">
              <ShieldCheck weight="fill" />
              <span><b>备份密码独立于应用密码</b><small>至少 12 个字符；建议不同于应用密码，并保存在独立密码管理器中。</small></span>
            </div>
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={onClose} disabled={busy}>取消</button>
              <button className="primary" type="submit" disabled={busy}>
                {busy ? "正在生成加密快照…" : "选择位置并导出"} {!busy && <Archive />}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function BackupRestoreModal({
  knownVaults,
  onSelectBackup,
  onInspectBackup,
  onDiscardSelection,
  onConfirmRestore,
  onClose,
}) {
  const [selection, setSelection] = useState(null);
  const [backupPassword, setBackupPassword] = useState("");
  const [inspection, setInspection] = useState(null);
  const [form, setForm] = useState({
    targetVaultId: "",
    targetDisplayName: "",
    newPassword: "",
    newPasswordConfirmation: "",
  });
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const dismiss = useCallback(async () => {
    if (busy) return;
    const token = selection?.selectionToken;
    setBackupPassword("");
    setForm((current) => ({ ...current, newPassword: "", newPasswordConfirmation: "" }));
    if (token) {
      try {
        await onDiscardSelection(token);
      } catch {
        // The selection contains only an opaque native token and expires with the process.
      }
    }
    onClose();
  }, [busy, onClose, onDiscardSelection, selection?.selectionToken]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") void dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismiss]);

  const selectFile = async () => {
    setBusy(true);
    setError("");
    try {
      const selected = await onSelectBackup();
      if (selected.status !== "cancelled") {
        setSelection(selected);
        setInspection(null);
      }
    } catch (selectionError) {
      setError(presentBackupError(selectionError));
    } finally {
      setBusy(false);
    }
  };

  const inspect = async (event) => {
    event.preventDefault();
    const issue = validateBackupInspection(selection, backupPassword);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const inspected = await onInspectBackup({
        selectionToken: selection.selectionToken,
        backupPassword,
      });
      setInspection(inspected);
      setForm({
        targetVaultId: inspected.suggestedVaultId,
        targetDisplayName: `${inspected.displayName} · 恢复`,
        newPassword: "",
        newPasswordConfirmation: "",
      });
    } catch (inspectionError) {
      setError(presentBackupError(inspectionError));
    } finally {
      setBusy(false);
    }
  };

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setError("");
  };

  const restore = async (event) => {
    event.preventDefault();
    const issue = validateBackupRestoreForm(form, inspection, knownVaults);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onConfirmRestore({
        restoreToken: inspection.restoreToken,
        backupPassword,
        targetVaultId: form.targetVaultId.trim(),
        targetDisplayName: form.targetDisplayName.trim(),
        newPassword: form.newPassword,
        confirmedByUser: true,
      });
      setBackupPassword("");
      setForm((current) => ({ ...current, newPassword: "", newPasswordConfirmation: "" }));
      onClose();
    } catch (restoreError) {
      setForm((current) => ({ ...current, newPassword: "", newPasswordConfirmation: "" }));
      setError(presentBackupError(restoreError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="action-modal local-account-modal local-backup-modal" role="dialog" aria-modal="true" aria-labelledby="backup-restore-title">
        <button className="modal-close" onClick={() => void dismiss()} aria-label="关闭备份恢复"><X /></button>
        <div className="action-modal-head">
          <span><UploadSimple weight="duotone" /></span>
          <div>
            <small>{inspection ? "第 2 步 · 创建新数据" : "第 1 步 · 选择并验证"}</small>
            <h2 id="backup-restore-title">从加密备份恢复</h2>
            <p>恢复只会创建一份新数据，不会覆盖、合并或删除这台设备上的现有数据。</p>
          </div>
        </div>

        {!inspection ? (
          <form onSubmit={inspect} className="local-backup-form">
            <button type="button" className={`local-backup-picker${selection ? " selected" : ""}`} onClick={() => void selectFile()} disabled={busy}>
              <FileText weight="duotone" />
              <span>
                <b>{selection?.fileName ?? "选择 .folio-backup 文件"}</b>
                <small>{selection ? `${formatBackupBytes(selection.byteCount)} · ${selection.fingerprint?.slice(0, 12)}…` : "文件路径不会发送到前端界面或外部服务"}</small>
              </span>
              <i>{selection ? "重新选择" : "浏览文件"}</i>
            </button>
            <PasswordField
              label="备份密码"
              value={backupPassword}
              onChange={(value) => { setBackupPassword(value); setError(""); }}
              visible={visible}
              onToggle={() => setVisible((value) => !value)}
              autoComplete="current-password"
            />
            <div className="local-account-guardrail">
              <ShieldCheck weight="fill" />
              <span><b>检查不会写入任何数据</b><small>Folio 会先验证容器认证标签、文件指纹、SQLCipher 完整性和数据关系。</small></span>
            </div>
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => void dismiss()} disabled={busy}>取消</button>
              <button className="primary" type="submit" disabled={busy || !selection}>
                {busy ? "正在验证备份…" : "解密并检查"} {!busy && <ArrowRight />}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={restore} className="local-backup-form">
            <div className="local-backup-inspection">
              <header><ShieldCheck weight="fill" /><span><small>完整性检查通过</small><b>{inspection.displayName}</b><i>{inspection.createdAt.slice(0, 19).replace("T", " ")}</i></span></header>
              <dl>
                <div><dt>账户</dt><dd>{inspection.accountCount}</dd></div>
                <div><dt>持仓</dt><dd>{inspection.holdingCount ?? 0}</dd></div>
                <div><dt>估值快照</dt><dd>{inspection.holdingValuationCount ?? 0}</dd></div>
                <div><dt>产品操作</dt><dd>{inspection.holdingOperationCount ?? 0}</dd></div>
                <div><dt>账本事件</dt><dd>{inspection.ledgerEventCount}</dd></div>
                <div><dt>事项</dt><dd>{inspection.reminderCount}</dd></div>
                <div><dt>基础币种</dt><dd>{inspection.baseCurrency}</dd></div>
              </dl>
            </div>
            <div className="form-grid local-account-form local-backup-restore-form">
              <label>
                <span>新数据标识</span>
                <input value={form.targetVaultId} onChange={update("targetVaultId")} maxLength={64} spellCheck="false" required />
              </label>
              <label>
                <span>新数据名称</span>
                <input value={form.targetDisplayName} onChange={update("targetDisplayName")} maxLength={80} required />
              </label>
            </div>
            <div className="local-backup-password-grid">
              <PasswordField
                label="设置新应用密码"
                value={form.newPassword}
                onChange={(value) => { setForm((current) => ({ ...current, newPassword: value })); setError(""); }}
                visible={visible}
                onToggle={() => setVisible((value) => !value)}
                autoComplete="new-password"
              />
              <PasswordField
                label="再次输入新应用密码"
                value={form.newPasswordConfirmation}
                onChange={(value) => { setForm((current) => ({ ...current, newPasswordConfirmation: value })); setError(""); }}
                visible={visible}
                autoComplete="new-password"
              />
            </div>
            <div className="local-confirm-warning">
              <ShieldCheck weight="duotone" />
              <span><b>确认后创建独立的新数据</b><small>数据库会轮换为新的随机数据密钥；Touch ID 默认关闭，可在恢复成功后重新启用。</small></span>
            </div>
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => { setInspection(null); setError(""); }} disabled={busy}><ArrowLeft /> 返回检查</button>
              <button className="primary" type="submit" disabled={busy}>
                {busy ? "正在恢复并复核…" : "确认创建恢复数据"} {!busy && <Check weight="bold" />}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function LocalPlanning({
  planning,
  dailyChanges = { planning: null },
  accounts = [],
  balances = [],
  holdings = [],
  reminders = [],
  totalMinor,
  baseCurrency,
  now = new Date(),
  onSaveDraft,
  onConfirmDraft,
  onRejectDraft,
  onCreateReminderDraft,
  onUpdateReminderDraft,
  onCompleteReminderDraft,
  onArchiveReminderDraft,
  onConfirmReminderDraft,
  onRejectReminderDraft,
  onGoalCommitted = () => {},
  onCommitted,
}) {
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState(() => createPlanningForm(planning));
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [simulationShift, setSimulationShift] = useState(0);
  const [simulationOpen, setSimulationOpen] = useState(false);
  const [simulationTouched, setSimulationTouched] = useState(false);
  const [goalDialog, setGoalDialog] = useState(undefined);
  const [basisOpen, setBasisOpen] = useState(false);
  const simulationRef = useRef(null);
  const allocations = planning?.allocations ?? [];
  const current = new Map(allocations.map((item) => [item.category, item.targetBps]));
  const journey = useMemo(() => derivePlanningJourney({
    planning,
    accounts,
    balances,
    holdings,
    reminders,
    baseCurrency,
    now,
  }), [accounts, balances, baseCurrency, holdings, now, planning, reminders]);
  const simulated = PLANNING_ALLOCATIONS.map((item) => {
    const original = current.get(item.category) ?? 0;
    if (item.category === "stable") return { ...item, targetBps: original - simulationShift * 100 };
    if (item.category === "equity") return { ...item, targetBps: original + simulationShift * 100 };
    return { ...item, targetBps: original };
  });
  const stable = (current.get("stable") ?? 0) / 100;
  const equity = (current.get("equity") ?? 0) / 100;
  const minimumShift = Math.max(-10, -equity);
  const maximumShift = Math.min(10, stable);
  const updateSimulationShift = (nextValue) => {
    const bounded = Math.max(minimumShift, Math.min(maximumShift, Number(nextValue)));
    setSimulationShift(bounded);
    setSimulationTouched(true);
  };

  useEffect(() => {
    setForm(createPlanningForm(planning));
    setSimulationShift(0);
    setSimulationTouched(false);
  }, [planning]);

  const openEditor = (applySimulation = false) => {
    const nextForm = createPlanningForm(planning);
    if (applySimulation && simulationShift) {
      nextForm.allocations.stable = String((current.get("stable") ?? 0) / 100 - simulationShift);
      nextForm.allocations.equity = String((current.get("equity") ?? 0) / 100 + simulationShift);
    }
    setForm(nextForm);
    setDraft(null);
    setError("");
    setDialog("edit");
  };

  const showSimulation = () => {
    setSimulationOpen(true);
    window.setTimeout(() => {
      simulationRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      simulationRef.current?.querySelector("input")?.focus();
    }, 80);
  };

  const completionCount = [journey.safetyComplete, journey.futureComplete, simulationTouched]
    .filter(Boolean).length;
  const continuePlanning = () => {
    if (!journey.safetyComplete) {
      openEditor();
      return;
    }
    if (!journey.futureComplete) {
      setGoalDialog(null);
      return;
    }
    if (!simulationTouched) {
      showSimulation();
      return;
    }
    openEditor(true);
  };

  const dismiss = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (draft?.draftId) await onRejectDraft(draft.draftId);
      setDialog(null);
      setDraft(null);
      setError("");
    } catch {
      setError("未能安全取消规划草稿，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  const createReview = async (event) => {
    event.preventDefault();
    const issue = validatePlanningForm(form);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = await onSaveDraft(toPlanningDraftInput(form));
      setDraft(next);
      setDialog("review");
    } catch (creationError) {
      setError(creationError?.message ?? "规划草稿生成失败，正式数据没有改变。");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!draft?.draftId || busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirmDraft(draft.draftId);
      setDraft(null);
      setDialog(null);
      onCommitted();
    } catch (confirmationError) {
      setError(confirmationError?.message ?? "确认失败，规划档案没有改变。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`local-planning local-planning-journey ${dailyChanges.planning ? "is-daily-change" : ""}`.trim()}>
      <header className="planning-journey-heading">
        <div>
          <DailyChangeBadge status={dailyChanges.planning} />
          <h2>你的钱，先按使用时间排好</h2>
          <p>先守住日常与应急，再安排一年内目标，最后处理更长远的钱。</p>
        </div>
        <div className="planning-heading-actions">
          <button className="planning-basis-button" type="button" onClick={() => setBasisOpen(true)}>
            查看数据口径 <WarningCircle />
          </button>
          <button className="planning-primary-button" type="button" onClick={continuePlanning}>
            {completionCount === 3 ? "核对规划草稿" : "继续完成规划"} <ArrowRight />
          </button>
        </div>
      </header>

      <div className="planning-journey-layout">
        <div className="planning-stage-stack">
          <section className="planning-stage planning-stage-safety">
            <aside className="planning-stage-label">
              <i>1</i><b>安全底线</b><span>先守住日常<br />与应急</span>
            </aside>
            <article className="planning-stage-card planning-safety-card">
              <div>
                <small>安全底线目标</small>
                <b>{journey.safetyTargetMinor == null
                  ? "待设置"
                  : formatMinorAmount(journey.safetyTargetMinor, baseCurrency)}</b>
                <span>由你确认，不按净资产比例推测</span>
              </div>
              <div>
                <small>可及时支取</small>
                <b>{formatMinorAmount(journey.liquidMinor, baseCurrency)}</b>
                <span>只统计本币现金与储蓄账户</span>
              </div>
              <div className={journey.safetyGapMinor > 0 ? "has-gap" : "covered"}>
                <small>{journey.safetyGapMinor > 0 ? "还差" : "覆盖状态"}</small>
                <b>{journey.safetyGapMinor == null
                  ? "待确认"
                  : journey.safetyGapMinor > 0
                    ? formatMinorAmount(journey.safetyGapMinor, baseCurrency)
                    : "已覆盖"}</b>
                <button type="button" onClick={() => openEditor()}>{journey.safetyComplete ? "调整底线" : "设置底线"}</button>
              </div>
            </article>
          </section>

          <section className="planning-stage planning-stage-future">
            <aside className="planning-stage-label">
              <i>2</i><b>未来 12 个月</b><span>安排一年内<br />确定用款</span>
            </aside>
            <article className="planning-stage-card planning-goals-card">
              <header>
                <div><small>未来 12 个月确定用款</small><b>{journey.goals.length} 项 · {formatMinorAmount(journey.futureNeedMinor, baseCurrency)}</b></div>
              </header>
              {journey.goals.length ? (
                <div className="planning-goal-list">
                  {journey.goals.slice(0, 3).map((goal) => {
                    const GoalIcon = reminderIcon(goal.category);
                    return (
                      <button
                        type="button"
                        key={goal.id}
                        onClick={() => setGoalDialog(goal)}
                        aria-label={`编辑目标 ${goal.title}`}
                      >
                        <span className="planning-goal-icon"><GoalIcon weight="duotone" /></span>
                        <span className="planning-goal-copy"><b>{goal.title}</b><small>{goal.dueOn}</small></span>
                        <span className="planning-goal-progress">
                          <small>可覆盖 {formatMinorAmount(goal.coveredMinor, baseCurrency)} / 目标 {formatMinorAmount(goal.amountMinor, baseCurrency)}</small>
                          <i><em style={{ width: `${goal.coverageBps / 100}%` }} /></i>
                        </span>
                        <strong>{Math.round(goal.coverageBps / 100)}%</strong>
                        <ArrowRight />
                      </button>
                    );
                  })}
                  <button className="planning-goal-add" type="button" onClick={() => setGoalDialog(null)}>
                    <Plus /><span>添加目标</span>
                  </button>
                </div>
              ) : (
                <div className="planning-goal-empty">
                  <CalendarCheck weight="duotone" />
                  <span><b>还没有确认的一年内用款</b><small>添加保费、到期安排或其他一次性目标；每月重复事项不在这里重复计算。</small></span>
                  <button type="button" onClick={() => setGoalDialog(null)}>添加第一项目标</button>
                </div>
              )}
            </article>
          </section>

          <section className="planning-stage planning-stage-longterm">
            <aside className="planning-stage-label">
              <i>3</i><b>长期资金</b><span>规划长期成长<br />让钱更有力</span>
            </aside>
            <article className="planning-stage-card planning-longterm-card" ref={simulationRef}>
              <header>
                <div><small>可用于长期资金的金额（已扣除上方所有安排）</small><b>{journey.longTermAvailableMinor == null ? "暂无法计算" : formatMinorAmount(journey.longTermAvailableMinor, baseCurrency)}</b></div>
                <span>仅试算，不会交易</span>
              </header>
              <div className="planning-allocation-head">
                <span>资产类别</span><span>当前金额与占比</span><span>你的目标位置（你设置的，不是 Folio 推荐）</span>
              </div>
              <div className="planning-allocation-rows">
                {journey.allocationRows.map((row) => {
                  const simulatedTarget = simulated.find((item) => item.category === row.category)?.targetBps ?? row.targetBps;
                  return (
                    <div key={row.category}>
                      <span><i style={{ background: row.color }} />{row.label}</span>
                      <span><b>{formatMinorAmount(row.amountMinor, baseCurrency)}</b><small>{Math.round(row.currentBps / 100)}%</small></span>
                      <span className="planning-target-track">
                        <small>目标 {simulatedTarget / 100}%</small>
                        <i><em style={{ left: `${Math.min(100, Math.max(0, simulatedTarget / 100))}%` }} /></i>
                      </span>
                    </div>
                  );
                })}
              </div>
              {simulationOpen && (
                <div className="planning-amount-simulation">
                  <label>
                    <span><b>金额试算</b><small>从固收类移向权益类，只改变当前页面显示。</small></span>
                    <strong>{simulationShift > 0 ? "+" : ""}{simulationShift}%</strong>
                    <input
                      type="range"
                      min={minimumShift}
                      max={maximumShift}
                      step="1"
                      value={simulationShift}
                      onChange={(event) => updateSimulationShift(event.target.value)}
                    />
                  </label>
                  <div className="planning-simulation-presets" aria-label="试算快捷调整">
                    <button type="button" onClick={() => updateSimulationShift(simulationShift - 5)}>固收 +5%</button>
                    <button type="button" onClick={() => updateSimulationShift(0)}>恢复原目标</button>
                    <button type="button" onClick={() => updateSimulationShift(simulationShift + 5)}>权益 +5%</button>
                  </div>
                  <p><LockKey /> 试算仅比较金额与目标；不构成投资建议，不会交易或改动账本。</p>
                </div>
              )}
              <footer>
                <button type="button" className="secondary" onClick={() => openEditor(simulationTouched)}>调整目标</button>
                <button type="button" onClick={showSimulation}>开始金额试算 <ArrowRight /></button>
              </footer>
            </article>
          </section>
        </div>

        <aside className="planning-next-card">
          <header><div><h3>下一步</h3><p>按顺序完成 3 步，形成你的家庭路线图。</p></div><b>{completionCount}/3 <small>完成进度</small></b></header>
          <div className="planning-next-list">
            <button className={journey.safetyComplete ? "complete" : "active"} type="button" onClick={() => openEditor()}>
              <i>{journey.safetyComplete ? <Check weight="bold" /> : "1"}</i><span><b>补齐必要支出</b><small>确认安全底线金额，不由 Folio 猜测。</small></span><ArrowRight />
            </button>
            <button className={journey.futureComplete ? "complete" : !journey.safetyComplete ? "locked" : "active"} type="button" onClick={() => setGoalDialog(null)}>
              <i>{journey.futureComplete ? <Check weight="bold" /> : "2"}</i><span><b>确认未来用款</b><small>核对一年内确定目标的金额与时间。</small></span><ArrowRight />
            </button>
            <button className={simulationTouched ? "complete" : !journey.futureComplete ? "locked" : "active"} type="button" onClick={showSimulation}>
              <i>{simulationTouched ? <Check weight="bold" /> : "3"}</i><span><b>开始金额试算</b><small>查看长期资金分配后的金额结果。</small></span><ArrowRight />
            </button>
          </div>
          <button className="planning-next-primary" type="button" onClick={continuePlanning}>
            {completionCount === 3 ? "核对规划草稿" : "继续完成规划"} <ArrowRight />
          </button>
          <small><ShieldCheck weight="duotone" /> 模拟器仅试算，不会交易</small>
        </aside>
      </div>

      {dialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) void dismiss();
        }}>
          <section className="local-planning-modal" role="dialog" aria-modal="true" aria-labelledby="planning-modal-title">
            <button className="modal-close" type="button" onClick={() => void dismiss()} disabled={busy} aria-label="关闭规划设置"><X /></button>
            {dialog === "edit" ? (
              <form onSubmit={createReview}>
                <header><span><ChartDonut weight="duotone" /></span><div><small>第一步 · 填写路线图</small><h2 id="planning-modal-title">设置安全底线与长期目标</h2><p>填写后只生成核对草稿，不会自动保存或发起交易。</p></div></header>
                <label><span>规划名称</span><input value={form.name} maxLength={80} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
                <label><span>安全底线金额（{baseCurrency}）</span><input inputMode="decimal" value={form.cashBuffer} onChange={(event) => setForm({ ...form, cashBuffer: event.target.value })} /><small>请依据你确认的必要支出填写；Folio 不会自动推测。</small></label>
                <fieldset>
                  <legend>长期目标配置（合计必须为 100%）</legend>
                  {PLANNING_ALLOCATIONS.map((item) => (
                    <label key={item.category}>
                      <span><i style={{ background: item.color }} />{item.label}</span>
                      <div><input inputMode="decimal" value={form.allocations[item.category]} onChange={(event) => setForm({
                        ...form,
                        allocations: { ...form.allocations, [item.category]: event.target.value },
                      })} /><b>%</b></div>
                    </label>
                  ))}
                </fieldset>
                <label><span>备注（可选）</span><textarea value={form.notes} maxLength={1000} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
                {error && <p className="local-form-error"><WarningCircle weight="fill" />{error}</p>}
                <footer><button type="button" onClick={() => void dismiss()} disabled={busy}>取消</button><button type="submit" disabled={busy}>生成核对草稿 <ArrowRight /></button></footer>
              </form>
            ) : (
              <div className="local-planning-review">
                <header><span><ShieldCheck weight="duotone" /></span><div><small>第二步 · 明确确认</small><h2 id="planning-modal-title">核对规划路线图</h2><p>确认只更新规划档案，不会调仓、交易或改余额。</p></div></header>
                <div className="local-planning-review-main">
                  <span>现金安全垫</span>
                  <b>{formatMinorAmount(draft.cashBufferMinor, draft.baseCurrency)}</b>
                </div>
                <div className="local-planning-review-list">
                  {draft.allocations.map((item) => (
                    <span key={item.category}>
                      {PLANNING_ALLOCATIONS.find((meta) => meta.category === item.category)?.label}
                      <b>{item.targetBps / 100}%</b>
                    </span>
                  ))}
                </div>
                <p className="local-review-guard"><LockKey /> 点击“明确确认”前，正式规划数据保持不变。</p>
                {error && <p className="local-form-error"><WarningCircle weight="fill" />{error}</p>}
                <footer><button type="button" onClick={() => void dismiss()} disabled={busy}>放弃草稿</button><button type="button" onClick={confirm} disabled={busy}><Check weight="bold" /> 明确确认</button></footer>
              </div>
            )}
          </section>
        </div>
      )}

      {basisOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setBasisOpen(false);
        }}>
          <section className="planning-basis-modal" role="dialog" aria-modal="true" aria-labelledby="planning-basis-title">
            <button className="modal-close" type="button" onClick={() => setBasisOpen(false)} aria-label="关闭数据口径"><X /></button>
            <header><span><ShieldCheck weight="duotone" /></span><div><small>透明计算</small><h2 id="planning-basis-title">这页怎样使用你的数据</h2><p>只使用已确认的本地数据；缺失信息会提示补充，不由模型猜测。</p></div></header>
            <dl>
              <div><dt>安全底线</dt><dd>使用你明确确认的金额，不按净资产比例自动生成。</dd></div>
              <div><dt>可及时支取</dt><dd>仅统计 {baseCurrency} 现金与储蓄账户，当前为 {formatMinorAmount(journey.liquidMinor, baseCurrency)}。</dd></div>
              <div><dt>未来用款</dt><dd>仅纳入未来 365 天已确认、非每月重复且金额完整的事项。</dd></div>
              <div><dt>长期资金</dt><dd>可及时支取减去安全底线、未来用款与已确认负债；不足时按 0 显示。</dd></div>
              <div><dt>明确排除</dt><dd>房产、保险保障、外币与未归类资产不进入长期配置分母；持仓价值不重复计入。</dd></div>
              <div><dt>家庭净资产</dt><dd>{formatMinorAmount(totalMinor, baseCurrency)} 仅作全局参考，不直接决定安全底线。</dd></div>
            </dl>
            <p><LockKey /> 页面试算不构成投资建议，也不会创建交易或改动账本。</p>
            <footer><button type="button" onClick={() => setBasisOpen(false)}>我知道了</button></footer>
          </section>
        </div>
      )}

      {goalDialog !== undefined && (
        <LocalReminderModal
          key={goalDialog?.id ?? "new-planning-goal"}
          reminder={goalDialog}
          accounts={accounts}
          baseCurrency={baseCurrency}
          planningGoal
          onCreateDraft={onCreateReminderDraft}
          onUpdateDraft={onUpdateReminderDraft}
          onCompleteDraft={onCompleteReminderDraft}
          onArchiveDraft={onArchiveReminderDraft}
          onConfirmDraft={onConfirmReminderDraft}
          onRejectDraft={onRejectReminderDraft}
          onCommitted={(action, nextDueOn) => {
            onGoalCommitted(action, nextDueOn);
            setGoalDialog(undefined);
          }}
          onClose={() => setGoalDialog(undefined)}
        />
      )}
    </section>
  );
}

function LocalFinanceHub({ activeTab, onTabChange, children }) {
  return (
    <section className="local-finance-hub" aria-label="资产与流水">
      <div className="finance-hub-tabs" role="tablist" aria-label="切换资产与流水">
        {[
          { id: "assets", label: "资产" },
          { id: "cashflow", label: "流水" },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={activeTab === item.id}
            className={activeTab === item.id ? "active" : ""}
            onClick={() => onTabChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="local-finance-hub-content" role="tabpanel">
        {children}
      </div>
    </section>
  );
}

function LocalProfile({ vault, biometric, syncStatus, onNavigate }) {
  const profileActions = [
    {
      label: "应用密码与生物识别",
      detail: biometric?.available ? (biometric.enabled ? "生物识别已启用" : "可在本机启用") : "应用密码保护",
      icon: LockKey,
      target: "settings",
    },
    {
      label: "本地数据",
      detail: syncStatus?.enabled ? "端到端密文同步已开启" : "仅保存在此设备",
      icon: Vault,
      target: "settings",
    },
    {
      label: "导入与导出",
      detail: "Markdown、文件与数据迁移",
      icon: UploadSimple,
      target: "settings",
    },
    {
      label: "QQ 邮箱",
      detail: "只读账单连接与待核对记录",
      icon: EnvelopeSimple,
      target: "settings",
    },
    {
      label: "偏好设置",
      detail: "提醒、模型与显示偏好",
      icon: Gear,
      target: "settings",
    },
  ];

  return (
    <section className="local-profile-page" aria-labelledby="local-profile-name">
      <article className="local-profile-hero">
        <img src="/assets/brand/folio-cat-avatar.png" alt="被子beizi 的猫猫头像" />
        <div>
          <h2 id="local-profile-name">被子beizi</h2>
          <p><ShieldCheck weight="fill" /> 本地数据已保护</p>
          <small>{vault.displayName}</small>
        </div>
      </article>

      <div className="local-profile-menu">
        {profileActions.map(({ label, detail, icon: Icon, target }) => (
          <button key={label} type="button" onClick={() => onNavigate(target)}>
            <span className="local-profile-menu-icon"><Icon weight="regular" /></span>
            <span className="local-profile-menu-copy"><b>{label}</b><small>{detail}</small></span>
            <ArrowRight />
          </button>
        ))}
        <button type="button" className="assistant-entry" onClick={() => onNavigate("assistant")}>
          <span className="local-profile-menu-icon"><Sparkle weight="regular" /></span>
          <span className="local-profile-menu-copy"><b>我的助手</b><small>仅整理，确认后写入</small></span>
          <ArrowRight />
        </button>
      </div>
    </section>
  );
}

function LocalModule({ active }) {
  const copy = {
    cashflow: ["追加式流水", "确认后的收入、支出和转账只追加事件，不会覆盖历史。", Receipt],
    planning: ["配置规划", "规划与模拟沙盘和真实账本保持明确分离。", ChartDonut],
    reminders: ["财务事项", "租金、保险、到期和闲置资金都以事项形式管理。", CalendarBlank],
  };
  const [title, description, Icon] = copy[active] ?? copy.cashflow;
  return (
    <section className="local-module-card">
      <div className="local-module-icon"><Icon weight="duotone" /></div>
      <span>真实数据模式</span>
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  );
}

function LocalSecuritySettings({
  snapshot,
  accounts,
  localRepository,
  biometric,
  vault,
  syncConfigured,
  syncController,
  syncStatus,
  onSyncStatusChange,
  onListSyncConflicts,
  onInspectSyncConflict,
  onKeepLocalSyncConflict,
  knownVaults,
  onCreateBackup,
  onCreateDataExport,
  onImportMarkdown,
  onExportMarkdown,
  onClearAllData,
  onSelectBackup,
  onInspectBackup,
  onDiscardBackupSelection,
  onConfirmBackupRestore,
  notificationStatus,
  codexCliStatus,
  onRefreshCodexCliStatus,
  modelProviderStatus,
  onRefreshModelProvider,
  onConfigureModelProvider,
  onRemoveModelProvider,
  onTestModelProvider,
  onConfirmEmailDraft,
  onRejectEmailDraft,
  onEnableNotifications,
  onDisableNotifications,
  onEnableBiometric,
  onDisableBiometric,
  onChangePassword,
  onFullReimportReady,
}) {
  const [dialog, setDialog] = useState(null);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const [notificationPrivacyChoice, setNotificationPrivacyChoice] = useState(
    notificationStatus.privacyMode ?? "generic",
  );
  useEffect(() => {
    setNotificationPrivacyChoice(notificationStatus.privacyMode ?? "generic");
  }, [notificationStatus.privacyMode]);
  const permissionLabels = {
    not_determined: "等待授权",
    denied: "系统已拒绝",
    authorized: "系统已允许",
    provisional: "临时允许",
    ephemeral: "本次允许",
    unsupported: "设备不支持",
  };
  const emailSourceAvailable = Boolean(localRepository);
  const updateNotifications = async (operation) => {
    setNotificationBusy(true);
    setNotificationError("");
    try {
      await operation();
    } catch (nextError) {
      setNotificationError(presentVaultError(nextError));
    } finally {
      setNotificationBusy(false);
    }
  };
  return (
    <section className="local-security-settings">
      <div className="local-security-heading">
        <div className="local-module-icon"><Gear weight="duotone" /></div>
        <span>设置</span>
        <h2>简单、清楚地管理 Folio</h2>
        <p>财务数据默认只保存在本机；{APPLE_BIOMETRIC_LABEL} 不可用时，仍可使用应用密码解锁。</p>
      </div>
      <div className="local-security-grid">
        <article>
          <Fingerprint weight="duotone" />
          <span><small>快捷解锁</small><b>{APPLE_BIOMETRIC_LABEL}</b></span>
          <i className={biometric.enabled ? "enabled" : ""}>
            {biometric.enabled ? "已启用" : biometric.available ? "未启用" : "不可用"}
          </i>
          <p>生物识别由 {APPLE_BIOMETRIC_SYSTEM} 完成，Folio 不接收或保存面容、指纹数据。</p>
          {biometric.available && (
            <button
              className="local-security-card-action"
              onClick={() => setDialog("biometric")}
            >
              {biometric.enabled ? "管理或关闭" : "验证密码并启用"}
              <ArrowRight />
            </button>
          )}
        </article>
        <article>
          <LockKey weight="duotone" />
          <span><small>安全回退</small><b>应用密码</b></span>
          <i className="enabled">始终可用</i>
          <p>密码只用于解封本地数据密钥，不会写入数据库或源码仓库。</p>
          <button
            className="local-security-card-action"
            onClick={() => setDialog("password")}
          >
            验证并修改密码
            <ArrowRight />
          </button>
        </article>
        <article>
          <ShieldCheck weight="duotone" />
          <span><small>锁定方式</small><b>手动锁定</b></span>
          <i className="enabled">由你控制</i>
          <p>临时离开时点击右上角“锁定”，资产信息会立即隐藏，但不会删除任何数据；解锁后会回到刚才的模块。</p>
        </article>
        <article>
          <Vault weight="duotone" />
          <span><small>本地数据</small><b>设备内加密</b></span>
          <i className="enabled">已保护</i>
          <p>财务数据保存在这台设备，并由应用密码保护。</p>
        </article>
      </div>
      <div className="local-backup-heading local-data-heading">
        <span>数据管理</span>
        <h3>新增资料、全量重录与导出</h3>
        <p>新增变化不会替换旧账；全量重录会先导出旧数据并验证密码，再从空白状态重新导入。</p>
      </div>
      <div className="local-backup-actions local-data-management-actions">
        <button onClick={onImportMarkdown}>
          <UploadSimple weight="duotone" />
          <span><b>新增或导入资料</b><small>日常新增流水、事项、估值，或为空白 Folio 导入全量 Markdown。</small></span>
          <ArrowRight />
        </button>
        <button onClick={onExportMarkdown} disabled={(snapshot?.accounts?.length ?? 0) === 0}>
          <FileText weight="duotone" />
          <span><b>导出 Markdown</b><small>{(snapshot?.accounts?.length ?? 0) === 0 ? "当前没有可导出的财务数据。" : "把当前账户、持仓、流水与事项导出为 .md。"}</small></span>
          <ArrowRight />
        </button>
        <button className="danger" onClick={() => setDialog("clear-data")}>
          <Trash weight="duotone" />
          <span><b>清空 Folio 数据</b><small>删除当前财务数据；需要再次确认并输入应用密码。</small></span>
          <ArrowRight />
        </button>
        {(snapshot?.accounts?.length ?? 0) > 0 && (
          <button className="replace" onClick={onFullReimportReady}>
            <Table weight="duotone" />
            <span><b>重新录入全量数据</b><small>导出当前 Markdown，验证密码清空，再选择新的完整快照。</small></span>
            <ArrowRight />
          </button>
        )}
      </div>
      <div className="local-backup-note"><ShieldCheck /><span><b>清空前建议先导出 Markdown</b><small>导出的文件由你自行保管；Folio 不会自动上传。</small></span></div>
      <div className="local-backup-heading local-model-heading">
        <span>自动数据源</span>
        <h3>QQ 邮箱信用卡流水</h3>
        <p>只读检查白名单邮件，原文不落库；识别结果先进入待核对草稿，必须由你确认后才写账。</p>
      </div>
      <div className="local-sync-settings-card local-email-source-card">
        <div>
          <EnvelopeSimple weight="duotone" />
          <span>
            <small>QQ Mail · IMAPS 只读</small>
            <b>每日消费邮件 → 待核对流水</b>
            <em>授权码存入 macOS Keychain · 不保存邮件正文</em>
          </span>
        </div>
        <button type="button" onClick={() => setDialog("email-source")}>
          {emailSourceAvailable ? "连接或管理" : "仅桌面 App 可连接"}
          <ArrowRight />
        </button>
      </div>
      <div className="local-backup-heading local-model-heading">
        <span>{IS_APPLE_MOBILE_RUNTIME ? "iPhone AI" : "独立运行 AI"}</span>
        <h3>兼容模型连接</h3>
        <p>{IS_APPLE_MOBILE_RUNTIME
          ? "iPhone 不依赖 Mac 或 Codex CLI。可使用 OpenAI，或由环境变量指定兼容 Responses API 的 HTTPS 服务。"
          : "可直接用设备 Keychain 中的 OpenAI Key；本地调试也可读取环境变量中的兼容模型 Key、模型名和 Base URL。"}</p>
      </div>
      <div className="local-sync-settings-card local-model-provider-card">
        <div className={modelProviderStatus.configured ? "enabled" : ""}>
          <Sparkle weight="duotone" />
          <span>
            <small>Responses API 兼容连接 · store:false</small>
            <b>{modelProviderStatus.configured ? "已配置，可在 iPhone 独立解析" : "尚未配置"}</b>
            <em>
              {modelProviderStatus.configured
                ? `${modelProviderStatus.model} · ${modelProviderStatus.credentialSource === "environment" ? "环境变量" : "设备 Keychain"}`
                : "填写 OpenAI API Key，或在启动进程中提供 FOLIO_LLM_* 环境变量。"}
            </em>
          </span>
        </div>
        <button type="button" onClick={() => setDialog("model-provider")}>
          {modelProviderStatus.configured ? "管理连接" : "配置连接"}
          <ArrowRight />
        </button>
      </div>
      {!IS_APPLE_MOBILE_RUNTIME && <>
        <div className="local-backup-heading local-model-heading">
          <span>Mac 客户演示 AI</span>
          <h3>本机 Codex CLI</h3>
          <p>沿用这台 Mac 的 ChatGPT 登录，不需要单独填写 API Key。每次解析都由你主动触发，模型不能确认写账。</p>
        </div>
        <div className="local-sync-settings-card local-model-provider-card">
          <div className={codexCliStatus.ready ? "enabled" : ""}>
            <Sparkle weight="duotone" />
            <span>
              <small>Codex CLI · ChatGPT 登录</small>
              <b>{codexCliStatus.ready ? "已连接 ChatGPT 登录" : "当前不可用"}</b>
              <em>
                {codexCliStatus.ready
                  ? `${codexCliStatus.version ?? "Codex CLI"} · 文本会发送到 Codex；原始音频和文件留在本机`
                  : codexCliStatus.message}
              </em>
            </span>
          </div>
          <button type="button" onClick={() => void onRefreshCodexCliStatus()}>
            重新检查
            <ArrowRight />
          </button>
        </div>
      </>}
      <div className="local-backup-heading local-notification-heading">
        <span>设备通知</span>
        <h3>到期事项的系统通知</h3>
        <p>“本机提醒”就是由这台 Mac 或手机按事项日期发出的系统通知，不是 AI 消息，也不会读取邮箱或自动执行付款。</p>
      </div>
      <div className="local-notification-panel">
        <div className="local-notification-summary">
          <Bell weight="duotone" />
          <span>
            <small>只排程你已确认的财务事项</small>
            <b>{notificationStatus.enabled ? "已启用本机提醒" : "本机提醒未启用"}</b>
            <em>
              {permissionLabels[notificationStatus.permission] ?? notificationStatus.permission}
              {notificationStatus.enabled ? ` · 已排程 ${notificationStatus.scheduledCount ?? 0} 项` : ""}
            </em>
          </span>
          <i className={notificationStatus.enabled ? "enabled" : ""}>
            {notificationStatus.enabled ? "运行中" : "关闭"}
          </i>
        </div>
        <div className="local-notification-privacy" role="group" aria-label="锁屏通知内容">
          <span><b>锁屏显示内容</b><small>“仅通用提示”最安全；事项标题可能被身边的人看到。</small></span>
          <button
            className={notificationPrivacyChoice !== "title" ? "active" : ""}
            disabled={notificationBusy || !notificationStatus.supported}
            onClick={() => {
              setNotificationPrivacyChoice("generic");
              if (notificationStatus.enabled) {
                updateNotifications(() => onEnableNotifications("generic"));
              }
            }}
          >
            仅通用提示
          </button>
          <button
            className={notificationPrivacyChoice === "title" ? "active" : ""}
            disabled={notificationBusy || !notificationStatus.supported}
            onClick={() => {
              setNotificationPrivacyChoice("title");
              if (notificationStatus.enabled) {
                updateNotifications(() => onEnableNotifications("title"));
              }
            }}
          >
            显示事项标题
          </button>
        </div>
        <div className="local-notification-actions">
          {notificationStatus.enabled ? (
            <button
              disabled={notificationBusy}
              onClick={() => updateNotifications(onDisableNotifications)}
            >
              关闭本机提醒
            </button>
          ) : (
            <button
              className="primary"
              disabled={notificationBusy || !notificationStatus.supported}
              onClick={() => updateNotifications(
                () => onEnableNotifications(notificationPrivacyChoice),
              )}
            >
              {notificationBusy ? "正在请求系统授权…" : "允许本机通知"}
            </button>
          )}
          <small>
            每项提醒按“到期日前 N 天”在本地上午 {notificationStatus.deliveryHour ?? 9}:00 排程；
            错过的时间不会补发突袭通知。
          </small>
        </div>
        {notificationStatus.permission === "denied" && (
          <p className="local-notification-warning">
            macOS 已拒绝通知权限。请在“系统设置 → 通知 → Folio”中允许后，再返回重新启用。
          </p>
        )}
        {notificationError && <VaultError message={notificationError} />}
      </div>
      {dialog === "clear-data" && (
        <ClearAllDataModal
          vault={vault}
          onClearAllData={onClearAllData}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "biometric" && (
        <BiometricSettingsModal
          vault={vault}
          biometric={biometric}
          onEnable={onEnableBiometric}
          onDisable={onDisableBiometric}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "password" && (
        <PasswordChangeModal
          vault={vault}
          biometric={biometric}
          onChange={onChangePassword}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "email-source" && (
        <EmailSourceSettingsModal
          accounts={accounts}
          repository={localRepository}
          onConfirmDraft={onConfirmEmailDraft}
          onRejectDraft={onRejectEmailDraft}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "model-provider" && (
        <ModelProviderSettingsModal
          initialStatus={modelProviderStatus}
          onRefresh={onRefreshModelProvider}
          onConfigure={onConfigureModelProvider}
          onRemove={onRemoveModelProvider}
          onTest={onTestModelProvider}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}

function EmailSourceSettingsModal({
  accounts,
  repository,
  onConfirmDraft,
  onRejectDraft,
  onClose,
}) {
  const eligibleAccounts = accounts.filter((account) => !account.archivedAt);
  const [sources, setSources] = useState([]);
  const [form, setForm] = useState({
    emailAddress: "",
    authorizationCode: "",
    accountId: eligibleAccounts.find((item) => item.accountType === "credit_card")?.id
      ?? eligibleAccounts[0]?.id
      ?? "",
    mailbox: "INBOX",
    allowedSenders: "cmbchina.com",
    subjectKeywords: "消费提醒, 交易提醒, 退款",
  });
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [draftStates, setDraftStates] = useState({});

  const refresh = useCallback(async () => {
    if (!repository) {
      setSources([]);
      return [];
    }
    const items = await repository.listEmailSources();
    setSources(items);
    return items;
  }, [repository]);

  useEffect(() => {
    let cancelled = false;
    refresh().catch((nextError) => {
      if (!cancelled) setError(presentVaultError(nextError));
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const splitRules = (value) => value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

  const configure = async (event) => {
    event.preventDefault();
    if (!repository) {
      setError("邮箱数据源仅在已解锁的桌面应用中可配置。");
      return;
    }
    if (!acknowledged) {
      setError("请先确认邮箱授权码与待核对写账边界。");
      return;
    }
    setBusy("configure");
    setError("");
    setResult(null);
    try {
      await repository.configureEmailSource({
        emailAddress: form.emailAddress,
        authorizationCode: form.authorizationCode,
        accountId: form.accountId,
        mailbox: form.mailbox,
        allowedSenders: splitRules(form.allowedSenders),
        subjectKeywords: splitRules(form.subjectKeywords),
      });
      setForm((current) => ({ ...current, authorizationCode: "" }));
      await refresh();
    } catch (nextError) {
      setForm((current) => ({ ...current, authorizationCode: "" }));
      setError(presentVaultError(nextError));
    } finally {
      setBusy("");
    }
  };

  const run = async (kind, sourceId) => {
    if (!repository) {
      setError("邮箱数据源服务尚未连接。");
      return;
    }
    setBusy(`${kind}:${sourceId}`);
    setError("");
    setResult(null);
    try {
      const next = kind === "test"
        ? await repository.testEmailSource(sourceId)
        : await repository.syncEmailSource(sourceId);
      setResult({ kind, ...next });
      await refresh();
    } catch (nextError) {
      setError(presentVaultError(nextError));
    } finally {
      setBusy("");
    }
  };

  const remove = async (sourceId) => {
    if (!repository) {
      setError("邮箱数据源服务尚未连接。");
      return;
    }
    setBusy(`remove:${sourceId}`);
    setError("");
    try {
      await repository.removeEmailSource(sourceId);
      setResult(null);
      await refresh();
    } catch (nextError) {
      setError(presentVaultError(nextError));
    } finally {
      setBusy("");
    }
  };

  const resolveDraft = async (draftId, action) => {
    setBusy(`${action}:${draftId}`);
    setError("");
    try {
      if (action === "confirm") await onConfirmDraft(draftId);
      else await onRejectDraft(draftId);
      setDraftStates((current) => ({
        ...current,
        [draftId]: action === "confirm" ? "confirmed" : "rejected",
      }));
      await refresh();
    } catch (nextError) {
      setError(presentVaultError(nextError));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="action-modal local-account-modal local-model-provider-modal email-source-modal" role="dialog" aria-modal="true" aria-labelledby="email-source-title">
        <button className="modal-close" type="button" onClick={onClose} disabled={Boolean(busy)} aria-label="关闭邮箱数据源设置"><X /></button>
        <header className="action-modal-head">
          <span><EnvelopeSimple weight="duotone" /></span>
          <div>
            <small>只读数据源 · 先核对后写账</small>
            <h2 id="email-source-title">QQ 邮箱信用卡流水</h2>
            <p>先读取发件人和主题；只有命中白名单后才取正文。原始邮件不会写入 Folio 数据库。</p>
          </div>
        </header>

        <div className="email-source-onboarding">
          <span><b>1</b><small>在 QQ 邮箱网页版打开“设置 → 账户”，开启 IMAP/SMTP。</small></span>
          <span><b>2</b><small>生成第三方客户端授权码。它不是 QQ 邮箱登录密码。</small></span>
          <span><b>3</b><small>在下方填写邮箱、授权码并关联 Folio 中的信用卡账户。</small></span>
          <a href="https://mail.qq.com/" target="_blank" rel="noreferrer">打开 QQ 邮箱 <ArrowRight /></a>
        </div>

        {sources.length > 0 && (
          <div className="email-source-list">
            {sources.map((source) => (
              <article key={source.id}>
                <EnvelopeSimple weight="duotone" />
                <span>
                  <b>{source.emailAddressMasked}</b>
                  <small>{source.accountName} · {source.mailbox} · UID {source.lastUid}</small>
                  <em>待核对 {source.pendingCount} · 隔离 {source.quarantinedCount}</em>
                </span>
                <div>
                  <button type="button" disabled={Boolean(busy)} onClick={() => run("test", source.id)}>
                    {busy === `test:${source.id}` ? "测试中…" : "测试连接"}
                  </button>
                  <button className="primary" type="button" disabled={Boolean(busy)} onClick={() => run("sync", source.id)}>
                    {busy === `sync:${source.id}` ? "同步中…" : "读取新邮件"}
                  </button>
                  <button type="button" disabled={Boolean(busy)} onClick={() => remove(source.id)}>停用</button>
                </div>
              </article>
            ))}
          </div>
        )}

        {result?.kind === "test" && (
          <div className="email-source-result success">
            <ShieldCheck weight="fill" />
            <span><b>只读连接成功</b><small>{result.mailbox} · 当前 {result.exists} 封邮件 · 未修改已读状态</small></span>
          </div>
        )}

        {result?.kind === "sync" && (
          <div className="email-source-sync-result">
            <div className="email-source-result success">
              <ListChecks weight="fill" />
              <span>
                <b>已检查 {result.examinedCount} 封，生成 {result.createdDraftCount} 条待核对流水</b>
                <small>命中 {result.matchedCount} · 重复 {result.duplicateCount} · 隔离 {result.quarantinedCount}</small>
              </span>
            </div>
            {result.drafts?.map(({ draft }) => {
              const state = draftStates[draft.draftId] ?? "needs_review";
              return (
                <article key={draft.draftId}>
                  <span>
                    <b>{draft.description}</b>
                    <small>{draft.occurredOn} · {draft.accountName}</small>
                  </span>
                  <strong>{formatMinorAmount(
                    draft.transactionKind === "expense" ? -draft.amountMinor : draft.amountMinor,
                    draft.currency,
                  )}</strong>
                  {state === "needs_review" ? (
                    <div>
                      <button type="button" disabled={Boolean(busy)} onClick={() => resolveDraft(draft.draftId, "reject")}>拒绝</button>
                      <button className="primary" type="button" disabled={Boolean(busy)} onClick={() => resolveDraft(draft.draftId, "confirm")}>确认写账</button>
                    </div>
                  ) : <i>{state === "confirmed" ? "已确认" : "已拒绝"}</i>}
                </article>
              );
            })}
          </div>
        )}

        <form onSubmit={configure}>
          <div className="email-source-form-grid">
            <label><span>QQ 邮箱</span><input type="email" autoComplete="username" value={form.emailAddress} onChange={(event) => setForm({ ...form, emailAddress: event.target.value })} placeholder="name@qq.com" /></label>
            <label><span>IMAP 授权码（不是邮箱密码）</span><input type="password" autoComplete="new-password" value={form.authorizationCode} onChange={(event) => setForm({ ...form, authorizationCode: event.target.value })} /></label>
            <label><span>关联信用卡账户</span><select value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value })}>{eligibleAccounts.map((account) => <option key={account.id} value={account.id}>{account.displayName} · {account.institutionName}</option>)}</select></label>
            <label><span>邮箱文件夹</span><input value={form.mailbox} onChange={(event) => setForm({ ...form, mailbox: event.target.value })} /></label>
            <label><span>允许的发件人域名</span><input value={form.allowedSenders} onChange={(event) => setForm({ ...form, allowedSenders: event.target.value })} placeholder="cmbchina.com" /></label>
            <label><span>主题关键词</span><input value={form.subjectKeywords} onChange={(event) => setForm({ ...form, subjectKeywords: event.target.value })} /></label>
          </div>
          <label className="model-provider-consent">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            <span><b>我确认使用 QQ 邮箱 IMAP 授权码</b><small>连接保持只读；任何识别结果都必须再次人工确认才能写入账本。</small></span>
          </label>
          {error && <VaultError message={error} />}
          <footer>
            <button type="button" className="secondary" onClick={onClose} disabled={Boolean(busy)}>关闭</button>
            <button type="submit" className="primary" disabled={Boolean(busy) || eligibleAccounts.length === 0 || !repository}>
              {busy === "configure" ? "正在保存…" : sources.length ? "添加另一个邮箱" : "保存并连接"} <LockKey />
            </button>
          </footer>
          {eligibleAccounts.length === 0 && (
            <p className="local-notification-warning">请先在“资产”中添加信用卡账户，再回来关联邮件流水。</p>
          )}
          {!repository && (
            <p className="local-notification-warning">网页预览不读取邮箱。请在已解锁的 macOS App 中完成授权。</p>
          )}
        </form>
      </section>
    </div>
  );
}

function ModelProviderSettingsModal({
  initialStatus,
  onRefresh,
  onConfigure,
  onRemove,
  onTest,
  onClose,
}) {
  const [status, setStatus] = useState(initialStatus);
  const [apiKey, setApiKey] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(onRefresh())
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((nextError) => {
        if (!cancelled) setError(presentVaultError(nextError));
      });
    return () => {
      cancelled = true;
    };
  }, [onRefresh]);

  const save = async (event) => {
    event.preventDefault();
    if (!acknowledged) {
      setError("请先确认密钥保存位置与外部数据边界。");
      return;
    }
    setBusy("save");
    setError("");
    setTestResult(null);
    try {
      const next = await onConfigure(apiKey);
      setApiKey("");
      setStatus(next);
    } catch (nextError) {
      setApiKey("");
      setError(presentVaultError(nextError));
    } finally {
      setBusy("");
    }
  };

  const testConnection = async () => {
    if (!acknowledged) {
      setError("连接测试会向外部模型发送固定测试语句，请先确认本次授权。");
      return;
    }
    setBusy("test");
    setError("");
    setTestResult(null);
    try {
      const result = await onTest();
      setTestResult(result);
      setStatus(await onRefresh());
    } catch (nextError) {
      setError(presentVaultError(nextError));
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    setBusy("remove");
    setError("");
    setTestResult(null);
    try {
      setStatus(await onRemove());
      setApiKey("");
    } catch (nextError) {
      setError(presentVaultError(nextError));
    } finally {
      setBusy("");
    }
  };

  const usesEnvironment = status.credentialSource === "environment";
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="action-modal local-account-modal local-model-provider-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-provider-title"
      >
        <button className="modal-close" onClick={onClose} aria-label="关闭 AI 模型设置">
          <X />
        </button>
        <div className="action-modal-head">
          <span><Sparkle weight="duotone" /></span>
          <div>
            <small>外部模型 · 原生安全网关</small>
            <h2 id="model-provider-title">配置兼容模型</h2>
            <p>界面输入的 OpenAI Key 只保存在{IS_APPLE_MOBILE_RUNTIME ? "这台 iPhone" : "这台设备"}的 Keychain；本地环境变量也可指定兼容 Responses API。原始音频和文件不会发送给模型。</p>
          </div>
        </div>
        <div className="local-model-provider-status">
          <span>
            <small>当前状态</small>
            <b>{status.configured ? "已配置" : "未配置"}</b>
            <i className={status.configured ? "enabled" : ""}>
              {usesEnvironment
                ? "环境变量"
                : status.credentialSource === "keychain"
                  ? IS_APPLE_MOBILE_RUNTIME ? "iOS Keychain" : "macOS Keychain"
                  : "本地规则"}
            </i>
          </span>
          <span>
            <small>默认模型</small>
            <b>{status.model}</b>
            <i>Responses API · store:false</i>
          </span>
        </div>
        {!usesEnvironment && (
          <form className="local-backup-form" onSubmit={save}>
            <label className="settings-field">
              <span>OpenAI API Key</span>
              <input
                type="password"
                value={apiKey}
                autoComplete="off"
                placeholder={status.configured ? "输入新 Key 以替换" : "sk-…"}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setError("");
                }}
              />
            </label>
            <button
              className="primary local-model-save"
              type="submit"
              disabled={busy !== "" || apiKey.trim().length < 20}
            >
              {busy === "save" ? "正在写入 Keychain…" : status.configured ? "替换设备密钥" : "保存到设备 Keychain"}
            </button>
          </form>
        )}
        {usesEnvironment && (
          <div className="local-confirm-warning">
            <ShieldCheck weight="duotone" />
            <span>
              <b>已检测到环境变量模型连接</b>
              <small>支持 FOLIO_LLM_API_KEY / MODEL / BASE_URL；服务必须兼容 Responses API。Finder 启动的正式 App 通常不会继承终端变量。</small>
            </span>
          </div>
        )}
        <label className="local-backup-acknowledgement">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => {
              setAcknowledged(event.target.checked);
              setError("");
            }}
          />
            <span>
              <b>我理解外部模型的数据边界</b>
              <small>连接测试只发送固定探针；解析只发送当前核对文字，不包含原始录音或文件。</small>
          </span>
        </label>
        {testResult && (
          <div className="local-confirm-warning">
            <Check weight="bold" />
            <span>
              <b>连接测试通过</b>
              <small>{testResult.model} · {testResult.credentialSource === "environment" ? "环境变量" : "Keychain"}</small>
            </span>
          </div>
        )}
        {error && <VaultError message={error} />}
        <div className="modal-actions local-model-actions">
          {status.configured && !usesEnvironment && (
            <button type="button" className="secondary" onClick={remove} disabled={busy !== ""}>
              {busy === "remove" ? "正在移除…" : "移除设备密钥"}
            </button>
          )}
          <button type="button" className="secondary" onClick={onClose} disabled={busy !== ""}>
            关闭
          </button>
          <button
            type="button"
            className="primary"
            onClick={testConnection}
            disabled={!status.configured || busy !== ""}
          >
            {busy === "test" ? "正在测试…" : "测试连接"}
            {busy !== "test" && <ArrowRight />}
          </button>
        </div>
      </section>
    </div>
  );
}

function PasswordChangeModal({
  vault,
  biometric,
  onChange,
  onClose,
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    const issue = validatePasswordChange(currentPassword, newPassword, confirmation);
    if (issue) {
      setError(issue);
      return;
    }
    if (!acknowledged) {
      setError("请确认你已经妥善记录新密码。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const changed = await onChange({
        vaultId: vault.id ?? vault.vaultId,
        currentPassword,
        newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setResult(changed);
    } catch (nextError) {
      setCurrentPassword("");
      setError(presentPasswordChangeError(nextError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="action-modal local-account-modal local-password-change-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-change-title"
      >
        <button className="modal-close" onClick={onClose} aria-label="关闭应用密码修改">
          <X />
        </button>
        <div className="action-modal-head">
          <span><LockKey weight="duotone" /></span>
          <div>
            <small>设备安全 · 重新封装数据密钥</small>
            <h2 id="password-change-title">
              {result ? "应用密码已安全更新" : "修改应用密码"}
            </h2>
            <p>
              {result
                ? "下次锁定后旧密码立即失效；当前数据和追加式账本保持原样。"
                : "Folio 会验证当前密码，再用新密码重新封装同一把随机数据密钥。不会解密导出或重写整库。"}
            </p>
          </div>
        </div>
        {result ? (
          <div className="local-password-change-result">
            <div className="local-backup-context">
              <ShieldCheck weight="duotone" />
              <span>
                <small>修改时间</small>
                <b>{new Date(result.changedAt).toLocaleString("zh-CN")}</b>
                <i>{result.biometricEnabled ? "Touch ID 继续可用" : "密码解锁已更新"}</i>
              </span>
            </div>
            <div className="local-confirm-warning">
              <ShieldCheck weight="duotone" />
              <span>
                <b>数据密钥和账本没有变化</b>
                <small>独立加密备份仍使用各自的备份密码，不会跟随应用密码一起改变。</small>
              </span>
            </div>
            <div className="modal-actions">
              <button className="primary" onClick={onClose}>完成 <Check weight="bold" /></button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="local-backup-form">
            <div className="local-backup-context">
              <Vault weight="duotone" />
              <span><small>当前数据</small><b>{vault.displayName}</b><i>{vault.baseCurrency}</i></span>
            </div>
            <PasswordField
              label="当前应用密码"
              value={currentPassword}
              onChange={(value) => {
                setCurrentPassword(value);
                setError("");
              }}
              visible={visible}
              onToggle={() => setVisible((value) => !value)}
              autoComplete="current-password"
            />
            <PasswordField
              label="新应用密码"
              value={newPassword}
              onChange={(value) => {
                setNewPassword(value);
                setError("");
              }}
              visible={visible}
              onToggle={() => setVisible((value) => !value)}
              autoComplete="new-password"
            />
            <PasswordField
              label="再次输入新密码"
              value={confirmation}
              onChange={(value) => {
                setConfirmation(value);
                setError("");
              }}
              visible={visible}
              onToggle={() => setVisible((value) => !value)}
              autoComplete="new-password"
            />
            <label className="local-backup-acknowledgement">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => {
                  setAcknowledged(event.target.checked);
                  setError("");
                }}
              />
              <span>
                <b>我已妥善记录新密码</b>
                <small>Folio 无法找回遗忘的应用密码；请保留独立加密备份。</small>
              </span>
            </label>
            <div className="local-confirm-warning">
              <ShieldCheck weight="duotone" />
              <span>
                <b>{biometric.enabled ? "Touch ID 不需要重新登记" : "当前只启用了密码解锁"}</b>
                <small>本次操作只轮换密码封装材料；不会把密码或数据密钥写入账本、日志或云端。</small>
              </span>
            </div>
            {error && <VaultError message={error} />}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={onClose} disabled={busy}>
                取消
              </button>
              <button type="submit" className="primary" disabled={busy}>
                {busy ? "正在验证并安全更新…" : "确认修改应用密码"}
                {!busy && <LockKey />}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function BiometricSettingsModal({
  vault,
  biometric,
  onEnable,
  onDisable,
  onClose,
}) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const disabling = biometric.enabled;

  const submit = async (event) => {
    event.preventDefault();
    if (password.length < 12) {
      setError("请输入当前应用密码。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (disabling) {
        await onDisable({ vaultId: vault.id ?? vault.vaultId, password });
      } else {
        await onEnable({ vaultId: vault.id ?? vault.vaultId, password });
      }
      setPassword("");
      onClose();
    } catch (nextError) {
      setPassword("");
      setError(presentBiometricSettingsError(nextError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="action-modal local-account-modal local-biometric-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="biometric-settings-title"
      >
        <button className="modal-close" onClick={onClose} aria-label={`关闭 ${APPLE_BIOMETRIC_LABEL} 设置`}>
          <X />
        </button>
        <div className="action-modal-head">
          <span><Fingerprint weight="duotone" /></span>
          <div>
            <small>设备安全 · 需要重新认证</small>
            <h2 id="biometric-settings-title">
              {disabling ? `关闭 ${APPLE_BIOMETRIC_LABEL} 快捷解锁` : `启用 ${APPLE_BIOMETRIC_LABEL} 快捷解锁`}
            </h2>
            <p>
              {disabling
                ? "关闭后会删除这份数据在本机钥匙串中的生物识别密钥，应用密码仍可正常解锁。"
                : `验证当前应用密码后，随机数据密钥会受 ${APPLE_BIOMETRIC_SYSTEM} Keychain 与当前生物识别集合共同保护。`}
            </p>
          </div>
        </div>
        <form onSubmit={submit} className="local-backup-form">
          <div className="local-backup-context">
            <Vault weight="duotone" />
            <span><small>当前数据</small><b>{vault.displayName}</b><i>{vault.baseCurrency}</i></span>
          </div>
          <PasswordField
            label="当前应用密码"
            value={password}
            onChange={(value) => {
              setPassword(value);
              setError("");
            }}
            visible={visible}
            onToggle={() => setVisible((value) => !value)}
            autoComplete="current-password"
          />
          <div className={`local-confirm-warning${disabling ? " warning" : ""}`}>
            {disabling ? <WarningCircle weight="duotone" /> : <ShieldCheck weight="duotone" />}
            <span>
              <b>{disabling ? "关闭不会删除数据或应用密码" : "Folio 不会收到面容或指纹模板"}</b>
              <small>
                {disabling
                  ? "下次锁定后，登录页只保留应用密码入口；之后仍可重新启用。"
                  : `比对完全由 ${APPLE_BIOMETRIC_SYSTEM} 处理；生物识别集合变化后，旧 Keychain 条目会失效。`}
              </small>
            </span>
          </div>
          {error && <VaultError message={error} />}
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button
              type="submit"
              className={disabling ? "danger-button" : "primary"}
              disabled={busy}
            >
              {busy
                ? "正在验证并更新…"
                : disabling
                  ? `确认关闭 ${APPLE_BIOMETRIC_LABEL}`
                  : `确认启用 ${APPLE_BIOMETRIC_LABEL}`}
              {!busy && (disabling ? <X /> : <Fingerprint />)}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function NativeVaultApp({ config = {} }) {
  const adapter = useMemo(() => createTauriVaultAdapter(invoke), []);
  const repository = useMemo(() => createLocalRepository(invoke), []);
  const controller = useMemo(() => new AppLockController({ adapter }), [adapter]);
  const [phase, setPhase] = useState("checking");
  const [resumeView, setResumeView] = useState("overview");
  const [vaults, setVaults] = useState([]);
  const [selectedVault, setSelectedVault] = useState(null);
  const [biometric, setBiometric] = useState({ available: false, enabled: false });
  const [lockState, setLockState] = useState(() => controller.snapshot());
  const [snapshot, setSnapshot] = useState(null);
  const [notificationStatus, setNotificationStatus] = useState({
    supported: true,
    permission: "not_determined",
    enabled: false,
    privacyMode: "generic",
    deliveryHour: 9,
    scheduledCount: 0,
    nextScheduledAt: null,
  });
  const [syncStatus, setSyncStatus] = useState(EMPTY_NATIVE_SYNC_STATUS);
  const [modelProviderStatus, setModelProviderStatus] = useState(
    EMPTY_MODEL_PROVIDER_STATUS,
  );
  const [codexCliStatus, setCodexCliStatus] = useState(EMPTY_CODEX_CLI_STATUS);
  const [aiInbox, setAiInbox] = useState([]);
  const [aiInboxLoading, setAiInboxLoading] = useState(false);
  const [aiInboxError, setAiInboxError] = useState("");
  const [workspaceNotice, setWorkspaceNotice] = useState("");
  const [e2eProgress, setE2eProgress] = useState("");
  const [e2eReport, setE2eReport] = useState(null);
  const [pendingFullReimport, setPendingFullReimport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lockingRef = useRef(false);
  const sensitiveOperationRef = useRef(false);
  const e2eStartedRef = useRef(false);
  const e2eTourStartedRef = useRef(false);

  const refreshBiometric = useCallback(async (vault) => {
    const status = await adapter.biometricStatus(vault?.vaultId ?? null);
    setBiometric(status);
    return status;
  }, [adapter]);

  const refreshAiInbox = useCallback(async () => {
    setAiInboxLoading(true);
    setAiInboxError("");
    try {
      const items = await repository.listAiProposals({ limit: 50 });
      setAiInbox(items);
      return items;
    } catch (inboxError) {
      setAiInboxError(
        typeof inboxError?.message === "string"
          ? inboxError.message
          : String(inboxError || "无法读取 AI 待核对收件箱。"),
      );
      return [];
    } finally {
      setAiInboxLoading(false);
    }
  }, [repository]);

  const refreshModelProvider = useCallback(async () => {
    const status = await repository.getModelProviderStatus();
    setModelProviderStatus(status);
    return status;
  }, [repository]);

  const refreshCodexCliStatus = useCallback(async () => {
    try {
      const status = await repository.getCodexCliStatus();
      setCodexCliStatus(status);
      return status;
    } catch (statusError) {
      const status = {
        ...EMPTY_CODEX_CLI_STATUS,
        message: typeof statusError?.message === "string"
          ? statusError.message
          : "无法检查 Codex CLI 状态。",
      };
      setCodexCliStatus(status);
      return status;
    }
  }, [repository]);

  const finishSensitiveOperation = async (restored = false) => {
    sensitiveOperationRef.current = false;
    if (
      !DEFAULT_AUTOMATIC_LOCK_ENABLED
      || document.visibilityState !== "hidden"
    ) return;
    await controller.lock("backgrounded");
    setSnapshot(null);
    setModelProviderStatus(EMPTY_MODEL_PROVIDER_STATUS);
    setCodexCliStatus(EMPTY_CODEX_CLI_STATUS);
    setWorkspaceNotice("");
    setLockState(controller.snapshot());
    setPhase(restored || vaults.length ? "locked" : "create");
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await adapter.lock({ sessionId: null });
        const listed = await adapter.list();
        if (cancelled) return;
        const initial = pickInitialVault(listed);
        setVaults(listed);
        setSelectedVault(initial);
        setPhase(initial ? "locked" : "create");
        await refreshBiometric(initial);
      } catch (initializationError) {
        if (!cancelled) {
          setError(presentVaultError(initializationError));
          setPhase("locked");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [adapter, refreshBiometric]);

  useEffect(() => {
    if (!NATIVE_DESKTOP_E2E || phase !== "create" || e2eStartedRef.current) return;
    e2eStartedRef.current = true;
    setE2eProgress("正在准备桌面完整路径测试…");
    void import("./e2e/nativeDesktopE2E.js")
      .then(({ runNativeDesktopE2E }) => runNativeDesktopE2E({
        adapter,
        controller,
        repository,
        onProgress: setE2eProgress,
      }))
      .then(async (report) => {
        const testVault = {
          vaultId: "primary",
          displayName: report.snapshot.vault.displayName,
          baseCurrency: report.snapshot.vault.baseCurrency,
          biometricEnabled: false,
        };
        window.__FOLIO_NATIVE_E2E_RESULT__ = report;
        window.localStorage.setItem("folio-native-e2e-result", JSON.stringify({
          passed: report.passed,
          counts: report.counts,
          confirmedDrafts: report.confirmedDrafts,
          incrementalTransactions: report.incrementalTransactions,
          adversarialChecks: report.adversarialChecks,
          cancelledDraftProtected: report.cancelledDraftProtected,
          correctionChainVerified: report.correctionChainVerified,
          valuationIsolationVerified: report.valuationIsolationVerified,
          recurringReminderVerified: report.recurringReminderVerified,
          planningIsolationVerified: report.planningIsolationVerified,
          lockAndPasswordVerified: report.lockAndPasswordVerified,
          cnyNetMinor: report.cnyNetMinor,
          assetTrendPoints: report.assetTrendPoints,
          replacementReimported: report.replacementReimported,
        }));
        setE2eReport(report);
        setVaults([testVault]);
        setSelectedVault(testVault);
        setSnapshot(report.snapshot);
        setLockState(report.lockState);
        setResumeView("overview");
        setWorkspaceNotice("桌面 E2E 已通过：全量数据、日常新增、修正链、估值隔离、周期事项、锁定与清空后重录均已验证。");
        setE2eProgress("");
        setPhase("workspace");
        await refreshBiometric(testVault);
      })
      .catch((testError) => {
        const message = typeof testError?.message === "string"
          ? testError.message
          : "桌面完整路径测试失败。";
        window.__FOLIO_NATIVE_E2E_RESULT__ = { passed: false, error: message };
        window.localStorage.setItem("folio-native-e2e-result", JSON.stringify({
          passed: false,
          error: message,
        }));
        setError(message);
        setE2eProgress("");
      });
  }, [adapter, controller, phase, refreshBiometric, repository]);

  useEffect(() => {
    if (
      !NATIVE_DESKTOP_E2E
      || !e2eReport?.passed
      || phase !== "workspace"
      || e2eTourStartedRef.current
    ) return;
    e2eTourStartedRef.current = true;
    const views = ["overview", "assets", "cashflow", "planning", "reminders", "assistant", "settings"];
    void (async () => {
      await Promise.resolve();
      const visitedViews = [];
      for (const view of views) {
        flushSync(() => setResumeView(view));
        const renderedTitle = document.querySelector(".local-page-title h1")?.textContent?.trim();
        if (renderedTitle !== localViewLabels[view]) {
          throw new Error(`桌面模块未正确渲染：${localViewLabels[view]}`);
        }
        visitedViews.push(view);
        window.localStorage.setItem("folio-native-e2e-visited-views", JSON.stringify(visitedViews));
      }
      flushSync(() => setResumeView("overview"));
      const previous = JSON.parse(window.localStorage.getItem("folio-native-e2e-result") || "{}");
      window.localStorage.setItem("folio-native-e2e-result", JSON.stringify({
        ...previous,
        visitedViews,
        moduleTourPassed: visitedViews.length === views.length,
      }));
    })().catch((tourError) => {
      const previous = JSON.parse(window.localStorage.getItem("folio-native-e2e-result") || "{}");
      window.localStorage.setItem("folio-native-e2e-result", JSON.stringify({
        ...previous,
        moduleTourPassed: false,
        moduleTourError: tourError.message,
      }));
    });
  }, [e2eReport, phase]);

  const openWorkspace = useCallback(async (nextLockState) => {
    try {
      const nextSnapshot = await repository.getSnapshot();
      setSnapshot(nextSnapshot);
      try {
        await refreshAiInbox();
      } catch {
        // AI inbox history must not prevent an otherwise valid vault unlock.
      }
      try {
        setSyncStatus(await repository.getSyncStatus());
      } catch {
        setSyncStatus(EMPTY_NATIVE_SYNC_STATUS);
      }
      try {
        await refreshModelProvider();
      } catch {
        setModelProviderStatus(EMPTY_MODEL_PROVIDER_STATUS);
      }
      void refreshCodexCliStatus();
      try {
        setNotificationStatus(await repository.reconcileNotifications());
      } catch {
        try {
          setNotificationStatus(await repository.getNotificationStatus());
        } catch {
          // Notification status must never prevent an otherwise valid vault unlock.
        }
      }
      setLockState(nextLockState);
      setPhase("workspace");
      setError("");
      return true;
    } catch (snapshotError) {
      await controller.lock("snapshot_failed");
      setSnapshot(null);
      setSyncStatus(EMPTY_NATIVE_SYNC_STATUS);
      setModelProviderStatus(EMPTY_MODEL_PROVIDER_STATUS);
      setCodexCliStatus(EMPTY_CODEX_CLI_STATUS);
      setLockState(controller.snapshot());
      setError(presentVaultError(snapshotError));
      setPhase("locked");
      return false;
    }
  }, [controller, refreshAiInbox, refreshCodexCliStatus, refreshModelProvider, repository]);

  const createAccountDraft = useCallback(
    (input) => repository.createAccountDraft(input),
    [repository],
  );

  const updateAccountDraft = useCallback(
    (input) => repository.updateAccountDraft(input),
    [repository],
  );

  const archiveAccountDraft = useCallback(
    (accountId) => repository.archiveAccountDraft(accountId),
    [repository],
  );

  const confirmAccountDraft = useCallback(async (draftId) => {
    const result = await repository.confirmAccountDraft(draftId);
    const nextSnapshot = await repository.getSnapshot();
    setSnapshot(nextSnapshot);
    void refreshAiInbox();
    return result;
  }, [refreshAiInbox, repository]);

  const rejectAccountDraft = useCallback(async (draftId) => {
    const result = await repository.rejectAccountDraft(draftId);
    void refreshAiInbox();
    return result;
  }, [refreshAiInbox, repository]);

  const createHoldingDraft = useCallback(
    (input) => repository.createHoldingDraft(input),
    [repository],
  );

  const createHoldingValuationDraft = useCallback(
    (input) => repository.createHoldingValuationDraft(input),
    [repository],
  );

  const updateHoldingDraft = useCallback(
    (input) => repository.updateHoldingDraft(input),
    [repository],
  );

  const archiveHoldingDraft = useCallback(
    (input) => repository.archiveHoldingDraft(input),
    [repository],
  );

  const confirmHoldingDraft = useCallback(async (draftId) => {
    const result = await repository.confirmHoldingDraft(draftId);
    const nextSnapshot = await repository.getSnapshot();
    setSnapshot(nextSnapshot);
    return result;
  }, [repository]);

  const rejectHoldingDraft = useCallback(
    (draftId) => repository.rejectHoldingDraft(draftId),
    [repository],
  );

  const createHoldingOperationDraft = useCallback(
    (input) => repository.createHoldingOperationDraft(input),
    [repository],
  );

  const confirmHoldingOperationDraft = useCallback(async (draftId) => {
    const result = await repository.confirmHoldingOperationDraft(draftId);
    const nextSnapshot = await repository.getSnapshot();
    setSnapshot(nextSnapshot);
    void refreshAiInbox();
    return result;
  }, [refreshAiInbox, repository]);

  const rejectHoldingOperationDraft = useCallback(async (draftId) => {
    const result = await repository.rejectHoldingOperationDraft(draftId);
    void refreshAiInbox();
    return result;
  }, [refreshAiInbox, repository]);

  const createHoldingOperationCorrectionDraft = useCallback(
    (input) => repository.createHoldingOperationCorrectionDraft(input),
    [repository],
  );

  const confirmHoldingOperationCorrectionDraft = useCallback(async (draftId) => {
    const result = await repository.confirmHoldingOperationCorrectionDraft(draftId);
    const nextSnapshot = await repository.getSnapshot();
    setSnapshot(nextSnapshot);
    return result;
  }, [repository]);

  const rejectHoldingOperationCorrectionDraft = useCallback(
    (draftId) => repository.rejectHoldingOperationCorrectionDraft(draftId),
    [repository],
  );

  const createTransactionDraft = useCallback(
    (input) => repository.createTransactionDraft(input),
    [repository],
  );

  const confirmTransactionDraft = useCallback(async (draftId) => {
    const result = await repository.confirmTransactionDraft(draftId);
    const nextSnapshot = await repository.getSnapshot();
    setSnapshot(nextSnapshot);
    void refreshAiInbox();
    return result;
  }, [refreshAiInbox, repository]);

  const rejectTransactionDraft = useCallback(async (draftId) => {
    const result = await repository.rejectTransactionDraft(draftId);
    void refreshAiInbox();
    return result;
  }, [refreshAiInbox, repository]);

  const createTransactionCorrectionDraft = useCallback(
    (input) => repository.createTransactionCorrectionDraft(input),
    [repository],
  );

  const confirmTransactionCorrectionDraft = useCallback(async (draftId) => {
    const result = await repository.confirmTransactionCorrectionDraft(draftId);
    const nextSnapshot = await repository.getSnapshot();
    setSnapshot(nextSnapshot);
    return result;
  }, [repository]);

  const rejectTransactionCorrectionDraft = useCallback(
    (draftId) => repository.rejectTransactionCorrectionDraft(draftId),
    [repository],
  );

  const inspectTransactionImport = useCallback(
    (request) => repository.inspectTransactionImport(request),
    [repository],
  );

  const createTransactionImportDraft = useCallback(
    (request) => repository.createTransactionImportDraft(request),
    [repository],
  );

  const confirmTransactionImportDraft = useCallback(async (draftId) => {
    const result = await repository.confirmTransactionImportDraft(draftId);
    const nextSnapshot = await repository.getSnapshot();
    setSnapshot(nextSnapshot);
    return result;
  }, [repository]);

  const rejectTransactionImportDraft = useCallback(
    (draftId) => repository.rejectTransactionImportDraft(draftId),
    [repository],
  );

  const createReminderDraft = useCallback(
    (input) => repository.createReminderDraft(input),
    [repository],
  );

  const updateReminderDraft = useCallback(
    (input) => repository.updateReminderDraft(input),
    [repository],
  );

  const completeReminderDraft = useCallback(
    (reminderId) => repository.completeReminderDraft(reminderId),
    [repository],
  );

  const archiveReminderDraft = useCallback(
    (reminderId) => repository.archiveReminderDraft(reminderId),
    [repository],
  );

  const confirmReminderDraft = useCallback(async (draftId) => {
    const result = await repository.confirmReminderDraft(draftId);
    const nextSnapshot = await repository.getSnapshot();
    setSnapshot(nextSnapshot);
    void refreshAiInbox();
    try {
      setNotificationStatus(await repository.reconcileNotifications());
    } catch {
      // The committed reminder remains valid; the next unlock retries scheduling.
    }
    return result;
  }, [refreshAiInbox, repository]);

  const enableNotifications = useCallback(async (privacyMode) => {
    const status = await repository.enableNotifications(privacyMode);
    setNotificationStatus(status);
    return status;
  }, [repository]);

  const disableNotifications = useCallback(async () => {
    const status = await repository.disableNotifications();
    setNotificationStatus(status);
    return status;
  }, [repository]);

  const listSyncConflicts = useCallback(
    (includeResolved = false) => repository.listSyncConflicts(includeResolved),
    [repository],
  );

  const inspectSyncConflict = useCallback(
    (conflictId) => repository.inspectSyncConflict(conflictId),
    [repository],
  );

  const keepLocalSyncConflict = useCallback(async (request) => {
    const result = await repository.keepLocalSyncConflict(request);
    setSyncStatus(result.status);
    return result;
  }, [repository]);

  const refreshVaultMetadata = useCallback(async (vaultId) => {
    const listed = await adapter.list();
    setVaults(listed);
    const current = listed.find((item) => item.vaultId === vaultId) ?? selectedVault;
    setSelectedVault(current);
    return current;
  }, [adapter, selectedVault]);

  const enableBiometric = useCallback(async ({ vaultId, password }) => {
    const status = await adapter.enableBiometric({ vaultId, password });
    setBiometric(status);
    try {
      await refreshVaultMetadata(vaultId);
    } catch {
      // The native setting is authoritative; vault-list refresh retries after locking.
    }
    return status;
  }, [adapter, refreshVaultMetadata]);

  const disableBiometric = useCallback(async ({ vaultId, password }) => {
    const status = await adapter.disableBiometric({ vaultId, password });
    setBiometric(status);
    try {
      await refreshVaultMetadata(vaultId);
    } catch {
      // The native setting is authoritative; vault-list refresh retries after locking.
    }
    return status;
  }, [adapter, refreshVaultMetadata]);

  const changePassword = useCallback(async (request) => {
    sensitiveOperationRef.current = true;
    try {
      return await adapter.changePassword(request);
    } finally {
      await finishSensitiveOperation();
    }
  }, [adapter, controller, vaults.length]);

  const rejectReminderDraft = useCallback(async (draftId) => {
    const result = await repository.rejectReminderDraft(draftId);
    void refreshAiInbox();
    return result;
  }, [refreshAiInbox, repository]);

  const savePlanningDraft = useCallback(
    (input) => repository.savePlanningDraft(input),
    [repository],
  );

  const confirmPlanningDraft = useCallback(async (draftId) => {
    const result = await repository.confirmPlanningDraft(draftId);
    const nextSnapshot = await repository.getSnapshot();
    setSnapshot(nextSnapshot);
    void refreshAiInbox();
    return result;
  }, [refreshAiInbox, repository]);

  const rejectPlanningDraft = useCallback(async (draftId) => {
    const result = await repository.rejectPlanningDraft(draftId);
    void refreshAiInbox();
    return result;
  }, [refreshAiInbox, repository]);

  const recordAiProposal = useCallback(async (request) => {
    const result = await repository.recordAiProposal(request);
    void refreshAiInbox();
    return result;
  }, [refreshAiInbox, repository]);

  const configureModelProvider = useCallback(async (apiKey) => {
    const status = await repository.configureModelProvider(apiKey);
    setModelProviderStatus(status);
    return status;
  }, [repository]);

  const removeModelProvider = useCallback(async () => {
    const status = await repository.removeModelProvider();
    setModelProviderStatus(status);
    return status;
  }, [repository]);

  const testModelProvider = useCallback(
    () => repository.testModelProvider(),
    [repository],
  );

  const extractFinancialFactsWithModel = useCallback(async (request) => {
    sensitiveOperationRef.current = true;
    try {
      return await repository.extractFinancialFactsWithModel(request);
    } finally {
      await finishSensitiveOperation();
    }
  }, [controller, repository, vaults.length]);

  const analyzeFinanceInputWithCodex = useCallback(async (request) => {
    sensitiveOperationRef.current = true;
    try {
      return await repository.analyzeFinanceInputWithCodex(request);
    } finally {
      await finishSensitiveOperation();
    }
  }, [controller, repository, vaults.length]);

  const selectDocumentEvidence = useCallback(async () => {
    sensitiveOperationRef.current = true;
    try {
      return await repository.selectDocumentEvidence();
    } finally {
      await finishSensitiveOperation();
    }
  }, [controller, repository, vaults.length]);

  const transcribeSpeech = useCallback(async (request, onEvent) => {
    sensitiveOperationRef.current = true;
    try {
      return await repository.transcribeSpeech(request, onEvent);
    } finally {
      await finishSensitiveOperation();
    }
  }, [controller, repository, vaults.length]);

  const stopSpeechCapture = useCallback(
    () => repository.stopSpeechCapture(),
    [repository],
  );

  const createBackup = useCallback(async (request) => {
    sensitiveOperationRef.current = true;
    try {
      return await repository.createBackup(request);
    } finally {
      await finishSensitiveOperation();
    }
  }, [controller, repository, vaults.length]);

  const createDataExport = useCallback(async (request) => {
    sensitiveOperationRef.current = true;
    try {
      return await repository.createDataExport(request);
    } finally {
      await finishSensitiveOperation();
    }
  }, [controller, repository, vaults.length]);

  const saveMarkdownExport = useCallback(async (request) => {
    sensitiveOperationRef.current = true;
    try {
      return await repository.saveMarkdownExport(request);
    } finally {
      await finishSensitiveOperation();
    }
  }, [controller, repository, vaults.length]);

  const clearAllData = useCallback(async (request) => {
    sensitiveOperationRef.current = true;
    try {
      const result = await adapter.clearAllData(request);
      await controller.lock("vault_data_cleared");
      const listed = await adapter.list();
      const initial = pickInitialVault(listed);
      setVaults(listed);
      setSelectedVault(initial);
      setSnapshot(null);
      setAiInbox([]);
      setSyncStatus(EMPTY_NATIVE_SYNC_STATUS);
      setModelProviderStatus(EMPTY_MODEL_PROVIDER_STATUS);
      setWorkspaceNotice("");
      setResumeView("overview");
      setLockState(controller.snapshot());
      setPhase(initial ? "locked" : "create");
      await refreshBiometric(initial);
      return result;
    } finally {
      sensitiveOperationRef.current = false;
    }
  }, [adapter, controller, refreshBiometric]);

  const replaceAllDataForReimport = useCallback(async ({
    vaultId,
    currentPassword,
    pendingBatch,
  }) => {
    sensitiveOperationRef.current = true;
    try {
      const currentVault = selectedVault;
      if (!currentVault || currentVault.vaultId !== vaultId) {
        throw new Error("当前本地数据与重录目标不一致，请重新打开后再试。");
      }
      await adapter.clearAllData({ vaultId, currentPassword });
      const nextState = await controller.createVault({
        vaultId,
        displayName: currentVault.displayName,
        baseCurrency: currentVault.baseCurrency,
        password: currentPassword,
      });
      const recreatedVault = { ...currentVault, biometricEnabled: false };
      setVaults([recreatedVault]);
      setSelectedVault(recreatedVault);
      setPendingFullReimport(pendingBatch);
      setWorkspaceNotice("旧数据已导出并安全清空。请继续逐组核对新的完整快照；Touch ID 可在完成后重新启用。");
      const opened = await openWorkspace(nextState);
      if (!opened) throw new Error("新建的空白 Folio 无法打开，请重新解锁后导入已保存的 Markdown。");
      await refreshBiometric(recreatedVault);
      return { status: "ready_for_reimport", vaultId };
    } finally {
      sensitiveOperationRef.current = false;
    }
  }, [adapter, controller, openWorkspace, refreshBiometric, selectedVault]);

  const selectBackup = useCallback(async () => {
    sensitiveOperationRef.current = true;
    try {
      return await repository.selectBackup();
    } finally {
      await finishSensitiveOperation();
    }
  }, [controller, repository, vaults.length]);

  const inspectBackup = useCallback(
    (request) => repository.inspectBackup(request),
    [repository],
  );

  const discardBackupSelection = useCallback(
    (selectionToken) => repository.discardBackupSelection(selectionToken),
    [repository],
  );

  const confirmBackupRestore = useCallback(async (request) => {
    sensitiveOperationRef.current = true;
    try {
      const result = await repository.confirmBackupRestore(request);
      const nextLockState = controller.acceptRestoredVault(result.vaultId, result);
      const restoredVault = {
        vaultId: result.vaultId,
        displayName: result.displayName,
        baseCurrency: result.baseCurrency,
        biometricEnabled: false,
      };
      setSelectedVault(restoredVault);
      setWorkspaceNotice("加密备份已恢复为独立数据；Touch ID 默认关闭，请在确认数据后重新启用。");
      const opened = await openWorkspace(nextLockState);
      if (!opened) {
        throw new Error("Restored vault could not be opened after installation.");
      }
      try {
        const listed = await adapter.list();
        setVaults(listed.length ? listed : [restoredVault]);
        await refreshBiometric(restoredVault);
      } catch {
        setVaults((current) => [
          ...current.filter((vault) => vault.vaultId !== restoredVault.vaultId),
          restoredVault,
        ]);
      }
      return result;
    } finally {
      await finishSensitiveOperation(true);
    }
  }, [adapter, controller, openWorkspace, refreshBiometric, repository, vaults.length]);

  const createVault = async (request) => {
    setBusy(true);
    setError("");
    setWorkspaceNotice("");
    let nextState;
    try {
      nextState = await controller.createVault(request);
    } catch (creationError) {
      setError(presentVaultError(creationError));
      setLockState(controller.snapshot());
      setBusy(false);
      return false;
    }

    const optimisticVault = {
      vaultId: request.vaultId,
      displayName: request.displayName.trim(),
      baseCurrency: request.baseCurrency,
      biometricEnabled: false,
    };
    setVaults([optimisticVault]);
    setSelectedVault(optimisticVault);

    let warning = "";
    try {
      if (request.enableBiometric) {
        try {
          await adapter.enableBiometric({
            vaultId: request.vaultId,
            password: request.password,
          });
        } catch {
          warning = "本地数据已安全创建，但 Touch ID 暂未启用；可继续使用应用密码，并在安全设置中重试。";
        }
      }

      setWorkspaceNotice(warning);
      const opened = await openWorkspace(nextState);
      if (!opened) return false;

      try {
        const listed = await adapter.list();
        const current = pickInitialVault(listed) ?? optimisticVault;
        setVaults(listed.length ? listed : [optimisticVault]);
        setSelectedVault(current);
        await refreshBiometric(current);
      } catch {
        if (!warning) {
          warning = "本地数据已打开，但安全状态暂未刷新；下次启动时会自动重试。";
          setWorkspaceNotice(warning);
        }
      }
      return true;
    } finally {
      setBusy(false);
    }
  };

  const unlock = async (method, password) => {
    if (!selectedVault) return false;
    setBusy(true);
    setError("");
    setWorkspaceNotice("");
    try {
      const nextState = await controller.unlock({
        vaultId: selectedVault.vaultId,
        method,
        password,
      });
      return await openWorkspace(nextState);
    } catch (unlockError) {
      setLockState(controller.snapshot());
      setError(presentVaultError(unlockError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const lockNow = useCallback(async (reason = "manual") => {
    if (lockingRef.current || sensitiveOperationRef.current) return;
    lockingRef.current = true;
    try {
      await controller.lock(reason);
    } finally {
      setSnapshot(null);
      setSyncStatus(EMPTY_NATIVE_SYNC_STATUS);
      setModelProviderStatus(EMPTY_MODEL_PROVIDER_STATUS);
      setWorkspaceNotice("");
      setLockState(controller.snapshot());
      setPhase(vaults.length ? "locked" : "create");
      lockingRef.current = false;
    }
  }, [controller, vaults.length]);

  useEffect(() => {
    if (
      !DEFAULT_AUTOMATIC_LOCK_ENABLED
      || phase !== "workspace"
      || lockState.status !== "unlocked"
    ) return undefined;
    const recordActivity = () => controller.recordActivity();
    const backgroundLockGuard = createBackgroundLockGuard({
      onLock: () => lockNow("backgrounded"),
    });
    backgroundLockGuard.activate(lockState.sessionId);
    const handleVisibility = () => {
      const hidden = document.visibilityState === "hidden";
      backgroundLockGuard.setBackgrounded("document-visibility", hidden);
      if (!hidden) recordActivity();
    };
    const interval = window.setInterval(async () => {
      const state = await controller.checkIdle();
      if (state.status === "locked") {
        setSnapshot(null);
        setModelProviderStatus(EMPTY_MODEL_PROVIDER_STATUS);
        setLockState(state);
        setPhase("locked");
      }
    }, 10_000);
    const events = ["pointerdown", "keydown", "touchstart"];
    events.forEach((eventName) => window.addEventListener(eventName, recordActivity, { passive: true }));
    document.addEventListener("visibilitychange", handleVisibility);

    let disposed = false;
    let unlistenFocus;
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => (
      getCurrentWindow().onFocusChanged(({ payload }) => {
        backgroundLockGuard.setBackgrounded("native-window-focus", !payload);
        if (payload) recordActivity();
      })
    )).then((unlisten) => {
      if (disposed) unlisten();
      else unlistenFocus = unlisten;
    }).catch(() => {});

    return () => {
      disposed = true;
      backgroundLockGuard.deactivate();
      window.clearInterval(interval);
      events.forEach((eventName) => window.removeEventListener(eventName, recordActivity));
      document.removeEventListener("visibilitychange", handleVisibility);
      if (unlistenFocus) unlistenFocus();
    };
  }, [controller, lockNow, lockState.sessionId, lockState.status, phase]);

  const selectVault = async (vaultId) => {
    const next = vaults.find((vault) => vault.vaultId === vaultId) ?? null;
    setSelectedVault(next);
    setError("");
    await refreshBiometric(next);
  };

  if (phase === "checking") {
    return <div className="vault-loading"><Brand /><span /><p>正在检查本地数据…</p></div>;
  }
  if (NATIVE_DESKTOP_E2E && e2eProgress) {
    return <div className="vault-loading"><Brand /><span /><p>{e2eProgress}</p></div>;
  }
  if (phase === "workspace" && snapshot) {
    return (
      <LocalWorkspace
        key={NATIVE_DESKTOP_E2E ? resumeView : "folio-workspace"}
        snapshot={snapshot}
        biometric={biometric}
        initialView={resumeView}
        initialFullReimport={pendingFullReimport}
        onFullReimportConsumed={() => setPendingFullReimport(null)}
        onViewChange={setResumeView}
        syncConfig={config}
        syncStatus={syncStatus}
        localRepository={repository}
        onSyncStatusChange={setSyncStatus}
        onListSyncConflicts={listSyncConflicts}
        onInspectSyncConflict={inspectSyncConflict}
        onKeepLocalSyncConflict={keepLocalSyncConflict}
        initialNotice={workspaceNotice}
        onCreateAccountDraft={createAccountDraft}
        onUpdateAccountDraft={updateAccountDraft}
        onArchiveAccountDraft={archiveAccountDraft}
        onConfirmAccountDraft={confirmAccountDraft}
        onRejectAccountDraft={rejectAccountDraft}
        onCreateHoldingDraft={createHoldingDraft}
        onCreateHoldingValuationDraft={createHoldingValuationDraft}
        onUpdateHoldingDraft={updateHoldingDraft}
        onArchiveHoldingDraft={archiveHoldingDraft}
        onConfirmHoldingDraft={confirmHoldingDraft}
        onRejectHoldingDraft={rejectHoldingDraft}
        onCreateHoldingOperationDraft={createHoldingOperationDraft}
        onConfirmHoldingOperationDraft={confirmHoldingOperationDraft}
        onRejectHoldingOperationDraft={rejectHoldingOperationDraft}
        onCreateHoldingOperationCorrectionDraft={createHoldingOperationCorrectionDraft}
        onConfirmHoldingOperationCorrectionDraft={confirmHoldingOperationCorrectionDraft}
        onRejectHoldingOperationCorrectionDraft={rejectHoldingOperationCorrectionDraft}
        onCreateTransactionDraft={createTransactionDraft}
        onConfirmTransactionDraft={confirmTransactionDraft}
        onRejectTransactionDraft={rejectTransactionDraft}
        onCreateTransactionCorrectionDraft={createTransactionCorrectionDraft}
        onConfirmTransactionCorrectionDraft={confirmTransactionCorrectionDraft}
        onRejectTransactionCorrectionDraft={rejectTransactionCorrectionDraft}
        onInspectTransactionImport={inspectTransactionImport}
        onCreateTransactionImportDraft={createTransactionImportDraft}
        onConfirmTransactionImportDraft={confirmTransactionImportDraft}
        onRejectTransactionImportDraft={rejectTransactionImportDraft}
        onCreateReminderDraft={createReminderDraft}
        onUpdateReminderDraft={updateReminderDraft}
        onCompleteReminderDraft={completeReminderDraft}
        onArchiveReminderDraft={archiveReminderDraft}
        onConfirmReminderDraft={confirmReminderDraft}
        onRejectReminderDraft={rejectReminderDraft}
        onSavePlanningDraft={savePlanningDraft}
        onConfirmPlanningDraft={confirmPlanningDraft}
        onRejectPlanningDraft={rejectPlanningDraft}
        onRecordAiProposal={recordAiProposal}
        codexCliStatus={codexCliStatus}
        onRefreshCodexCliStatus={refreshCodexCliStatus}
        onAnalyzeFinanceInputWithCodex={analyzeFinanceInputWithCodex}
        modelProviderStatus={modelProviderStatus}
        onRefreshModelProvider={refreshModelProvider}
        onConfigureModelProvider={configureModelProvider}
        onRemoveModelProvider={removeModelProvider}
        onTestModelProvider={testModelProvider}
        onExtractFinancialFactsWithModel={extractFinancialFactsWithModel}
        aiInbox={aiInbox}
        aiInboxLoading={aiInboxLoading}
        aiInboxError={aiInboxError}
        onRefreshAiInbox={refreshAiInbox}
        onSelectDocumentEvidence={selectDocumentEvidence}
        onTranscribeSpeech={transcribeSpeech}
        onStopSpeechCapture={stopSpeechCapture}
        knownVaults={vaults}
        onCreateBackup={createBackup}
        onCreateDataExport={createDataExport}
        onSaveMarkdownExport={saveMarkdownExport}
        onClearAllData={clearAllData}
        onBeginFullReimport={replaceAllDataForReimport}
        onSelectBackup={selectBackup}
        onInspectBackup={inspectBackup}
        onDiscardBackupSelection={discardBackupSelection}
        onConfirmBackupRestore={confirmBackupRestore}
        notificationStatus={notificationStatus}
        onEnableNotifications={enableNotifications}
        onDisableNotifications={disableNotifications}
        onEnableBiometric={enableBiometric}
        onDisableBiometric={disableBiometric}
        onChangePassword={changePassword}
        onLock={() => lockNow("manual")}
      />
    );
  }
  return (
    <VaultGate
      mode={phase}
      vault={selectedVault}
      vaults={vaults}
      biometric={biometric}
      busy={busy}
      error={error}
      onSelectVault={selectVault}
      onCreate={createVault}
      onPasswordUnlock={(password) => unlock("password", password)}
      onBiometricUnlock={() => unlock("biometric")}
      onSelectBackup={selectBackup}
      onInspectBackup={inspectBackup}
      onDiscardBackupSelection={discardBackupSelection}
      onConfirmBackupRestore={confirmBackupRestore}
    />
  );
}

export function VaultGatePreview({ mode = "locked" }) {
  const previewVault = {
    vaultId: "primary",
    displayName: "被子beizi 的 Folio 数据",
    baseCurrency: "CNY",
    biometricEnabled: true,
  };
  return (
    <VaultGate
      mode={mode === "create" ? "create" : "locked"}
      vault={mode === "create" ? null : previewVault}
      vaults={mode === "create" ? [] : [previewVault]}
      biometric={{ available: true, enabled: mode !== "create" }}
    />
  );
}

function previewMonthDate(offset, day) {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + offset);
  date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function createWorkspacePreviewSnapshot(fixture) {
  const base = {
    vault: {
      vaultId: "primary",
      displayName: DEFAULT_VAULT_NAME,
      baseCurrency: DEFAULT_BASE_CURRENCY,
    },
    accounts: [],
    balances: [],
    holdings: [],
    holdingOperations: [],
    transactions: [],
    reminders: [],
    imports: [],
    planning: null,
  };
  if (fixture === "film" || fixture === "settings") {
    const today = new Date().toISOString();
    const createdAt = "2025-12-18T08:00:00.000Z";
    const transaction = (id, kind, accountId, accountName, amountMinor, monthOffset, day, description, category, options = {}) => ({
      id,
      kind,
      accountId,
      accountName,
      amountMinor,
      currency: "CNY",
      occurredAt: `${previewMonthDate(monthOffset, day)}T08:00:00.000Z`,
      createdAt: options.today ? today : `${previewMonthDate(monthOffset, day)}T08:01:00.000Z`,
      description,
      category,
      reversed: false,
    });
    return {
      ...base,
      accounts: [
        { id: "film-cmb", institutionName: "招商银行", displayName: "工资账户", accountType: "cash", currency: "CNY", maskedIdentifier: "3619", createdAt, balanceMinor: 10_028_000, lastEventAt: `${previewMonthDate(-1, 28)}T08:00:00.000Z` },
        { id: "film-ccb", institutionName: "建设银行", displayName: "日常账户", accountType: "cash", currency: "CNY", maskedIdentifier: "8208", createdAt, balanceMinor: 4_068_052, lastEventAt: today },
        { id: "film-citic", institutionName: "中信银行", displayName: "信用卡", accountType: "liability", currency: "CNY", maskedIdentifier: "1028", createdAt, balanceMinor: -462_835, lastEventAt: `${previewMonthDate(0, 9)}T08:00:00.000Z` },
        { id: "film-fund", institutionName: "蚂蚁基金", displayName: "基金账户", accountType: "fund", currency: "CNY", maskedIdentifier: "F208", createdAt, balanceMinor: 38_640_000, lastEventAt: `${previewMonthDate(0, 5)}T08:00:00.000Z` },
        { id: "film-insurance", institutionName: "平安保险", displayName: "保险账户", accountType: "insurance", currency: "CNY", maskedIdentifier: "P619", createdAt, balanceMinor: 12_000_000, lastEventAt: `${previewMonthDate(-2, 16)}T08:00:00.000Z` },
        { id: "film-property", institutionName: "其他长期资产", displayName: "家庭长期资产", accountType: "property", currency: "CNY", maskedIdentifier: "H001", createdAt, balanceMinor: 157_200_000, lastEventAt: `${previewMonthDate(-5, 2)}T08:00:00.000Z` },
      ],
      balances: [
        { accountId: "film-cmb", currency: "CNY", balanceMinor: 10_028_000 },
        { accountId: "film-ccb", currency: "CNY", balanceMinor: 4_068_052, lastEventAt: today },
        { accountId: "film-citic", currency: "CNY", balanceMinor: -462_835 },
        { accountId: "film-fund", currency: "CNY", balanceMinor: 38_640_000 },
        { accountId: "film-insurance", currency: "CNY", balanceMinor: 12_000_000 },
        { accountId: "film-property", currency: "CNY", balanceMinor: 157_200_000 },
      ],
      holdings: [
        { id: "film-holding-cash", accountId: "film-cmb", accountName: "工资账户", name: "活期备用金", productType: "cash_management", currency: "CNY", unitsMicros: 8_640_000_000, costBasisMinor: 8_640_000, marketValueMinor: 8_640_000, gainMinor: 0, returnBps: 0, asOfDate: previewMonthDate(0, 12), valuationCount: 6, includedInAccountBalance: true, createdAt },
        { id: "film-holding-stable", accountId: "film-ccb", accountName: "日常账户", name: "稳健理财", productType: "wealth_management", currency: "CNY", unitsMicros: 30_030_000_000, costBasisMinor: 29_800_000, marketValueMinor: 30_030_000, gainMinor: 230_000, returnBps: 77, asOfDate: previewMonthDate(0, 10), valuationCount: 5, includedInAccountBalance: true, createdAt },
        { id: "film-holding-fund", accountId: "film-fund", accountName: "基金账户", name: "中证红利组合", productType: "fund", currency: "CNY", unitsMicros: 38_640_000_000, costBasisMinor: 36_800_000, marketValueMinor: 38_640_000, gainMinor: 1_840_000, returnBps: 500, asOfDate: previewMonthDate(0, 11), valuationCount: 7, includedInAccountBalance: true, createdAt },
        { id: "film-holding-insurance", accountId: "film-insurance", accountName: "保险账户", name: "家庭保障计划", productType: "insurance", currency: "CNY", unitsMicros: 12_000_000_000, costBasisMinor: 12_000_000, marketValueMinor: 12_000_000, gainMinor: 0, returnBps: 0, asOfDate: previewMonthDate(-1, 20), valuationCount: 3, includedInAccountBalance: true, createdAt },
      ],
      transactions: [
        transaction("film-march-income", "income", "film-property", "家庭长期资产", 12_000_000, -5, 2, "长期资产归集", "资产整理"),
        transaction("film-march-expense", "expense", "film-cmb", "工资账户", 920_000, -5, 18, "家庭支出", "日常"),
        transaction("film-april-income", "income", "film-fund", "基金账户", 18_000_000, -4, 3, "基金资产归集", "资产整理"),
        transaction("film-april-expense", "expense", "film-ccb", "日常账户", 2_000_000, -4, 20, "阶段性支出", "家庭"),
        transaction("film-may-income", "income", "film-property", "家庭长期资产", 30_000_000, -3, 2, "长期资产补录", "资产整理"),
        transaction("film-may-expense", "expense", "film-cmb", "工资账户", 5_000_000, -3, 21, "家庭装修", "家庭"),
        transaction("film-june-income", "income", "film-insurance", "保险账户", 18_000_000, -2, 16, "保障资产补录", "资产整理"),
        transaction("film-june-expense", "expense", "film-ccb", "日常账户", 3_500_000, -2, 24, "阶段性支出", "家庭"),
        transaction("film-july-income", "income", "film-fund", "基金账户", 24_000_000, -1, 5, "投资资产补录", "资产整理"),
        transaction("film-july-expense", "expense", "film-cmb", "工资账户", 4_200_000, -1, 27, "家庭大额支出", "家庭"),
        transaction("film-rent-income", "income", "film-ccb", "日常账户", 800_000, 0, 12, "租金收入", "租金", { today: true }),
        transaction("film-daily-expense", "expense", "film-cmb", "工资账户", 36_800, 0, 12, "日用品", "购物", { today: true }),
      ],
      reminders: [
        { id: "film-insurance-reminder", linkedAccountId: "film-insurance", linkedAccountName: "保险账户", category: "insurance", title: "交年度保费", amountMinor: 1_000_000, currency: "CNY", dueOn: previewMonthDate(0, 20), advanceDays: 7, recurrenceRule: "yearly", status: "active", notes: "虚构演示事项", completedOccurrences: 0, lastCompletedOn: null, createdAt: today, updatedAt: today },
        { id: "film-rent-reminder", linkedAccountId: "film-ccb", linkedAccountName: "日常账户", category: "rent", title: "确认下月租金", amountMinor: 800_000, currency: "CNY", dueOn: previewMonthDate(1, 1), advanceDays: 3, recurrenceRule: "monthly", status: "active", notes: null, completedOccurrences: 4, lastCompletedOn: previewMonthDate(0, 1), createdAt, updatedAt: createdAt },
        { id: "film-maturity-reminder", linkedAccountId: "film-ccb", linkedAccountName: "日常账户", category: "maturity", title: "稳健理财到期", amountMinor: 3_000_000, currency: "CNY", dueOn: previewMonthDate(1, 26), advanceDays: 7, recurrenceRule: null, status: "active", notes: null, completedOccurrences: 0, lastCompletedOn: null, createdAt, updatedAt: createdAt },
      ],
      planning: {
        id: "film-planning",
        name: "家庭长期资产规划",
        baseCurrency: "CNY",
        cashBufferMinor: 5_000_000,
        allocations: [
          { category: "cash", targetBps: 1_500 },
          { category: "stable", targetBps: 3_000 },
          { category: "equity", targetBps: 2_500 },
          { category: "gold", targetBps: 1_000 },
          { category: "insurance", targetBps: 1_500 },
          { category: "other", targetBps: 500 },
        ],
        notes: "虚构演示规划，不构成投资建议。",
        createdAt,
        updatedAt: createdAt,
      },
    };
  }
  if (fixture !== "analytics") return base;
  const currentSalary = previewMonthDate(0, 1);
  const currentDining = previewMonthDate(0, 8);
  const currentShopping = previewMonthDate(0, 12);
  const previousSalary = previewMonthDate(-1, 1);
  const previousShopping = previewMonthDate(-1, 15);
  return {
    ...base,
    accounts: [
      {
        id: "preview-salary",
        institutionName: "招商银行",
        displayName: "工资账户",
        accountType: "cash",
        currency: "CNY",
        balanceMinor: 1_240_000,
        lastEventAt: `${currentSalary}T00:01:00.000Z`,
      },
      {
        id: "preview-daily",
        institutionName: "建设银行",
        displayName: "日常账户",
        accountType: "cash",
        currency: "CNY",
        balanceMinor: 343_200,
        lastEventAt: `${currentShopping}T00:01:00.000Z`,
      },
    ],
    balances: [
      {
        accountId: "preview-salary",
        currency: "CNY",
        balanceMinor: 1_240_000,
        lastEventAt: `${currentSalary}T00:01:00.000Z`,
      },
      {
        accountId: "preview-daily",
        currency: "CNY",
        balanceMinor: 343_200,
        lastEventAt: `${currentShopping}T00:01:00.000Z`,
      },
    ],
    holdings: [
      {
        id: "preview-holding-fund",
        accountId: "preview-salary",
        accountName: "工资账户",
        name: "虚构中证红利基金",
        productType: "fund",
        currency: "CNY",
        maskedIdentifier: "FUND-1028",
        notes: "仅用于交互预览的虚构持仓",
        unitsMicros: 123_456_789,
        costBasisMinor: 500_000,
        marketValueMinor: 518_032,
        gainMinor: 18_032,
        returnBps: 360,
        asOfDate: currentShopping,
        valuationCount: 2,
        includedInAccountBalance: true,
      },
    ],
    reminders: [
      {
        id: "preview-recurring-insurance",
        linkedAccountId: "preview-salary",
        linkedAccountName: "工资账户",
        category: "insurance",
        title: "虚构年度保险复核",
        amountMinor: 128_000,
        currency: "CNY",
        dueOn: previewMonthDate(1, 2),
        advanceDays: 7,
        recurrenceRule: "yearly",
        status: "active",
        notes: "演示数据：准备续期材料并复核预算。",
        completedOccurrences: 1,
        lastCompletedOn: previewMonthDate(-11, 2),
      },
      {
        id: "preview-one-time-reminder",
        linkedAccountId: "preview-daily",
        linkedAccountName: "日常账户",
        category: "custom",
        title: "虚构家庭账单核对",
        amountMinor: 36_800,
        currency: "CNY",
        dueOn: previewMonthDate(0, 28),
        advanceDays: 1,
        recurrenceRule: null,
        status: "active",
        notes: null,
        completedOccurrences: 0,
        lastCompletedOn: null,
      },
    ],
    transactions: [
      {
        id: "preview-current-income",
        kind: "income",
        accountId: "preview-salary",
        accountName: "工资账户",
        amountMinor: 500_000,
        currency: "CNY",
        occurredAt: `${currentSalary}T00:00:00.000Z`,
        createdAt: `${currentSalary}T00:01:00.000Z`,
        description: "本月工资",
        category: "工资",
        reversed: false,
      },
      {
        id: "preview-current-dining",
        kind: "expense",
        accountId: "preview-daily",
        accountName: "日常账户",
        amountMinor: 120_000,
        currency: "CNY",
        occurredAt: `${currentDining}T00:00:00.000Z`,
        createdAt: `${currentDining}T00:01:00.000Z`,
        description: "家庭聚餐",
        category: "餐饮",
        reversed: false,
      },
      {
        id: "preview-current-shopping",
        kind: "expense",
        accountId: "preview-daily",
        accountName: "日常账户",
        amountMinor: 36_800,
        currency: "CNY",
        occurredAt: `${currentShopping}T00:00:00.000Z`,
        createdAt: `${currentShopping}T00:01:00.000Z`,
        description: "日用品",
        category: "购物",
        reversed: false,
      },
      {
        id: "preview-previous-income",
        kind: "income",
        accountId: "preview-salary",
        accountName: "工资账户",
        amountMinor: 400_000,
        currency: "CNY",
        occurredAt: `${previousSalary}T00:00:00.000Z`,
        createdAt: `${previousSalary}T00:01:00.000Z`,
        description: "上月工资",
        category: "工资",
        reversed: false,
      },
      {
        id: "preview-previous-shopping",
        kind: "expense",
        accountId: "preview-daily",
        accountName: "日常账户",
        amountMinor: 60_000,
        currency: "CNY",
        occurredAt: `${previousShopping}T00:00:00.000Z`,
        createdAt: `${previousShopping}T00:01:00.000Z`,
        description: "上月购物",
        category: "购物",
        reversed: false,
      },
    ],
  };
}

async function selectBrowserPreviewDocument() {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.txt,text/markdown,text/plain";
    input.setAttribute("aria-label", "选择本机 Markdown 或文本文件");
    input.addEventListener("cancel", () => resolve({ status: "cancelled" }), { once: true });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve({ status: "cancelled" });
        return;
      }
      try {
        const extension = file.name.split(".").pop()?.toLowerCase();
        if (!new Set(["md", "markdown", "txt"]).has(extension)) {
          throw new Error("DEV 预览目前支持 Markdown 与纯文本文件。");
        }
        const bytes = await file.arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const fileHash = Array.from(new Uint8Array(digest))
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("");
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        resolve({
          status: "extracted",
          fileName: file.name,
          format: extension === "txt" ? "text" : "markdown",
          fileHash,
          byteCount: file.size,
          pageCount: 1,
          ocrPageCount: 0,
          unreadablePageCount: 0,
          text,
          evidence: [{
            page: 1,
            text: text.slice(0, 500),
            rangeStart: 0,
            rangeEnd: text.length,
            confidenceBps: 10_000,
            boundingBox: null,
          }],
          truncated: false,
          privacy: "device_only_ephemeral",
        });
      } catch (error) {
        reject(error);
      }
    }, { once: true });
    input.click();
  });
}

export function VaultPersonalAssetsPreview() {
  const [state, setState] = useState({ status: "loading", snapshot: null, error: "" });
  useEffect(() => {
    let active = true;
    fetch("/__folio_dev/personal-assets", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("本机个人资产预览数据尚未准备好。");
        return response.json();
      })
      .then((snapshot) => {
        if (active) setState({ status: "ready", snapshot, error: "" });
      })
      .catch((error) => {
        if (active) {
          setState({
            status: "error",
            snapshot: null,
            error: typeof error?.message === "string" ? error.message : "无法载入本机个人资产预览。",
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);
  if (state.status !== "ready") {
    return (
      <div className="vault-loading">
        <Brand />
        <span />
        <p>{state.error || "正在从本机读取个人资产预览…"}</p>
      </div>
    );
  }
  return <VaultWorkspacePreview initialSnapshot={state.snapshot} />;
}

export function VaultWorkspacePreview({ fixture = "empty", initialSnapshot = null }) {
  const requestedPreviewView = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get("screen")
    : null;
  const previewInitialView = ["overview", "assets", "cashflow", "reminders", "profile", "assistant", "settings"]
    .includes(requestedPreviewView)
    ? requestedPreviewView
    : fixture === "sync-conflict" || fixture === "settings" ? "settings" : "overview";
  const [previewSnapshot, setPreviewSnapshot] = useState(
    () => initialSnapshot ?? createWorkspacePreviewSnapshot(fixture),
  );
  const [previewConflicts, setPreviewConflicts] = useState(() => (
    fixture === "sync-conflict"
      ? [{
          id: "sync_conflict-0123456789abcdef0123456789abcdef",
          direction: "incoming",
          eventKind: "account_snapshot",
          reasonCode: "concurrent_edit",
          occurredAt: "2026-07-27T13:20:00.000Z",
          remoteDeviceId: "device-preview-7f91c23a",
          canInspect: true,
          canKeepLocal: true,
          resolutionAction: null,
          resolvedAt: null,
        }]
      : []
  ));
  const previewConflictsRef = useRef(previewConflicts);
  const [previewNotificationStatus, setPreviewNotificationStatus] = useState({
    supported: true,
    permission: "not_determined",
    enabled: false,
    privacyMode: "generic",
    deliveryHour: 9,
    scheduledCount: 0,
    nextScheduledAt: null,
  });
  const [previewBiometric, setPreviewBiometric] = useState({
    available: true,
    enabled: true,
  });
  const previewDraft = useRef(null);
  const previewHoldingDraft = useRef(null);
  const previewHoldingOperationDraft = useRef(null);
  const previewHoldingOperationCorrectionDraft = useRef(null);
  const previewTransactionDraft = useRef(null);
  const previewTransactionCorrectionDraft = useRef(null);
  const previewImportDraft = useRef(null);
  const previewReminderDraft = useRef(null);
  const previewPlanningDraft = useRef(null);
  const previewSpeechStopRequested = useRef(false);
  const previewAccountSequence = useRef(0);
  const previewHoldingSequence = useRef(0);
  const previewReminderSequence = useRef(0);
  const listPreviewSyncConflicts = useCallback(async (includeResolved = false) => (
    previewConflictsRef.current.filter(
      (conflict) => includeResolved || !conflict.resolutionAction,
    )
  ), []);
  const inspectPreviewSyncConflict = useCallback(async (conflictId) => {
    const conflict = previewConflictsRef.current.find((item) => item.id === conflictId);
    if (!conflict) throw new Error("预览冲突不存在");
    return {
      conflict,
      incomingPayload: {
        schemaVersion: 1,
        accountId: "preview-salary",
        institutionName: "虚构银行",
        displayName: "另一设备上的虚构工资账户",
        accountType: "cash",
        currency: "CNY",
        notes: "仅用于冲突核对预览，不包含真实财务数据。",
      },
      verifiedAt: new Date().toISOString(),
    };
  }, []);
  const keepLocalPreviewSyncConflict = useCallback(async ({
    conflictId,
    confirmedByUser,
  }) => {
    if (!confirmedByUser) throw new Error("必须明确确认保留本机版本");
    const resolvedAt = new Date().toISOString();
    const nextConflicts = previewConflictsRef.current.map((conflict) => (
      conflict.id === conflictId
        ? {
            ...conflict,
            canKeepLocal: false,
            resolutionAction: "keep_local",
            resolvedAt,
          }
        : conflict
    ));
    previewConflictsRef.current = nextConflicts;
    setPreviewConflicts(nextConflicts);
    return {
      conflictId,
      resolutionAction: "keep_local",
      resolvedAt,
      status: {
        enabled: false,
        pendingCount: 0,
        reconciliationCount: 0,
        inboundConflictCount: 0,
        lastInboundReceivedAt: "2026-07-27T13:20:00.000Z",
      },
    };
  }, []);

  const createPreviewDraft = async (input) => {
    const negative = input.openingBalance.startsWith("-");
    const unsigned = negative ? input.openingBalance.slice(1) : input.openingBalance;
    const [major, fraction = ""] = unsigned.split(".");
    const minor = Number(major) * 100 + Number(fraction.padEnd(2, "0"));
    previewDraft.current = {
      ...input,
      draftId: "preview-account-draft",
      action: "create",
      accountId: `preview-account-${++previewAccountSequence.current}`,
      openingBalanceMinor: negative ? -minor : minor,
      status: "needs_review",
    };
    return previewDraft.current;
  };

  const previewMinor = (value) => {
    const [major, fraction = ""] = String(value).split(".");
    return Number(major) * 100 + Number(fraction.padEnd(2, "0"));
  };

  const previewUnitsMicros = (value) => {
    const [major, fraction = ""] = String(value).split(".");
    return Number(major) * 1_000_000 + Number(fraction.padEnd(6, "0"));
  };

  const createPreviewHoldingDraft = async (input) => {
    const account = previewSnapshot.accounts.find((item) => item.id === input.accountId);
    if (!account) throw new Error("The holding account does not exist or is archived.");
    previewHoldingDraft.current = {
      ...input,
      draftId: "preview-holding-draft",
      action: "create",
      holdingId: `preview-holding-${++previewHoldingSequence.current}`,
      accountName: account.displayName,
      unitsMicros: previewUnitsMicros(input.units),
      costBasisMinor: previewMinor(input.costBasis),
      marketValueMinor: previewMinor(input.marketValue),
      status: "needs_review",
      affectsAccountBalance: false,
    };
    return previewHoldingDraft.current;
  };

  const createPreviewHoldingValuationDraft = async (input) => {
    const holding = previewSnapshot.holdings.find(
      (item) => item.id === input.holdingId && !item.archivedAt,
    );
    if (!holding) throw new Error("The holding does not exist or is archived.");
    previewHoldingDraft.current = {
      draftId: "preview-holding-valuation-draft",
      action: "valuation",
      holdingId: holding.id,
      accountName: holding.accountName,
      name: holding.name,
      currency: holding.currency,
      unitsMicros: previewUnitsMicros(input.units),
      costBasisMinor: previewMinor(input.costBasis),
      marketValueMinor: previewMinor(input.marketValue),
      asOfDate: input.asOfDate,
      status: "needs_review",
      affectsAccountBalance: false,
    };
    return previewHoldingDraft.current;
  };

  const updatePreviewHoldingDraft = async (input) => {
    const holding = previewSnapshot.holdings.find(
      (item) => item.id === input.holdingId && !item.archivedAt,
    );
    if (!holding) throw new Error("The holding does not exist or is archived.");
    previewHoldingDraft.current = {
      ...input,
      draftId: "preview-holding-update-draft",
      action: "update",
      holdingId: holding.id,
      accountId: holding.accountId,
      accountName: holding.accountName,
      currency: holding.currency,
      unitsMicros: holding.unitsMicros,
      costBasisMinor: holding.costBasisMinor,
      marketValueMinor: holding.marketValueMinor,
      asOfDate: holding.asOfDate,
      before: {
        accountId: holding.accountId,
        accountName: holding.accountName,
        name: holding.name,
        productType: holding.productType,
        currency: holding.currency,
        maskedIdentifier: holding.maskedIdentifier,
        notes: holding.notes,
      },
      status: "needs_review",
      affectsAccountBalance: false,
    };
    return previewHoldingDraft.current;
  };

  const archivePreviewHoldingDraft = async (input) => {
    const holding = previewSnapshot.holdings.find(
      (item) => item.id === input.holdingId && !item.archivedAt,
    );
    if (!holding) throw new Error("The holding does not exist or is archived.");
    previewHoldingDraft.current = {
      ...holding,
      draftId: "preview-holding-archive-draft",
      action: "archive",
      holdingId: holding.id,
      status: "needs_review",
      affectsAccountBalance: false,
    };
    return previewHoldingDraft.current;
  };

  const confirmPreviewHoldingDraft = async (draftId) => {
    if (previewHoldingDraft.current?.draftId !== draftId) {
      throw new Error("预览持仓草稿不存在");
    }
    const draft = previewHoldingDraft.current;
    setPreviewSnapshot((current) => {
      if (draft.action === "create") {
        return {
          ...current,
          holdings: [{
            id: draft.holdingId,
            accountId: draft.accountId,
            accountName: draft.accountName,
            name: draft.name,
            productType: draft.productType,
            currency: draft.currency,
            maskedIdentifier: draft.maskedIdentifier,
            notes: draft.notes,
            unitsMicros: draft.unitsMicros,
            costBasisMinor: draft.costBasisMinor,
            marketValueMinor: draft.marketValueMinor,
            gainMinor: draft.marketValueMinor - draft.costBasisMinor,
            returnBps: draft.costBasisMinor > 0
              ? Math.trunc((draft.marketValueMinor - draft.costBasisMinor) * 10_000 / draft.costBasisMinor)
              : null,
            asOfDate: draft.asOfDate,
            valuationCount: 1,
            includedInAccountBalance: true,
            createdAt: new Date().toISOString(),
          }, ...current.holdings],
        };
      }
      return {
        ...current,
        holdings: current.holdings.map((holding) => {
          if (holding.id !== draft.holdingId) return holding;
          if (draft.action === "update") {
            return {
              ...holding,
              name: draft.name,
              productType: draft.productType,
              maskedIdentifier: draft.maskedIdentifier,
              notes: draft.notes,
            };
          }
          if (draft.action === "archive") {
            return { ...holding, archivedAt: new Date().toISOString() };
          }
          return {
            ...holding,
            unitsMicros: draft.unitsMicros,
            costBasisMinor: draft.costBasisMinor,
            marketValueMinor: draft.marketValueMinor,
            gainMinor: draft.marketValueMinor - draft.costBasisMinor,
            returnBps: draft.costBasisMinor > 0
              ? Math.trunc((draft.marketValueMinor - draft.costBasisMinor) * 10_000 / draft.costBasisMinor)
              : null,
            asOfDate: draft.asOfDate,
            valuationCount: Number(holding.valuationCount ?? 0) + 1,
          };
        }),
      };
    });
    previewHoldingDraft.current = null;
    return { draftId, holdingId: draft.holdingId, status: "confirmed" };
  };

  const createPreviewHoldingOperationDraft = async (input) => {
    const holding = previewSnapshot.holdings.find(
      (item) => item.id === input.holdingId && !item.archivedAt,
    );
    if (!holding) throw new Error("The holding does not exist or is archived.");
    const settlement = input.settlementAccountId
      ? previewSnapshot.accounts.find((item) => item.id === input.settlementAccountId)
      : null;
    const affectsPosition = input.operationKind === "purchase" || input.operationKind === "redeem";
    const amountMinor = previewMinor(input.amount);
    previewHoldingOperationDraft.current = {
      draftId: "preview-holding-operation-draft",
      action: "create",
      operationId: `preview-holding-operation-${Date.now()}`,
      operationKind: input.operationKind,
      holdingId: holding.id,
      holdingName: holding.name,
      holdingAccountId: holding.accountId,
      holdingAccountName: holding.accountName,
      settlementAccountId: settlement?.id ?? null,
      settlementAccountName: settlement?.displayName ?? null,
      amountMinor,
      currency: holding.currency,
      occurredOn: input.occurredOn,
      description: input.description,
      notes: input.notes,
      beforeUnitsMicros: holding.unitsMicros,
      beforeCostBasisMinor: holding.costBasisMinor,
      beforeMarketValueMinor: holding.marketValueMinor,
      afterUnitsMicros: affectsPosition ? previewUnitsMicros(input.resultingUnits) : null,
      afterCostBasisMinor: affectsPosition ? previewMinor(input.resultingCostBasis) : null,
      afterMarketValueMinor: affectsPosition ? previewMinor(input.resultingMarketValue) : null,
      valuationDate: affectsPosition ? input.valuationDate : null,
      unitsDeltaMicros: affectsPosition
        ? previewUnitsMicros(input.resultingUnits) - holding.unitsMicros
        : 0,
      balanceEffect: affectsPosition
        ? settlement && settlement.id !== holding.accountId ? "transfer" : "none"
        : input.operationKind === "dividend" ? "income" : "expense",
      status: "needs_review",
    };
    return previewHoldingOperationDraft.current;
  };

  const confirmPreviewHoldingOperationDraft = async (draftId) => {
    if (previewHoldingOperationDraft.current?.draftId !== draftId) {
      throw new Error("预览产品操作草稿不存在");
    }
    const draft = previewHoldingOperationDraft.current;
    setPreviewSnapshot((current) => {
      const signedDeltas = new Map();
      if (draft.balanceEffect === "transfer") {
        if (draft.operationKind === "purchase") {
          signedDeltas.set(draft.settlementAccountId, -draft.amountMinor);
          signedDeltas.set(draft.holdingAccountId, draft.amountMinor);
        } else {
          signedDeltas.set(draft.holdingAccountId, -draft.amountMinor);
          signedDeltas.set(draft.settlementAccountId, draft.amountMinor);
        }
      } else if (draft.balanceEffect === "income") {
        signedDeltas.set(draft.settlementAccountId, draft.amountMinor);
      } else if (draft.balanceEffect === "expense") {
        signedDeltas.set(draft.settlementAccountId, -draft.amountMinor);
      }
      const applyBalance = (item) => ({
        ...item,
        balanceMinor: Number(item.balanceMinor ?? 0) + Number(signedDeltas.get(item.id ?? item.accountId) ?? 0),
      });
      const transaction = draft.balanceEffect === "none" ? [] : [{
        id: draft.balanceEffect === "transfer"
          ? `preview-holding-transfer-${Date.now()}`
          : `preview-holding-event-${Date.now()}`,
        kind: draft.balanceEffect === "transfer" ? "transfer" : draft.balanceEffect,
        accountId: draft.operationKind === "purchase" && draft.balanceEffect === "transfer"
          ? draft.settlementAccountId
          : draft.balanceEffect === "transfer" ? draft.holdingAccountId : draft.settlementAccountId,
        accountName: draft.operationKind === "purchase" && draft.balanceEffect === "transfer"
          ? draft.settlementAccountName
          : draft.balanceEffect === "transfer" ? draft.holdingAccountName : draft.settlementAccountName,
        destinationAccountId: draft.balanceEffect === "transfer"
          ? draft.operationKind === "purchase" ? draft.holdingAccountId : draft.settlementAccountId
          : null,
        destinationAccountName: draft.balanceEffect === "transfer"
          ? draft.operationKind === "purchase" ? draft.holdingAccountName : draft.settlementAccountName
          : null,
        amountMinor: draft.amountMinor,
        currency: draft.currency,
        occurredAt: `${draft.occurredOn}T00:00:00.000Z`,
        createdAt: new Date().toISOString(),
        description: draft.description,
        category: "产品操作",
        reversed: false,
        holdingOperationId: draft.operationId,
      }];
      return {
        ...current,
        accounts: current.accounts.map(applyBalance),
        balances: current.balances.map(applyBalance),
        holdings: current.holdings.map((holding) => (
          holding.id === draft.holdingId && draft.afterUnitsMicros != null
            ? {
                ...holding,
                unitsMicros: draft.afterUnitsMicros,
                costBasisMinor: draft.afterCostBasisMinor,
                marketValueMinor: draft.afterMarketValueMinor,
                gainMinor: draft.afterMarketValueMinor - draft.afterCostBasisMinor,
                returnBps: draft.afterCostBasisMinor > 0
                  ? Math.trunc((draft.afterMarketValueMinor - draft.afterCostBasisMinor) * 10_000 / draft.afterCostBasisMinor)
                  : null,
                asOfDate: draft.valuationDate,
                valuationCount: Number(holding.valuationCount ?? 0) + 1,
              }
            : holding
        )),
        holdingOperations: [{
          id: draft.operationId,
          holdingId: draft.holdingId,
          holdingName: draft.holdingName,
          holdingAccountId: draft.holdingAccountId,
          holdingAccountName: draft.holdingAccountName,
          operationKind: draft.operationKind,
          amountMinor: draft.amountMinor,
          currency: draft.currency,
          unitsDeltaMicros: draft.unitsDeltaMicros,
          beforeUnitsMicros: draft.beforeUnitsMicros,
          beforeCostBasisMinor: draft.beforeCostBasisMinor,
          beforeMarketValueMinor: draft.beforeMarketValueMinor,
          afterUnitsMicros: draft.afterUnitsMicros,
          afterCostBasisMinor: draft.afterCostBasisMinor,
          afterMarketValueMinor: draft.afterMarketValueMinor,
          settlementAccountId: draft.settlementAccountId,
          settlementAccountName: draft.settlementAccountName,
          occurredOn: draft.occurredOn,
          description: draft.description,
          notes: draft.notes,
          balanceEffect: draft.balanceEffect,
          createdAt: new Date().toISOString(),
        }, ...(current.holdingOperations ?? [])],
        transactions: [...transaction, ...current.transactions],
      };
    });
    previewHoldingOperationDraft.current = null;
    return {
      draftId,
      operationId: draft.operationId,
      holdingId: draft.holdingId,
      status: "confirmed",
    };
  };

  const createPreviewHoldingOperationCorrectionDraft = async (input) => {
    const operation = previewSnapshot.holdingOperations.find(
      (item) => item.id === input.operationId && !item.reversed && !item.isReversal,
    );
    if (!operation) throw new Error("The holding operation has already been corrected.");
    previewHoldingOperationCorrectionDraft.current = {
      draftId: "preview-holding-operation-correction-draft",
      action: "reverse",
      correctionId: `preview-holding-correction-${Date.now()}`,
      originalOperationId: operation.id,
      originalOperationKind: operation.operationKind,
      compensatingOperationId: `preview-holding-operation-reversal-${Date.now()}`,
      compensatingOperationKind: {
        purchase: "redeem",
        redeem: "purchase",
        dividend: "fee",
        fee: "dividend",
      }[operation.operationKind],
      holdingId: operation.holdingId,
      holdingName: operation.holdingName,
      holdingAccountName: operation.holdingAccountName,
      settlementAccountName: operation.settlementAccountName,
      amountMinor: operation.amountMinor,
      currency: operation.currency,
      occurredOn: input.occurredOn,
      reason: input.reason,
      restoredUnitsMicros: operation.afterUnitsMicros == null
        ? null
        : operation.beforeUnitsMicros,
      restoredCostBasisMinor: operation.afterCostBasisMinor == null
        ? null
        : operation.beforeCostBasisMinor,
      restoredMarketValueMinor: operation.afterMarketValueMinor == null
        ? null
        : operation.beforeMarketValueMinor,
      ledgerEventCount: operation.balanceEffect === "transfer"
        ? 2
        : operation.balanceEffect === "none" ? 0 : 1,
      status: "needs_review",
      original: operation,
    };
    return previewHoldingOperationCorrectionDraft.current;
  };

  const confirmPreviewHoldingOperationCorrectionDraft = async (draftId) => {
    if (previewHoldingOperationCorrectionDraft.current?.draftId !== draftId) {
      throw new Error("预览产品操作冲销草稿不存在");
    }
    const draft = previewHoldingOperationCorrectionDraft.current;
    const operation = draft.original;
    setPreviewSnapshot((current) => {
      const signedDeltas = new Map();
      if (operation.balanceEffect === "transfer") {
        if (operation.operationKind === "purchase") {
          signedDeltas.set(operation.settlementAccountId, operation.amountMinor);
          signedDeltas.set(operation.holdingAccountId, -operation.amountMinor);
        } else {
          signedDeltas.set(operation.holdingAccountId, operation.amountMinor);
          signedDeltas.set(operation.settlementAccountId, -operation.amountMinor);
        }
      } else if (operation.balanceEffect === "income") {
        signedDeltas.set(operation.settlementAccountId, -operation.amountMinor);
      } else if (operation.balanceEffect === "expense") {
        signedDeltas.set(operation.settlementAccountId, operation.amountMinor);
      }
      const applyBalance = (item) => ({
        ...item,
        balanceMinor: Number(item.balanceMinor ?? 0)
          + Number(signedDeltas.get(item.id ?? item.accountId) ?? 0),
      });
      const compensating = {
        ...operation,
        id: draft.compensatingOperationId,
        operationKind: draft.compensatingOperationKind,
        unitsDeltaMicros: -Number(operation.unitsDeltaMicros ?? 0),
        occurredOn: draft.occurredOn,
        description: `冲销：${operation.description}`,
        notes: draft.reason,
        reversesOperationId: operation.id,
        reversedByOperationId: null,
        correctionReason: draft.reason,
        isReversal: true,
        reversed: false,
        createdAt: new Date().toISOString(),
      };
      return {
        ...current,
        accounts: current.accounts.map(applyBalance),
        balances: current.balances.map(applyBalance),
        holdings: current.holdings.map((holding) => (
          holding.id === operation.holdingId && draft.restoredUnitsMicros != null
            ? {
                ...holding,
                unitsMicros: draft.restoredUnitsMicros,
                costBasisMinor: draft.restoredCostBasisMinor,
                marketValueMinor: draft.restoredMarketValueMinor,
                gainMinor: draft.restoredMarketValueMinor - draft.restoredCostBasisMinor,
                returnBps: draft.restoredCostBasisMinor > 0
                  ? Math.trunc((draft.restoredMarketValueMinor - draft.restoredCostBasisMinor) * 10_000 / draft.restoredCostBasisMinor)
                  : null,
                asOfDate: draft.occurredOn,
                valuationCount: Number(holding.valuationCount ?? 0) + 1,
              }
            : holding
        )),
        holdingOperations: [
          compensating,
          ...current.holdingOperations.map((item) => (
            item.id === operation.id
              ? {
                  ...item,
                  reversed: true,
                  reversedByOperationId: draft.compensatingOperationId,
                  correctionReason: draft.reason,
                }
              : item
          )),
        ],
        transactions: current.transactions.map((item) => (
          item.holdingOperationId === operation.id
            ? { ...item, reversed: true, reversalReason: draft.reason }
            : item
        )),
      };
    });
    previewHoldingOperationCorrectionDraft.current = null;
    return {
      draftId,
      correctionId: draft.correctionId,
      originalOperationId: draft.originalOperationId,
      compensatingOperationId: draft.compensatingOperationId,
      holdingId: draft.holdingId,
      status: "confirmed",
    };
  };

  const confirmPreviewDraft = async (draftId) => {
    if (previewDraft.current?.draftId !== draftId) {
      throw new Error("预览草稿不存在");
    }
    const draft = previewDraft.current;
    if (draft.action === "create") {
      const account = {
        id: draft.accountId,
        institutionName: draft.institutionName,
        displayName: draft.displayName,
        accountType: draft.accountType,
        currency: draft.currency,
        maskedIdentifier: draft.maskedIdentifier,
        notes: draft.notes,
        balanceMinor: draft.openingBalanceMinor,
        lastEventAt: `${draft.balanceDate}T00:00:00.000Z`,
        createdAt: new Date().toISOString(),
      };
      setPreviewSnapshot((current) => ({
        ...current,
        accounts: [...current.accounts, account],
        balances: [...current.balances, {
          accountId: account.id,
          currency: account.currency,
          balanceMinor: account.balanceMinor,
          lastEventAt: account.lastEventAt,
        }],
      }));
    } else if (draft.action === "update") {
      setPreviewSnapshot((current) => ({
        ...current,
        accounts: current.accounts.map((account) => (
          account.id === draft.accountId
            ? {
                ...account,
                institutionName: draft.institutionName,
                displayName: draft.displayName,
                accountType: draft.accountType,
                maskedIdentifier: draft.maskedIdentifier,
                notes: draft.notes,
              }
            : account
        )),
      }));
    } else if (draft.action === "archive") {
      setPreviewSnapshot((current) => ({
        ...current,
        accounts: current.accounts.filter((account) => account.id !== draft.accountId),
        balances: current.balances.filter((balance) => balance.accountId !== draft.accountId),
      }));
    }
    previewDraft.current = null;
    return { draftId, accountId: draft.accountId, status: "confirmed" };
  };

  const updatePreviewDraft = async (input) => {
    const account = previewSnapshot.accounts.find((item) => item.id === input.accountId);
    if (!account) throw new Error("账户不存在或已归档");
    previewDraft.current = {
      ...input,
      draftId: "preview-account-update-draft",
      action: "update",
      currency: account.currency,
      openingBalanceMinor: null,
      balanceDate: null,
      status: "needs_review",
    };
    return previewDraft.current;
  };

  const archivePreviewDraft = async (accountId) => {
    const account = previewSnapshot.accounts.find((item) => item.id === accountId);
    if (!account) throw new Error("账户不存在或已归档");
    if (Number(account.balanceMinor ?? 0) !== 0) {
      throw new Error("A non-zero account cannot be archived.");
    }
    if (previewSnapshot.holdings.some(
      (holding) => holding.accountId === accountId && !holding.archivedAt,
    )) {
      throw new Error("An account with active holdings cannot be archived.");
    }
    previewDraft.current = {
      ...account,
      accountId,
      draftId: "preview-account-archive-draft",
      action: "archive",
      openingBalanceMinor: 0,
      balanceDate: null,
      status: "needs_review",
    };
    return previewDraft.current;
  };

  const createPreviewTransactionDraft = async (input) => {
    const account = previewSnapshot.accounts.find((item) => item.id === input.accountId);
    if (!account) throw new Error("账户不存在或已归档");
    const destination = input.transactionKind === "transfer"
      ? previewSnapshot.accounts.find((item) => item.id === input.destinationAccountId)
      : null;
    if (input.transactionKind === "transfer" && !destination) {
      throw new Error("转入账户不存在或已归档");
    }
    const [major, fraction = ""] = input.amount.split(".");
    previewTransactionDraft.current = {
      ...input,
      draftId: "preview-transaction-draft",
      action: "create",
      accountName: account.displayName,
      destinationAccountName: destination?.displayName ?? null,
      amountMinor: Number(major) * 100 + Number(fraction.padEnd(2, "0")),
      currency: account.currency,
      status: "needs_review",
    };
    return previewTransactionDraft.current;
  };

  const confirmPreviewTransactionDraft = async (draftId) => {
    if (previewTransactionDraft.current?.draftId !== draftId) {
      throw new Error("预览流水草稿不存在");
    }
    const draft = previewTransactionDraft.current;
    const transactionId = `preview-${draft.transactionKind}-${Date.now()}`;
    const sourceDelta = draft.transactionKind === "income"
      ? draft.amountMinor
      : -draft.amountMinor;
    setPreviewSnapshot((current) => {
      const updateAccountBalance = (account, delta) => ({
        ...account,
        balanceMinor: Number(account.balanceMinor ?? 0) + delta,
      });
      const nextAccounts = current.accounts.map((account) => {
        if (account.id === draft.accountId) {
          return updateAccountBalance(account, sourceDelta);
        }
        if (
          draft.transactionKind === "transfer"
          && account.id === draft.destinationAccountId
        ) {
          return updateAccountBalance(account, draft.amountMinor);
        }
        return account;
      });
      const nextBalances = current.balances.map((balance) => {
        if (balance.accountId === draft.accountId) {
          return {
            ...balance,
            balanceMinor: Number(balance.balanceMinor ?? 0) + sourceDelta,
          };
        }
        if (
          draft.transactionKind === "transfer"
          && balance.accountId === draft.destinationAccountId
        ) {
          return {
            ...balance,
            balanceMinor: Number(balance.balanceMinor ?? 0) + draft.amountMinor,
          };
        }
        return balance;
      });
      return {
        ...current,
        accounts: nextAccounts,
        balances: nextBalances,
        transactions: [{
          id: transactionId,
          kind: draft.transactionKind,
          accountId: draft.accountId,
          accountName: draft.accountName,
          destinationAccountId: draft.destinationAccountId,
          destinationAccountName: draft.destinationAccountName,
          amountMinor: draft.amountMinor,
          currency: draft.currency,
          occurredAt: `${draft.occurredOn}T00:00:00.000Z`,
          description: draft.description,
          category: draft.category,
          notes: draft.notes,
          createdAt: new Date().toISOString(),
        }, ...current.transactions],
      };
    });
    previewTransactionDraft.current = null;
    return { draftId, transactionId, status: "confirmed" };
  };

  const createPreviewTransactionCorrectionDraft = async (input) => {
    const original = previewSnapshot.transactions.find((item) => item.id === input.transactionId);
    if (!original) throw new Error("The original transaction does not exist.");
    if (original.reversed) throw new Error("The transaction has already been reversed or revised.");
    const replacementAccount = input.replacement
      ? previewSnapshot.accounts.find((item) => item.id === input.replacement.accountId)
      : null;
    const replacementDestination = input.replacement?.transactionKind === "transfer"
      ? previewSnapshot.accounts.find((item) => item.id === input.replacement.destinationAccountId)
      : null;
    const replacementAmount = input.replacement
      ? (() => {
          const [major, fraction = ""] = input.replacement.amount.split(".");
          return Number(major) * 100 + Number(fraction.padEnd(2, "0"));
        })()
      : null;
    previewTransactionCorrectionDraft.current = {
      draftId: "preview-transaction-correction-draft",
      action: input.correctionKind,
      reason: input.reason,
      status: "needs_review",
      original: {
        ...original,
        transactionKind: original.kind,
        occurredOn: original.occurredAt.slice(0, 10),
      },
      replacement: input.replacement ? {
        ...input.replacement,
        accountName: replacementAccount?.displayName,
        destinationAccountName: replacementDestination?.displayName ?? null,
        amountMinor: replacementAmount,
        currency: replacementAccount?.currency ?? previewSnapshot.vault.baseCurrency,
      } : null,
    };
    return previewTransactionCorrectionDraft.current;
  };

  const confirmPreviewTransactionCorrectionDraft = async (draftId) => {
    if (previewTransactionCorrectionDraft.current?.draftId !== draftId) {
      throw new Error("预览流水修正草稿不存在");
    }
    const draft = previewTransactionCorrectionDraft.current;
    setPreviewSnapshot((current) => {
      const balanceDeltas = new Map();
      const addDelta = (accountId, delta) => {
        balanceDeltas.set(accountId, (balanceDeltas.get(accountId) ?? 0) + delta);
      };
      const original = draft.original;
      if (original.kind === "income") addDelta(original.accountId, -original.amountMinor);
      else if (original.kind === "expense") addDelta(original.accountId, original.amountMinor);
      else {
        addDelta(original.accountId, original.amountMinor);
        addDelta(original.destinationAccountId, -original.amountMinor);
      }
      let replacementTransaction = null;
      if (draft.replacement) {
        const replacement = draft.replacement;
        if (replacement.transactionKind === "income") addDelta(replacement.accountId, replacement.amountMinor);
        else if (replacement.transactionKind === "expense") addDelta(replacement.accountId, -replacement.amountMinor);
        else {
          addDelta(replacement.accountId, -replacement.amountMinor);
          addDelta(replacement.destinationAccountId, replacement.amountMinor);
        }
        replacementTransaction = {
          id: `preview-revision-${Date.now()}`,
          kind: replacement.transactionKind,
          accountId: replacement.accountId,
          accountName: replacement.accountName,
          destinationAccountId: replacement.destinationAccountId,
          destinationAccountName: replacement.destinationAccountName,
          amountMinor: replacement.amountMinor,
          currency: replacement.currency,
          occurredAt: `${replacement.occurredOn}T00:00:00.000Z`,
          description: replacement.description,
          category: replacement.category,
          notes: replacement.notes,
          revisesTransactionId: original.id,
          correctionReason: draft.reason,
          reversed: false,
        };
      }
      const applyBalance = (item) => ({
        ...item,
        balanceMinor: Number(item.balanceMinor ?? 0) + (balanceDeltas.get(item.id ?? item.accountId) ?? 0),
      });
      return {
        ...current,
        accounts: current.accounts.map(applyBalance),
        balances: current.balances.map(applyBalance),
        transactions: [
          ...(replacementTransaction ? [replacementTransaction] : []),
          ...current.transactions.map((item) => (
            item.id === original.id
              ? { ...item, reversed: true, reversalReason: draft.reason }
              : item
          )),
        ],
      };
    });
    previewTransactionCorrectionDraft.current = null;
    return {
      draftId,
      correctionKind: draft.action,
      originalTransactionId: draft.original.id,
      replacementTransactionId: draft.replacement ? "preview-revision" : null,
      status: "confirmed",
    };
  };

  const decodePreviewImport = (contentBase64) => {
    const binary = atob(contentBase64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  };

  const inspectPreviewTransactionImport = async (request) => {
    const bytes = decodePreviewImport(request.contentBase64);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sourceFingerprint = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const text = new TextDecoder().decode(bytes);
    const isTsv = request.fileName.toLowerCase().endsWith(".tsv");
    const parsed = isTsv ? parseTsv(text) : parseCsv(text);
    if (parsed.length < 2) throw new Error("Import table must contain a header and at least one data row.");
    const headers = parsed[0].map((header) => header.trim());
    const match = (...aliases) => headers.find((header) => (
      aliases.some((alias) => header.toLowerCase() === alias.toLowerCase())
    )) ?? null;
    return {
      fileName: request.fileName,
      format: request.fileName.toLowerCase().endsWith(".xlsx") ? "xlsx" : isTsv ? "tsv" : "csv",
      sheetName: null,
      sourceFingerprint,
      headers,
      sampleRows: parsed.slice(1, 6),
      rowCount: parsed.length - 1,
      suggestedMapping: {
        date: match("日期", "交易日期", "date"),
        amount: match("金额", "交易金额", "amount"),
        transactionType: match("类型", "收支类型", "type"),
        description: match("说明", "备注", "摘要", "description"),
        category: match("分类", "类别", "category"),
        currency: match("币种", "currency"),
        externalId: match("流水号", "交易号", "外部ID", "external id"),
      },
    };
  };

  const createPreviewTransactionImportDraft = async (input) => {
    const inspection = await inspectPreviewTransactionImport(input);
    const account = previewSnapshot.accounts.find((item) => item.id === input.accountId);
    if (!account) throw new Error("The selected import account is unavailable.");
    const text = new TextDecoder().decode(decodePreviewImport(input.contentBase64));
    const parsed = input.fileName.toLowerCase().endsWith(".tsv")
      ? parseTsv(text)
      : parseCsv(text);
    const headers = parsed[0].map((header) => header.trim());
    const index = (name) => name ? headers.indexOf(name) : -1;
    const positions = {
      date: index(input.mapping.date),
      amount: index(input.mapping.amount),
      transactionType: index(input.mapping.transactionType),
      description: index(input.mapping.description),
      category: index(input.mapping.category),
      currency: index(input.mapping.currency),
      externalId: index(input.mapping.externalId),
    };
    const rows = [];
    const errors = [];
    let totalIncomeMinor = 0;
    let totalExpenseMinor = 0;
    parsed.slice(1).forEach((values, rowIndex) => {
      const rowNumber = rowIndex + 2;
      try {
        const date = values[positions.date]?.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date must be a valid YYYY-MM-DD value.");
        const rawAmount = values[positions.amount]?.trim().replaceAll(",", "");
        const amountNumber = Number(rawAmount);
        if (!Number.isFinite(amountNumber) || amountNumber === 0) throw new Error("Amount must be greater than zero.");
        const explicitType = positions.transactionType >= 0
          ? values[positions.transactionType]?.trim().toLowerCase()
          : "";
        const transactionKind = ["收入", "income", "credit"].includes(explicitType)
          ? "income"
          : ["支出", "expense", "debit"].includes(explicitType)
            ? "expense"
            : amountNumber < 0 ? "expense" : "income";
        const amountMinor = Math.round(Math.abs(amountNumber) * 100);
        if (transactionKind === "income") totalIncomeMinor += amountMinor;
        else totalExpenseMinor += amountMinor;
        rows.push({
          row: rowNumber,
          eventId: `preview-import-event-${rowNumber}`,
          transactionKind,
          amountMinor,
          currency: account.currency,
          occurredOn: date,
          description: positions.description >= 0
            ? values[positions.description]?.trim() || `导入流水 · 第 ${rowNumber} 行`
            : `导入流水 · 第 ${rowNumber} 行`,
          category: positions.category >= 0 ? values[positions.category]?.trim() || null : null,
          externalId: positions.externalId >= 0 ? values[positions.externalId]?.trim() || null : null,
        });
      } catch (rowError) {
        errors.push({ row: rowNumber, message: rowError.message });
      }
    });
    if (!rows.length) throw new Error("No valid income or expense rows are available for review.");
    const report = {
      acceptedCount: rows.length,
      errorCount: errors.length,
      totalIncomeMinor,
      totalExpenseMinor,
      netChangeMinor: totalIncomeMinor - totalExpenseMinor,
      currency: account.currency,
    };
    const alreadyImported = previewSnapshot.imports.some((item) => (
      item.sourceFingerprint === inspection.sourceFingerprint && item.status === "confirmed"
    ));
    previewImportDraft.current = {
      draftId: alreadyImported ? null : "preview-import-draft",
      importBatchId: alreadyImported ? "preview-import-confirmed" : "preview-import-batch",
      sourceName: input.fileName,
      sourceFormat: inspection.format,
      sourceFingerprint: inspection.sourceFingerprint,
      sheetName: inspection.sheetName,
      accountId: account.id,
      accountName: account.displayName,
      currency: account.currency,
      rows,
      errors,
      report,
      alreadyImported,
      status: alreadyImported ? "confirmed" : "needs_review",
    };
    return previewImportDraft.current;
  };

  const confirmPreviewTransactionImportDraft = async (draftId) => {
    if (previewImportDraft.current?.draftId !== draftId) {
      throw new Error("预览导入草稿不存在");
    }
    const draft = previewImportDraft.current;
    setPreviewSnapshot((current) => {
      const delta = draft.report.netChangeMinor;
      const updateBalance = (item) => (
        (item.id ?? item.accountId) === draft.accountId
          ? { ...item, balanceMinor: Number(item.balanceMinor ?? 0) + delta }
          : item
      );
      const importedTransactions = draft.rows.map((row) => ({
        id: row.eventId,
        kind: row.transactionKind,
        accountId: draft.accountId,
        accountName: draft.accountName,
        destinationAccountId: null,
        destinationAccountName: null,
        amountMinor: row.amountMinor,
        currency: row.currency,
        occurredAt: `${row.occurredOn}T00:00:00.000Z`,
        description: row.description,
        category: row.category,
        notes: null,
        createdAt: new Date().toISOString(),
      }));
      return {
        ...current,
        accounts: current.accounts.map(updateBalance),
        balances: current.balances.map(updateBalance),
        transactions: [...importedTransactions.reverse(), ...current.transactions],
        imports: [{
          id: draft.importBatchId,
          sourceType: draft.sourceFormat,
          sourceName: draft.sourceName,
          sourceFingerprint: draft.sourceFingerprint,
          parserVersion: "folio-bank-import-v1",
          status: "confirmed",
          rowCount: draft.report.acceptedCount + draft.report.errorCount,
          errorCount: draft.report.errorCount,
          createdAt: new Date().toISOString(),
          confirmedAt: new Date().toISOString(),
        }, ...current.imports],
      };
    });
    previewImportDraft.current = null;
    return {
      draftId,
      importBatchId: draft.importBatchId,
      report: draft.report,
      status: "confirmed",
    };
  };

  const previewReminderAmount = (value) => {
    if (!value) return null;
    const [major, fraction = ""] = value.split(".");
    return Number(major) * 100 + Number(fraction.padEnd(2, "0"));
  };

  const createPreviewReminderDraft = async (input) => {
    const account = previewSnapshot.accounts.find((item) => item.id === input.linkedAccountId);
    previewReminderDraft.current = {
      ...input,
      draftId: "preview-reminder-draft",
      action: "create",
      reminderId: `preview-reminder-${++previewReminderSequence.current}`,
      linkedAccountName: account?.displayName ?? null,
      amountMinor: previewReminderAmount(input.amount),
      currency: input.amount ? account?.currency ?? previewSnapshot.vault.baseCurrency : null,
      status: "active",
      reviewStatus: "needs_review",
    };
    return previewReminderDraft.current;
  };

  const updatePreviewReminderDraft = async (input) => {
    const reminder = previewSnapshot.reminders.find((item) => item.id === input.reminderId);
    if (!reminder || reminder.status === "completed") throw new Error("Only an active reminder can be edited.");
    const account = previewSnapshot.accounts.find((item) => item.id === input.linkedAccountId);
    previewReminderDraft.current = {
      ...input,
      draftId: "preview-reminder-update-draft",
      action: "update",
      linkedAccountName: account?.displayName ?? null,
      amountMinor: previewReminderAmount(input.amount),
      currency: input.amount ? account?.currency ?? previewSnapshot.vault.baseCurrency : null,
      status: reminder.status,
      reviewStatus: "needs_review",
    };
    return previewReminderDraft.current;
  };

  const actionPreviewReminderDraft = async (reminderId, action) => {
    const reminder = previewSnapshot.reminders.find((item) => item.id === reminderId);
    if (!reminder) throw new Error("事项不存在");
    if (action === "complete" && reminder.status === "completed") {
      throw new Error("Only an active reminder can be edited or completed.");
    }
    const nextDueOn = action === "complete"
      ? nextPreviewReminderDueOn(reminder.dueOn, reminder.recurrenceRule)
      : null;
    previewReminderDraft.current = {
      ...reminder,
      draftId: `preview-reminder-${action}-draft`,
      reminderId,
      action,
      completedDueOn: action === "complete" ? reminder.dueOn : null,
      nextDueOn,
      dueOn: nextDueOn ?? reminder.dueOn,
      status: action === "complete" && nextDueOn ? "active" : action === "complete" ? "completed" : "ignored",
      reviewStatus: "needs_review",
    };
    return previewReminderDraft.current;
  };

  const confirmPreviewReminderDraft = async (draftId) => {
    if (previewReminderDraft.current?.draftId !== draftId) {
      throw new Error("预览事项草稿不存在");
    }
    const draft = previewReminderDraft.current;
    setPreviewSnapshot((current) => {
      if (draft.action === "archive") {
        return {
          ...current,
          reminders: current.reminders.filter((item) => item.id !== draft.reminderId),
        };
      }
      const normalized = {
        id: draft.reminderId,
        title: draft.title,
        category: draft.category,
        linkedAccountId: draft.linkedAccountId,
        linkedAccountName: draft.linkedAccountName,
        amountMinor: draft.amountMinor,
        currency: draft.currency,
        dueOn: draft.dueOn,
        advanceDays: draft.advanceDays,
        recurrenceRule: draft.recurrenceRule,
        notes: draft.notes,
        status: draft.status,
        completedOccurrences: draft.action === "complete"
          ? Number(current.reminders.find((item) => item.id === draft.reminderId)?.completedOccurrences ?? 0) + 1
          : Number(draft.completedOccurrences ?? 0),
        lastCompletedOn: draft.action === "complete"
          ? draft.completedDueOn
          : draft.lastCompletedOn ?? null,
        createdAt: draft.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (draft.action === "create") {
        return { ...current, reminders: [normalized, ...current.reminders] };
      }
      return {
        ...current,
        reminders: current.reminders.map((item) => (
          item.id === draft.reminderId ? { ...item, ...normalized } : item
        )),
      };
    });
    previewReminderDraft.current = null;
    return {
      draftId,
      reminderId: draft.reminderId,
      action: draft.action,
      status: "confirmed",
    };
  };

  const savePreviewPlanningDraft = async (input) => {
    const [major, fraction = ""] = input.cashBuffer.split(".");
    previewPlanningDraft.current = {
      ...input,
      draftId: "preview-planning-draft",
      action: previewSnapshot.planning ? "update" : "create",
      profileId: previewSnapshot.planning?.id ?? "preview-planning",
      baseCurrency: previewSnapshot.vault.baseCurrency,
      cashBufferMinor: Number(major) * 100 + Number(fraction.padEnd(2, "0")),
      reviewStatus: "needs_review",
    };
    return previewPlanningDraft.current;
  };

  const confirmPreviewPlanningDraft = async (draftId) => {
    if (previewPlanningDraft.current?.draftId !== draftId) {
      throw new Error("预览规划草稿不存在");
    }
    const draft = previewPlanningDraft.current;
    setPreviewSnapshot((current) => ({
      ...current,
      planning: {
        id: draft.profileId,
        name: draft.name,
        baseCurrency: draft.baseCurrency,
        cashBufferMinor: draft.cashBufferMinor,
        allocations: draft.allocations,
        versionId: `preview-version-${Date.now()}`,
        notes: draft.notes,
        createdAt: current.planning?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }));
    previewPlanningDraft.current = null;
    return { draftId, profileId: draft.profileId, action: draft.action, status: "confirmed" };
  };

  return (
    <LocalWorkspace
      snapshot={previewSnapshot}
      biometric={previewBiometric}
      syncStatus={{
        enabled: false,
        pendingCount: 0,
        reconciliationCount: 0,
        inboundConflictCount: previewConflicts.filter(
          (conflict) => !conflict.resolutionAction,
        ).length,
        lastInboundReceivedAt: "2026-07-27T13:20:00.000Z",
      }}
      onListSyncConflicts={listPreviewSyncConflicts}
      onInspectSyncConflict={inspectPreviewSyncConflict}
      onKeepLocalSyncConflict={keepLocalPreviewSyncConflict}
      initialView={previewInitialView}
      onCreateAccountDraft={createPreviewDraft}
      onUpdateAccountDraft={updatePreviewDraft}
      onArchiveAccountDraft={archivePreviewDraft}
      onConfirmAccountDraft={confirmPreviewDraft}
      onRejectAccountDraft={async () => {
        previewDraft.current = null;
        return { status: "rejected" };
      }}
      onCreateHoldingDraft={createPreviewHoldingDraft}
      onCreateHoldingValuationDraft={createPreviewHoldingValuationDraft}
      onUpdateHoldingDraft={updatePreviewHoldingDraft}
      onArchiveHoldingDraft={archivePreviewHoldingDraft}
      onConfirmHoldingDraft={confirmPreviewHoldingDraft}
      onRejectHoldingDraft={async () => {
        previewHoldingDraft.current = null;
        return { status: "rejected" };
      }}
      onCreateHoldingOperationDraft={createPreviewHoldingOperationDraft}
      onConfirmHoldingOperationDraft={confirmPreviewHoldingOperationDraft}
      onRejectHoldingOperationDraft={async () => {
        previewHoldingOperationDraft.current = null;
        return { status: "rejected" };
      }}
      onCreateHoldingOperationCorrectionDraft={createPreviewHoldingOperationCorrectionDraft}
      onConfirmHoldingOperationCorrectionDraft={confirmPreviewHoldingOperationCorrectionDraft}
      onRejectHoldingOperationCorrectionDraft={async () => {
        previewHoldingOperationCorrectionDraft.current = null;
        return { status: "rejected" };
      }}
      onCreateTransactionDraft={createPreviewTransactionDraft}
      onConfirmTransactionDraft={confirmPreviewTransactionDraft}
      onRejectTransactionDraft={async () => {
        previewTransactionDraft.current = null;
        return { status: "rejected" };
      }}
      onCreateTransactionCorrectionDraft={createPreviewTransactionCorrectionDraft}
      onConfirmTransactionCorrectionDraft={confirmPreviewTransactionCorrectionDraft}
      onRejectTransactionCorrectionDraft={async () => {
        previewTransactionCorrectionDraft.current = null;
        return { status: "rejected" };
      }}
      onInspectTransactionImport={inspectPreviewTransactionImport}
      onCreateTransactionImportDraft={createPreviewTransactionImportDraft}
      onConfirmTransactionImportDraft={confirmPreviewTransactionImportDraft}
      onRejectTransactionImportDraft={async () => {
        previewImportDraft.current = null;
        return { status: "rejected" };
      }}
      onCreateReminderDraft={createPreviewReminderDraft}
      onUpdateReminderDraft={updatePreviewReminderDraft}
      onCompleteReminderDraft={(reminderId) => actionPreviewReminderDraft(reminderId, "complete")}
      onArchiveReminderDraft={(reminderId) => actionPreviewReminderDraft(reminderId, "archive")}
      onConfirmReminderDraft={confirmPreviewReminderDraft}
      onRejectReminderDraft={async () => {
        previewReminderDraft.current = null;
        return { status: "rejected" };
      }}
      onSavePlanningDraft={savePreviewPlanningDraft}
      onConfirmPlanningDraft={confirmPreviewPlanningDraft}
      onRejectPlanningDraft={async () => {
        previewPlanningDraft.current = null;
        return { status: "rejected" };
      }}
      notificationStatus={previewNotificationStatus}
      onEnableNotifications={async (privacyMode) => {
        const status = {
          ...previewNotificationStatus,
          permission: "authorized",
          enabled: true,
          privacyMode,
          scheduledCount: previewSnapshot.reminders.filter(
            (item) => item.status === "active" && !item.archivedAt,
          ).length,
        };
        setPreviewNotificationStatus(status);
        return status;
      }}
      onDisableNotifications={async () => {
        const status = {
          ...previewNotificationStatus,
          enabled: false,
          scheduledCount: 0,
        };
        setPreviewNotificationStatus(status);
        return status;
      }}
      onEnableBiometric={async () => {
        const status = { available: true, enabled: true };
        setPreviewBiometric(status);
        return status;
      }}
      onDisableBiometric={async () => {
        const status = { available: true, enabled: false };
        setPreviewBiometric(status);
        return status;
      }}
      onChangePassword={async () => ({
        status: "changed",
        biometricEnabled: previewBiometric.enabled,
        changedAt: new Date().toISOString(),
      })}
      onRecordAiProposal={async (request) => ({
        proposalId: "preview-ai-proposal",
        domainDraftId: request.domainDraftId,
        status: "needs_review",
      })}
      onSelectDocumentEvidence={selectBrowserPreviewDocument}
      documentCapability="browser_text_only"
      onTranscribeSpeech={async (_request, onEvent) => {
        const previewPhrases = fixture === "film"
          ? [
              "建行新增租金收入八千元",
              "建行新增租金收入八千元，另外八月二十日提醒我交保费",
              "建行新增租金收入八千元，另外八月二十日提醒我交保费一万元。",
            ]
          : [
              "今天从日常账户",
              "今天从日常账户花了三百六十八元",
              "今天从日常账户花了三百六十八元买日用品。",
            ];
        previewSpeechStopRequested.current = false;
        let latestText = "";
        onEvent?.({ kind: "listening" });
        for (const [index, text] of previewPhrases.entries()) {
          if (previewSpeechStopRequested.current) break;
          latestText = text;
          onEvent?.({ kind: "level", level: [0.24, 0.68, 0.42][index] });
          onEvent?.({ kind: "partial", text });
          for (let tick = 0; tick < 30 && !previewSpeechStopRequested.current; tick += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 80));
          }
        }
        const finalText = latestText || previewPhrases[0];
        onEvent?.({ kind: "final", text: finalText });
        onEvent?.({ kind: "stopped" });
        return {
          status: "transcribed",
          text: finalText,
          locale: "zh-CN",
          onDevice: true,
        };
      }}
      onStopSpeechCapture={async () => {
        previewSpeechStopRequested.current = true;
        return { status: "stop_requested", requested: true };
      }}
      knownVaults={[{
        vaultId: "primary",
        displayName: DEFAULT_VAULT_NAME,
        baseCurrency: DEFAULT_BASE_CURRENCY,
      }]}
      onCreateBackup={async () => ({
        status: "exported",
        fileName: "Folio-preview.folio-backup",
        byteCount: 245760,
        createdAt: "2026-07-26T21:30:00.000Z",
        fingerprint: "7f33ed88688b4f69ef370e055ea98c2a",
      })}
      onCreateDataExport={async (request) => ({
        status: "exported",
        fileName: "Folio-preview-portable-data.folio-export.zip",
        byteCount: 98304,
        exportedAt: "2026-07-27T22:00:00.000Z",
        fingerprint: "8a9e4c21a592c4d0c4ca8fd095c91b2a",
        accountCount: previewSnapshot.accounts.length,
        holdingCount: previewSnapshot.holdings.length,
        holdingValuationCount: previewSnapshot.holdings.reduce(
          (sum, holding) => sum + Number(holding.valuationCount ?? 0),
          0,
        ),
        holdingOperationCount: previewSnapshot.holdingOperations.length,
        ledgerEventCount: previewSnapshot.transactions.length,
        reminderCount: previewSnapshot.reminders.length,
        auditEventCount: request.includeAuditLog ? 12 : 0,
      })}
      onSaveMarkdownExport={async ({ content, fileName }) => (
        downloadStructuredFolioMarkdown(content, fileName)
      )}
      onClearAllData={async () => {
        setPreviewSnapshot(createWorkspacePreviewSnapshot("empty"));
        return {
          status: "cleared",
          vaultId: "primary",
          deletedEmailSourceCount: 1,
        };
      }}
      onSelectBackup={async () => ({
        status: "selected",
        selectionToken: "preview-backup-selection",
        fileName: "Folio-preview.folio-backup",
        byteCount: 245760,
        fingerprint: "7f33ed88688b4f69ef370e055ea98c2a",
      })}
      onInspectBackup={async () => ({
        restoreToken: "preview-backup-selection",
        sourceVaultId: "primary",
        displayName: DEFAULT_VAULT_NAME,
        baseCurrency: "CNY",
        createdAt: "2026-07-26T21:30:00.000Z",
        schemaVersion: 11,
        accountCount: previewSnapshot.accounts.length,
        holdingCount: previewSnapshot.holdings.length,
        holdingValuationCount: previewSnapshot.holdings.reduce(
          (sum, holding) => sum + Number(holding.valuationCount ?? 0),
          0,
        ),
        holdingOperationCount: previewSnapshot.holdingOperations.length,
        ledgerEventCount: previewSnapshot.transactions.length,
        reminderCount: previewSnapshot.reminders.length,
        databaseBytes: 184320,
        fingerprint: "7f33ed88688b4f69ef370e055ea98c2a",
        suggestedVaultId: "primary-restored",
      })}
      onDiscardBackupSelection={async () => ({ status: "discarded" })}
      onConfirmBackupRestore={async (request) => ({
        vaultId: request.targetVaultId,
        sessionId: "preview-restored-session",
        displayName: request.targetDisplayName,
        baseCurrency: "CNY",
        accountCount: previewSnapshot.accounts.length,
        holdingCount: previewSnapshot.holdings.length,
        holdingValuationCount: previewSnapshot.holdings.reduce(
          (sum, holding) => sum + Number(holding.valuationCount ?? 0),
          0,
        ),
        holdingOperationCount: previewSnapshot.holdingOperations.length,
        ledgerEventCount: previewSnapshot.transactions.length,
        reminderCount: previewSnapshot.reminders.length,
      })}
      onLock={() => {}}
    />
  );
}
