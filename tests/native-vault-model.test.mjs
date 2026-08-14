import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_VAULT_ID,
  pickInitialVault,
  presentBiometricSettingsError,
  presentPasswordChangeError,
  presentVaultError,
  validatePasswordChange,
  validateVaultPassword,
} from "../src/security/nativeVaultModel.js";

test("vault password validation enforces length and exact confirmation", () => {
  assert.match(validateVaultPassword("short"), /12/);
  assert.match(
    validateVaultPassword("correct horse battery staple", "different value entirely"),
    /不一致/,
  );
  assert.equal(
    validateVaultPassword(
      "correct horse battery staple",
      "correct horse battery staple",
    ),
    "",
  );
});

test("password change requires current authentication, a new value, and confirmation", () => {
  assert.match(
    validatePasswordChange("short", "new private password", "new private password"),
    /当前/,
  );
  assert.match(
    validatePasswordChange(
      "correct horse battery staple",
      "different private password",
      "mismatched private password",
    ),
    /不一致/,
  );
  assert.match(
    validatePasswordChange(
      "correct horse battery staple",
      "correct horse battery staple",
      "correct horse battery staple",
    ),
    /不能与当前密码相同/,
  );
  assert.equal(
    validatePasswordChange(
      "correct horse battery staple",
      "different private password",
      "different private password",
    ),
    "",
  );
  assert.equal(
    presentPasswordChangeError("Vault password is invalid."),
    "当前应用密码不正确，密码没有改变",
  );
});

test("biometric settings errors preserve state and do not imply the open vault was locked", () => {
  assert.equal(
    presentBiometricSettingsError("Vault password is invalid."),
    "应用密码不正确，Touch ID 设置未改变",
  );
  assert.equal(
    presentBiometricSettingsError(
      "The selected vault must be unlocked before changing Touch ID.",
    ),
    "应用已锁定，请重新解锁后再修改 Touch ID",
  );
  assert.equal(
    presentBiometricSettingsError(new Error("unexpected keychain internals")),
    "Touch ID 设置失败，原安全设置未改变",
  );
});

test("initial vault selection prefers the stable primary identifier", () => {
  const selected = pickInitialVault([
    { vaultId: "family", displayName: "家庭" },
    { vaultId: DEFAULT_VAULT_ID, displayName: "个人" },
  ]);
  assert.equal(selected.vaultId, DEFAULT_VAULT_ID);
  assert.equal(pickInitialVault([]), null);
});

test("native errors are presented without leaking implementation details", () => {
  assert.equal(
    presentVaultError(new Error("Vault password or encrypted data is invalid.")),
    "密码不正确，本地数据仍保持锁定",
  );
  assert.equal(
    presentVaultError("Touch ID authentication was cancelled or failed."),
    "已取消 Touch ID 验证",
  );
  assert.equal(
    presentVaultError("Too many failed attempts. Try again later."),
    "尝试次数过多，请稍后再试",
  );
});
