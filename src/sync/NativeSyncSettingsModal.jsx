import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowsClockwise,
  Check,
  CloudCheck,
  CloudSlash,
  Database,
  Devices,
  Eye,
  EyeSlash,
  Key,
  LockKey,
  ShieldCheck,
  SignOut,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  presentAuthError,
  presentNativeSyncError,
} from "./nativeSyncController.js";

const EMPTY_STATUS = Object.freeze({
  enabled: false,
  pendingCount: 0,
  reconciliationCount: 0,
  inboundConflictCount: 0,
  lastInboundReceivedAt: null,
});

function StatusMessage({ tone = "notice", children }) {
  return (
    <div className={`native-sync-message ${tone}`} role={tone === "error" ? "alert" : "status"}>
      {tone === "error" ? <WarningCircle weight="fill" /> : <ShieldCheck weight="fill" />}
      <span>{children}</span>
    </div>
  );
}

const EVENT_KIND_LABELS = Object.freeze({
  account_snapshot: "账户资料",
  holding_snapshot: "持仓资料",
  holding_valuation: "持仓估值",
  ledger_event: "账本事件",
  holding_operation: "产品操作",
  holding_operation_correction: "产品补偿更正",
  reminder_snapshot: "财务事项",
});

const CONFLICT_REASON_LABELS = Object.freeze({
  concurrent_edit: "另一设备修改了同一记录",
  missing_dependency: "缺少前置记录",
  invalid_payload: "远端内容未通过领域校验",
  hash_gap: "设备事件链存在缺口",
  event_id_collision: "事件标识发生碰撞",
  idempotency_collision: "幂等标识发生碰撞",
  needs_reconciliation: "远端投递需要核对",
});

const PAYLOAD_LABELS = Object.freeze({
  institutionName: "机构",
  displayName: "账户名称",
  accountType: "账户类型",
  name: "产品名称",
  productType: "产品类型",
  title: "事项标题",
  category: "分类",
  currency: "币种",
  amountMinor: "金额",
  deltaMinor: "账本变动",
  costBasisMinor: "累计成本",
  marketValueMinor: "当前市值",
  unitsMicros: "持有数量",
  unitsDeltaMicros: "数量变化",
  operationKind: "产品操作",
  occurredAt: "发生时间",
  occurredOn: "发生日期",
  asOfDate: "估值日期",
  dueAt: "关注日期",
  description: "说明",
  notes: "备注",
  status: "状态",
  archivedAt: "归档时间",
  recurrenceRule: "重复规则",
});

function shortIdentifier(value) {
  const text = String(value ?? "");
  return text.length > 12 ? `…${text.slice(-8)}` : text;
}

function formatPayloadValue(key, value, payload) {
  if (value == null || value === "") return "未设置";
  if (key.endsWith("Minor") && Number.isSafeInteger(value)) {
    try {
      return new Intl.NumberFormat("zh-CN", {
        style: "currency",
        currency: payload.currency ?? "CNY",
      }).format(value / 100);
    } catch {
      return `${value} 最小货币单位`;
    }
  }
  if ((key === "unitsMicros" || key === "unitsDeltaMicros") && Number.isSafeInteger(value)) {
    return `${value / 1_000_000}`;
  }
  if (key.endsWith("Id")) return shortIdentifier(value);
  if (Array.isArray(value)) return `${value.length} 条记录`;
  if (typeof value === "object") return "包含结构化元数据";
  const text = String(value);
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

function conflictPayloadRows(payload = {}) {
  const excluded = new Set([
    "schemaVersion",
    "localIdempotencyKey",
    "draftId",
    "draftSourceType",
    "confirmationDraftId",
    "createdAt",
    "updatedAt",
    "localCreatedAt",
  ]);
  return Object.entries(payload)
    .filter(([key]) => !excluded.has(key))
    .slice(0, 14)
    .map(([key, value]) => ({
      key,
      label: PAYLOAD_LABELS[key] ?? key.replace(/([A-Z])/g, " $1"),
      value: formatPayloadValue(key, value, payload),
    }));
}

export function NativeSyncSettingsModal({
  configured,
  controller,
  initialStatus = EMPTY_STATUS,
  onStatusChange = () => {},
  onListConflicts = async () => [],
  onInspectConflict = async () => {
    throw new Error("Sync conflict inspection is unavailable.");
  },
  onKeepLocalConflict = async () => {
    throw new Error("Sync conflict resolution is unavailable.");
  },
  onClose,
}) {
  const [authState, setAuthState] = useState({
    status: configured ? "checking" : "unavailable",
    user: null,
  });
  const [syncStatus, setSyncStatus] = useState(initialStatus ?? EMPTY_STATUS);
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [enableConfirmed, setEnableConfirmed] = useState(false);
  const [disableConfirmed, setDisableConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflicts, setConflicts] = useState([]);
  const [conflictsLoading, setConflictsLoading] = useState(true);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [inspection, setInspection] = useState(null);
  const [keepLocalConfirmed, setKeepLocalConfirmed] = useState(false);
  const [devices, setDevices] = useState([]);
  const [devicesLoading, setDevicesLoading] = useState(false);

  const publishStatus = (next) => {
    if (!next) return;
    setSyncStatus(next);
    onStatusChange(next);
  };

  useEffect(() => {
    if (!configured || !controller) return undefined;
    let active = true;
    let stop = () => {};
    controller.start((next) => {
      if (active) setAuthState(next);
    }).then((cleanup) => {
      if (active) stop = cleanup;
      else cleanup();
    }).catch((nextError) => {
      if (!active) return;
      setAuthState({ status: "signed_out", user: null });
      setError(presentAuthError(nextError));
    });
    controller.getStatus().then((next) => {
      if (active) publishStatus(next);
    }).catch((nextError) => {
      if (active) setError(presentNativeSyncError(nextError));
    });
    return () => {
      active = false;
      stop();
    };
  }, [configured, controller]);

  const loadConflicts = async (showResolved = includeResolved) => {
    setConflictsLoading(true);
    try {
      const next = await onListConflicts(showResolved);
      setConflicts(Array.isArray(next) ? next : []);
    } catch (nextError) {
      setError(presentNativeSyncError(nextError));
    } finally {
      setConflictsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    onListConflicts(false).then((next) => {
      if (active) setConflicts(Array.isArray(next) ? next : []);
    }).catch((nextError) => {
      if (active) setError(presentNativeSyncError(nextError));
    }).finally(() => {
      if (active) setConflictsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [onListConflicts]);

  useEffect(() => {
    if (
      authState.status !== "authenticated"
      || !syncStatus.enabled
      || typeof controller?.listDevices !== "function"
    ) {
      setDevices([]);
      return undefined;
    }
    let active = true;
    setDevicesLoading(true);
    controller.listDevices().then((next) => {
      if (active) setDevices(Array.isArray(next) ? next : []);
    }).catch(() => {
      if (active) setDevices([]);
    }).finally(() => {
      if (active) setDevicesLoading(false);
    });
    return () => {
      active = false;
    };
  }, [authState.status, controller, syncStatus.cloudVaultId, syncStatus.enabled]);

  const run = async (operation) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } finally {
      setBusy(false);
    }
  };

  const submitIdentity = (event) => {
    event.preventDefault();
    void run(async () => {
      try {
        if (mode === "signup") {
          const result = await controller.signUpWithPassword({ email, password });
          setPassword("");
          if (result.needsEmailConfirmation) {
            setNotice("账户已创建。请完成邮箱确认后返回登录。");
            setMode("signin");
          } else {
            setNotice("云端身份已创建并登录；同步仍未自动启用。");
          }
        } else {
          await controller.signInWithPassword({ email, password });
          setPassword("");
          setNotice("云端身份已验证；同步状态没有被自动改变。");
        }
      } catch (nextError) {
        setPassword("");
        setError(presentAuthError(nextError));
      }
    });
  };

  const enable = () => {
    void run(async () => {
      try {
        const next = await controller.enable({
          confirmedByUser: enableConfirmed,
          platform: "macos",
        });
        publishStatus(next);
        setEnableConfirmed(false);
        setNotice("端到端加密同步已启用。云端只保存密文事件与必要的路由元数据。");
      } catch (nextError) {
        try {
          publishStatus(await controller.getStatus());
        } catch {
          // The original operation error remains more useful than a refresh error.
        }
        setError(presentNativeSyncError(nextError));
      }
    });
  };

  const synchronize = () => {
    void run(async () => {
      try {
        const result = await controller.synchronize({ batchSize: 250 });
        const next = result?.download?.status ?? result?.upload?.status
          ?? await controller.getStatus();
        publishStatus(next);
        const conflictCount = Number(next?.reconciliationCount ?? 0)
          + Number(next?.inboundConflictCount ?? 0);
        setNotice(conflictCount
          ? `本批同步完成，但有 ${conflictCount} 项已隔离等待核对，未覆盖本地记录。`
          : "本批密文事件已安全同步；服务器未获得账户、金额或备注明文。");
      } catch (nextError) {
        try {
          publishStatus(await controller.getStatus());
        } catch {
          // Keep the synchronization error as the user-facing result.
        }
        setError(presentNativeSyncError(nextError));
      }
    });
  };

  const disable = () => {
    void run(async () => {
      try {
        const next = await controller.disable({ confirmedByUser: disableConfirmed });
        publishStatus(next);
        setDisableConfirmed(false);
        setNotice("此设备已停止上传和下载。云端既有密文副本未被删除。");
      } catch (nextError) {
        setError(presentNativeSyncError(nextError));
      }
    });
  };

  const signOut = () => {
    void run(async () => {
      try {
        await controller.signOut();
        setPassword("");
        setNotice(syncStatus.enabled
          ? "身份会话已退出；此设备的同步已暂停，本地数据仍保持启用配置。"
          : "云端身份会话已退出。");
      } catch (nextError) {
        setError(presentAuthError(nextError));
      }
    });
  };

  const inspectConflict = (conflictId) => {
    void run(async () => {
      try {
        const next = await onInspectConflict(conflictId);
        setInspection(next);
        setKeepLocalConfirmed(false);
      } catch (nextError) {
        setError(presentNativeSyncError(nextError));
      }
    });
  };

  const keepLocalConflict = () => {
    if (!inspection?.conflict?.id) return;
    void run(async () => {
      try {
        const result = await onKeepLocalConflict({
          conflictId: inspection.conflict.id,
          confirmedByUser: keepLocalConfirmed,
        });
        publishStatus(result.status);
        setInspection(null);
        setKeepLocalConfirmed(false);
        await loadConflicts(includeResolved);
        setNotice("已明确保留本机版本。远端密文事件和解决记录仍保留，未删除或覆盖历史。");
      } catch (nextError) {
        setError(presentNativeSyncError(nextError));
      }
    });
  };

  const conflictCount = Number(syncStatus?.reconciliationCount ?? 0)
    + Number(syncStatus?.inboundConflictCount ?? 0);
  const authenticated = authState.status === "authenticated" && authState.user;

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="action-modal native-sync-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="native-sync-title"
      >
        <button className="modal-close" type="button" onClick={onClose} aria-label="关闭加密同步设置">
          <X />
        </button>
        <header className="native-sync-heading">
          <span>{syncStatus.enabled ? <CloudCheck weight="duotone" /> : <CloudSlash weight="duotone" />}</span>
          <div>
            <small>可选能力 · 默认纯本地</small>
            <h2 id="native-sync-title">端到端加密同步</h2>
            <p>云端身份、设备解锁和本地数据解密是三层独立保护。登录不会自动上传数据。</p>
          </div>
        </header>

        <div className="native-sync-boundaries">
          <div><LockKey /><span><b>本机数据</b><small>SQLCipher 明文只在解锁设备内出现</small></span></div>
          <div><Key /><span><b>设备端加密</b><small>事件上传前使用设备同步密钥加密</small></span></div>
          <div><Database /><span><b>云端边界</b><small>只保存密文、设备与排序元数据</small></span></div>
        </div>

        {!configured && (
          <StatusMessage tone="error">
            当前安装包尚未配置 Folio 云端服务。你仍可继续使用本地数据、Touch ID 和 Markdown 导出。
          </StatusMessage>
        )}

        {configured && authState.status === "checking" && (
          <div className="native-sync-checking"><span />正在检查内存身份会话…</div>
        )}

        {configured && !authenticated && authState.status !== "checking" && (
          <form className="native-sync-auth-form" onSubmit={submitIdentity}>
            {syncStatus.enabled && (
              <StatusMessage>
                此数据空间已启用同步，但当前没有云端身份会话。重新登录后才能继续上传或下载。
              </StatusMessage>
            )}
            <div className="native-sync-section-title">
              <span>{mode === "signup" ? "创建云端身份" : "验证云端身份"}</span>
              <small>令牌只保存在本次应用内存，不写入本地数据或源码仓库。</small>
            </div>
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
            <label>
              <span>密码</span>
              <div className="native-sync-password">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={mode === "signup" ? "至少 12 位，含大小写字母和数字" : "输入云端身份密码"}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "隐藏云端身份密码" : "显示云端身份密码"}
                >
                  {showPassword ? <EyeSlash /> : <Eye />}
                </button>
              </div>
            </label>
            <button className="primary native-sync-submit" type="submit" disabled={busy}>
              {busy ? "正在验证…" : mode === "signup" ? "创建身份" : "登录身份"} {!busy && <ArrowRight />}
            </button>
            <button
              className="native-sync-mode-switch"
              type="button"
              disabled={busy}
              onClick={() => {
                setMode((current) => current === "signin" ? "signup" : "signin");
                setPassword("");
                setError("");
                setNotice("");
              }}
            >
              {mode === "signin" ? "第一次使用？创建云端身份" : "已有身份？返回登录"}
            </button>
          </form>
        )}

        {configured && authenticated && (
          <div className="native-sync-console">
            <div className="native-sync-identity">
              <ShieldCheck weight="fill" />
              <span><small>已验证云端身份</small><b>{authState.user.email || "已验证账户"}</b></span>
              <button type="button" onClick={signOut} disabled={busy}><SignOut />退出</button>
            </div>
            <div className="native-sync-status-grid">
              <div><small>同步状态</small><b>{syncStatus.enabled ? "已启用" : "未启用"}</b></div>
              <div><small>待上传</small><b>{Number(syncStatus.pendingCount ?? 0)} 项</b></div>
              <div><small>隔离冲突</small><b>{conflictCount} 项</b></div>
              <div><small>最近接收</small><b>{syncStatus.lastInboundReceivedAt ? new Date(syncStatus.lastInboundReceivedAt).toLocaleString("zh-CN") : "尚无"}</b></div>
            </div>
            {syncStatus.enabled && (
              <div className="native-sync-device-panel">
                <div className="native-sync-device-title">
                  <Devices weight="duotone" />
                  <span>
                    <b>已登记设备</b>
                    <small>设备列表只包含平台、时间和不透明 ID，不包含财务内容。</small>
                  </span>
                </div>
                {devicesLoading ? (
                  <p>正在读取设备状态…</p>
                ) : (
                  <div className="native-sync-device-list">
                    {(devices.length ? devices : [{
                      id: syncStatus.deviceId,
                      platform: syncStatus.platform ?? "macos",
                      createdAt: null,
                      lastSeenAt: null,
                      revokedAt: null,
                    }]).filter((device) => device.id).map((device) => (
                      <div key={device.id}>
                        <span>
                          <b>
                            {device.id === syncStatus.deviceId ? "此设备" : "其他设备"}
                            {" · "}
                            {device.platform === "macos"
                              ? "Mac"
                              : device.platform === "ios"
                                ? "iPhone / iPad"
                                : device.platform === "android"
                                  ? "Android"
                                  : device.platform}
                          </b>
                          <small>
                            {shortIdentifier(device.id)}
                            {device.lastSeenAt
                              ? ` · 最近活动 ${new Date(device.lastSeenAt).toLocaleString("zh-CN")}`
                              : device.createdAt
                                ? ` · 登记于 ${new Date(device.createdAt).toLocaleString("zh-CN")}`
                                : ""}
                          </small>
                        </span>
                        <i className={device.revokedAt ? "revoked" : ""}>
                          {device.revokedAt ? "已撤销" : "有效"}
                        </i>
                      </div>
                    ))}
                  </div>
                )}
                <small className="native-sync-device-note">
                  设备撤销属于高风险操作，必须增加近期重新认证和密钥轮换后才会开放。
                </small>
              </div>
            )}

            {!syncStatus.enabled ? (
              <div className="native-sync-confirm-panel">
                <label>
                  <input
                    type="checkbox"
                    checked={enableConfirmed}
                    onChange={(event) => setEnableConfirmed(event.target.checked)}
                  />
                  <span><b>我确认启用端到端加密同步</b><small>Folio 将为当前数据创建设备密钥，并开始上传密文事件；任何失败都会回滚为关闭状态。</small></span>
                </label>
                <button className="primary" type="button" onClick={enable} disabled={busy || !enableConfirmed}>
                  <CloudCheck />确认启用同步
                </button>
              </div>
            ) : (
              <>
                <div className="native-sync-actions">
                  <button className="primary" type="button" onClick={synchronize} disabled={busy}>
                    <ArrowsClockwise />{busy ? "正在同步…" : "立即同步一批"}
                  </button>
                  <small>每批最多 250 个密文事件；网络失败保留在本机重试队列，不会回退已确认账本。</small>
                </div>
                <div className="native-sync-confirm-panel danger">
                  <label>
                    <input
                      type="checkbox"
                      checked={disableConfirmed}
                      onChange={(event) => setDisableConfirmed(event.target.checked)}
                    />
                    <span><b>我确认停止此设备同步</b><small>只停止后续上传和下载，不删除本地数据，也不会声称删除云端既有密文副本。</small></span>
                  </label>
                  <button type="button" onClick={disable} disabled={busy || !disableConfirmed}>
                    <CloudSlash />确认停止同步
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <section className="native-sync-conflict-review" aria-labelledby="native-sync-conflicts-title">
          <div className="native-sync-conflict-heading">
            <div>
              <small>本机加密核对区</small>
              <h3 id="native-sync-conflicts-title">同步冲突</h3>
              <p>冲突不会自动覆盖账本。查看远端内容时，原生层会重新验证哈希与认证密文。</p>
            </div>
            <label>
              <input
                type="checkbox"
                checked={includeResolved}
                onChange={(event) => {
                  const next = event.target.checked;
                  setIncludeResolved(next);
                  setInspection(null);
                  void loadConflicts(next);
                }}
              />
              <span>显示已处理</span>
            </label>
          </div>

          {conflictsLoading ? (
            <div className="native-sync-conflict-empty">正在读取本机加密冲突区…</div>
          ) : conflicts.length === 0 ? (
            <div className="native-sync-conflict-empty safe">
              <ShieldCheck weight="fill" />
              <span><b>当前没有待核对冲突</b><small>重复事件会幂等忽略，语义分歧才进入这里。</small></span>
            </div>
          ) : (
            <div className="native-sync-conflict-list">
              {conflicts.map((conflict) => (
                <article key={`${conflict.direction}:${conflict.id}`}>
                  <WarningCircle weight="duotone" />
                  <span>
                    <small>
                      {conflict.direction === "incoming" ? "接收冲突" : "发送冲突"}
                      {" · "}
                      {EVENT_KIND_LABELS[conflict.eventKind] ?? conflict.eventKind}
                    </small>
                    <b>{CONFLICT_REASON_LABELS[conflict.reasonCode] ?? "需要人工核对"}</b>
                    <em>
                      {new Date(conflict.occurredAt).toLocaleString("zh-CN")}
                      {conflict.remoteDeviceId ? ` · 设备 ${shortIdentifier(conflict.remoteDeviceId)}` : ""}
                      {conflict.resolutionAction === "keep_local" ? " · 已保留本机" : ""}
                    </em>
                  </span>
                  {conflict.canInspect ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => inspectConflict(conflict.id)}
                    >
                      {conflict.resolutionAction ? "查看记录" : "查看并处理"}
                    </button>
                  ) : (
                    <i>等待远端核对</i>
                  )}
                </article>
              ))}
            </div>
          )}

          {inspection && (
            <div className="native-sync-conflict-inspection">
              <header>
                <div>
                  <small>已重新验签并在本机解密</small>
                  <h4>{EVENT_KIND_LABELS[inspection.conflict.eventKind] ?? "远端事件"}内容</h4>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setInspection(null);
                    setKeepLocalConfirmed(false);
                  }}
                  aria-label="关闭冲突详情"
                >
                  <X />
                </button>
              </header>
              <div className="native-sync-conflict-payload">
                {conflictPayloadRows(inspection.incomingPayload).map((row) => (
                  <div key={row.key}><span>{row.label}</span><b>{row.value}</b></div>
                ))}
              </div>
              {inspection.conflict.canKeepLocal ? (
                <div className="native-sync-conflict-decision">
                  <StatusMessage tone="error">
                    当前版本只开放“保留本机”。接受远端内容必须重新生成领域核对草稿，尚未开放，不能绕过确认链。
                  </StatusMessage>
                  <label>
                    <input
                      type="checkbox"
                      checked={keepLocalConfirmed}
                      onChange={(event) => setKeepLocalConfirmed(event.target.checked)}
                    />
                    <span>
                      <b>我已核对远端内容，确认保留本机版本</b>
                      <small>这会把该远端事件标记为用户拒绝，不删除密文、冲突证据或本机记录。</small>
                    </span>
                  </label>
                  <button
                    type="button"
                    disabled={busy || !keepLocalConfirmed}
                    onClick={keepLocalConflict}
                  >
                    <ShieldCheck />明确保留本机版本
                  </button>
                </div>
              ) : (
                <StatusMessage>
                  此冲突已处理，解决记录与原始密文事件保持不可变。
                </StatusMessage>
              )}
            </div>
          )}
        </section>

        {notice && <StatusMessage>{notice}</StatusMessage>}
        {error && <StatusMessage tone="error">{error}</StatusMessage>}
        <footer className="native-sync-footer">
          <ShieldCheck /><span>同步不是备份的替代品。请继续保留独立、离线的加密备份。</span>
          <button type="button" onClick={onClose}>{configured ? "完成" : "返回本地模式"} <Check /></button>
        </footer>
      </section>
    </div>
  );
}

export { EMPTY_STATUS as EMPTY_NATIVE_SYNC_STATUS };
