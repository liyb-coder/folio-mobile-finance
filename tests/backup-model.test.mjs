import assert from "node:assert/strict";
import test from "node:test";
import {
  formatBackupBytes,
  presentBackupError,
  validateBackupExportForm,
  validateBackupInspection,
  validateBackupRestoreForm,
} from "../src/security/backupModel.js";

test("backup export requires current authentication and an independent confirmed password", () => {
  assert.equal(validateBackupExportForm({
    currentPassword: "correct horse battery staple",
    backupPassword: "independent backup password",
    backupConfirmation: "independent backup password",
  }), "");
  assert.match(validateBackupExportForm({
    currentPassword: "short",
    backupPassword: "independent backup password",
    backupConfirmation: "independent backup password",
  }), /当前应用密码/);
  assert.match(validateBackupExportForm({
    currentPassword: "correct horse battery staple",
    backupPassword: "independent backup password",
    backupConfirmation: "different backup password",
  }), /不一致/);
});

test("backup restore refuses overwrite and validates a new local password", () => {
  const inspection = { restoreToken: "restore-1" };
  assert.equal(validateBackupInspection(
    { selectionToken: "selection-1" },
    "independent backup password",
  ), "");
  assert.equal(validateBackupRestoreForm({
    targetVaultId: "primary-restored",
    targetDisplayName: "恢复后的保险库",
    newPassword: "new restored vault password",
    newPasswordConfirmation: "new restored vault password",
  }, inspection, [{ vaultId: "primary" }]), "");
  assert.match(validateBackupRestoreForm({
    targetVaultId: "primary",
    targetDisplayName: "恢复后的保险库",
    newPassword: "new restored vault password",
    newPasswordConfirmation: "new restored vault password",
  }, inspection, [{ vaultId: "primary" }]), /不会覆盖/);
});

test("backup presentation keeps native failures concise and non-sensitive", () => {
  assert.equal(formatBackupBytes(1536), "1.5 KB");
  assert.equal(
    presentBackupError(new Error("Backup password is invalid or the file was modified.")),
    "备份密码不正确，或文件已经被修改。",
  );
});
