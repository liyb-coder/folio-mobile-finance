import { validateVaultPassword } from "./nativeVaultModel.js";

const VAULT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function validateBackupExportForm(form) {
  const currentIssue = validateVaultPassword(form?.currentPassword ?? "");
  if (currentIssue) return `当前应用${currentIssue}`;
  const backupIssue = validateVaultPassword(
    form?.backupPassword ?? "",
    form?.backupConfirmation ?? "",
  );
  if (backupIssue) return `备份${backupIssue}`;
  return "";
}

export function validateBackupInspection(selection, backupPassword) {
  if (!selection?.selectionToken) return "请先选择一个 Folio 加密备份文件。";
  const passwordIssue = validateVaultPassword(backupPassword ?? "");
  return passwordIssue ? `备份${passwordIssue}` : "";
}

export function validateBackupRestoreForm(form, inspection, knownVaults = []) {
  if (!inspection?.restoreToken) return "请先完成备份完整性检查。";
  const vaultId = String(form?.targetVaultId ?? "").trim();
  if (!VAULT_ID_PATTERN.test(vaultId)) {
    return "新数据标识只能包含字母、数字、连字符或下划线，最多 64 个字符。";
  }
  if (knownVaults.some((vault) => vault.vaultId === vaultId)) {
    return "此数据标识已经存在；恢复不会覆盖现有数据。";
  }
  const displayName = String(form?.targetDisplayName ?? "").trim();
  if (!displayName || [...displayName].length > 80) {
    return "新数据名称需要 1 至 80 个字符。";
  }
  const passwordIssue = validateVaultPassword(
    form?.newPassword ?? "",
    form?.newPasswordConfirmation ?? "",
  );
  if (passwordIssue) return `新应用${passwordIssue}`;
  return "";
}

export function formatBackupBytes(value) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function presentBackupError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const known = [
    ["Backup password is invalid", "备份密码不正确，或文件已经被修改。"],
    ["file was modified", "备份密码不正确，或文件已经被修改。"],
    ["Vault password is invalid", "当前应用密码不正确，未导出任何数据。"],
    ["not a supported Folio", "所选文件不是受支持的 Folio 加密备份。"],
    ["container is malformed", "备份容器格式损坏，无法读取。"],
    ["manifest does not match", "备份清单与加密数据库不一致，恢复已停止。"],
    ["invalid relationships", "备份中的数据关系校验失败，恢复已停止。"],
    ["changed after", "备份文件在核对后发生变化，请重新选择。"],
    ["identifier already exists", "目标数据已经存在；Folio 不会覆盖现有数据。"],
    ["selection has expired", "备份选择已经失效，请重新选择文件。"],
    ["must be inspected", "请先完成备份密码与完整性检查。"],
    ["Vault is locked", "应用已经锁定，请重新解锁后导出。"],
  ];
  return known.find(([needle]) => message.includes(needle))?.[1]
    ?? (message.length <= 180 ? message : "备份操作失败，现有数据没有被修改。");
}
