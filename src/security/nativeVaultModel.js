export const DEFAULT_VAULT_ID = "primary";
export const DEFAULT_VAULT_NAME = "被子beizi 的 Folio 数据";
export const DEFAULT_BASE_CURRENCY = "CNY";

export function validateVaultPassword(password, confirmation = password) {
  if (typeof password !== "string" || password.length < 12) {
    return "密码至少需要 12 个字符";
  }
  if (password.length > 1024) {
    return "密码长度超出安全限制";
  }
  if (password !== confirmation) {
    return "两次输入的密码不一致";
  }
  return "";
}

export function validatePasswordChange(currentPassword, newPassword, confirmation) {
  if (typeof currentPassword !== "string" || currentPassword.length < 12) {
    return "请输入当前应用密码";
  }
  const passwordIssue = validateVaultPassword(newPassword, confirmation);
  if (passwordIssue) return passwordIssue;
  if (currentPassword === newPassword) {
    return "新密码不能与当前密码相同";
  }
  return "";
}

export function pickInitialVault(vaults) {
  if (!Array.isArray(vaults) || vaults.length === 0) return null;
  return vaults.find((vault) => vault.vaultId === DEFAULT_VAULT_ID) ?? vaults[0];
}

export function presentVaultError(error) {
  const message = typeof error === "string" ? error : error?.message;
  if (!message) return "操作失败，请稍后重试";
  if (/Too many failed attempts|rate limited/i.test(message)) {
    return "尝试次数过多，请稍后再试";
  }
  if (/password or encrypted data|password is invalid/i.test(message)) {
    return "密码不正确，本地数据仍保持锁定";
  }
  if (/cancelled/i.test(message)) {
    return "已取消 Touch ID 验证";
  }
  if (/Touch ID is unavailable|no enrolled fingerprint/i.test(message)) {
    return "此设备尚未设置可用的 Touch ID";
  }
  return message;
}

export function presentBiometricSettingsError(error) {
  const message = typeof error === "string" ? error : error?.message;
  if (!message) return "Touch ID 设置失败，原安全设置未改变";
  if (/password or encrypted data|password is invalid/i.test(message)) {
    return "应用密码不正确，Touch ID 设置未改变";
  }
  if (/must be unlocked/i.test(message)) {
    return "应用已锁定，请重新解锁后再修改 Touch ID";
  }
  if (/cancelled/i.test(message)) {
    return "已取消 Touch ID 设置，原安全设置未改变";
  }
  if (/Touch ID is unavailable|no enrolled fingerprint/i.test(message)) {
    return "此设备尚未设置可用的 Touch ID";
  }
  return "Touch ID 设置失败，原安全设置未改变";
}

export function presentPasswordChangeError(error) {
  const message = typeof error === "string" ? error : error?.message;
  if (!message) return "应用密码修改失败，原密码仍然有效";
  if (/Too many failed attempts|rate limited/i.test(message)) {
    return "验证失败次数过多，请稍后再试；原密码仍然有效";
  }
  if (/password or encrypted data|password is invalid/i.test(message)) {
    return "当前应用密码不正确，密码没有改变";
  }
  if (/must be unlocked/i.test(message)) {
    return "应用已锁定，请重新解锁后再修改密码";
  }
  if (/must be different/i.test(message)) {
    return "新密码不能与当前密码相同";
  }
  if (/safely roll back|password state is uncertain/i.test(message)) {
    return "密码状态无法确认。请保持应用解锁并立即导出数据，锁定前不要再次修改。";
  }
  return "应用密码修改失败，原密码仍然有效";
}
