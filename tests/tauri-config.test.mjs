import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const config = JSON.parse(
  readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"),
);
const cargo = readFileSync(resolve(root, "src-tauri/Cargo.toml"), "utf8");
const rust = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const macosDmgScript = readFileSync(
  resolve(root, "scripts/package-macos-dmg.sh"),
  "utf8",
);
const macosDmgVerifyScript = readFileSync(
  resolve(root, "scripts/verify-macos-dmg.sh"),
  "utf8",
);

test("Tauri bundle has a production identifier and branded desktop window", () => {
  assert.equal(config.productName, "Folio");
  assert.equal(config.identifier, "com.beizi.folio");
  assert.notEqual(config.identifier, "com.tauri.dev");
  assert.ok(config.app.windows[0].minWidth >= 1000);
  assert.ok(config.app.windows[0].minHeight >= 700);
  assert.match(config.app.windows[0].title, /Folio/);
});

test("Tauri webview uses explicit production and development CSP policies", () => {
  assert.equal(typeof config.app.security.csp, "string");
  assert.equal(typeof config.app.security.devCsp, "string");
  assert.match(config.app.security.csp, /default-src 'self'/);
  assert.match(config.app.security.csp, /connect-src[^;]*https:\/\/\*\.supabase\.co/);
  assert.match(config.app.security.csp, /connect-src[^;]*wss:\/\/\*\.supabase\.co/);
  assert.doesNotMatch(config.app.security.csp, /connect-src[^;]*\shttps?:\s/);
  assert.doesNotMatch(config.app.security.csp, /default-src \*/);
  assert.doesNotMatch(config.app.security.csp, /script-src[^;]*'unsafe-eval'/);
});

test("native command surface is explicit and does not enable shell access", () => {
  const expectedCommands = [
    "accounts::account_archive_draft",
    "accounts::account_create_draft",
    "accounts::account_confirm_draft",
    "accounts::account_reject_draft",
    "accounts::account_update_draft",
    "ai::ai_proposal_list",
    "ai::ai_proposal_record",
    "model_gateway::model_extract_financial_facts",
    "model_gateway::model_provider_configure",
    "model_gateway::model_provider_remove",
    "model_gateway::model_provider_status",
    "model_gateway::model_provider_test",
    "backups::vault_backup_confirm_restore",
    "backups::vault_backup_create",
    "backups::vault_backup_discard",
    "backups::vault_backup_inspect",
    "backups::vault_backup_select",
    "holdings::holding_confirm_draft",
    "holdings::holding_create_draft",
    "holdings::holding_archive_draft",
    "holdings::holding_reject_draft",
    "holdings::holding_update_draft",
    "holdings::holding_valuation_create_draft",
    "holding_operations::holding_operation_confirm_draft",
    "holding_operations::holding_operation_correction_confirm_draft",
    "holding_operations::holding_operation_correction_create_draft",
    "holding_operations::holding_operation_correction_reject_draft",
    "holding_operations::holding_operation_create_draft",
    "holding_operations::holding_operation_reject_draft",
    "imports::transaction_import_confirm_draft",
    "imports::transaction_import_create_draft",
    "imports::transaction_import_inspect",
    "imports::transaction_import_reject_draft",
    "notifications::notification_disable",
    "notifications::notification_enable",
    "notifications::notification_reconcile",
    "notifications::notification_status",
    "reminders::reminder_archive_draft",
    "reminders::reminder_complete_draft",
    "reminders::reminder_confirm_draft",
    "reminders::reminder_create_draft",
    "reminders::reminder_reject_draft",
    "reminders::reminder_update_draft",
    "speech::speech_stop_current",
    "speech::speech_transcribe_once",
    "sync::sync_conflict_inspect",
    "sync::sync_conflict_keep_local",
    "sync::sync_conflicts_list",
    "transactions::transaction_correction_confirm_draft",
    "transactions::transaction_correction_create_draft",
    "transactions::transaction_correction_reject_draft",
    "transactions::transaction_confirm_draft",
    "transactions::transaction_create_draft",
    "transactions::transaction_reject_draft",
    "vault::vault_create",
    "vault::vault_list",
    "vault::vault_biometric_status",
    "vault::vault_change_password",
    "vault::vault_disable_biometric",
    "vault::vault_enable_biometric",
    "vault::vault_status",
    "vault::vault_unlock",
    "vault::vault_lock",
    "vault::vault_get_snapshot",
  ];
  for (const command of expectedCommands) {
    assert.match(rust, new RegExp(command.replaceAll("::", "\\:\\:")));
  }
  assert.doesNotMatch(cargo, /tauri-plugin-shell/);
  assert.doesNotMatch(rust, /tauri_plugin_shell|shell::/);
});

test("package scripts expose repeatable Tauri build and Rust test commands", () => {
  assert.equal(packageJson.scripts["tauri:dev"], "tauri dev");
  assert.equal(packageJson.scripts["tauri:build"], "tauri build");
  assert.match(packageJson.scripts["macos:package:dmg"], /package-macos-dmg/);
  assert.match(packageJson.scripts["test:rust"], /src-tauri\/Cargo\.toml/);
  assert.ok(packageJson.dependencies["@tauri-apps/api"]);
  assert.ok(packageJson.devDependencies["@tauri-apps/cli"]);
  assert.equal(packageJson.scripts["tauri:ios:init"], "tauri ios init");
  assert.equal(packageJson.scripts["tauri:ios:dev"], "tauri ios dev");
  assert.equal(packageJson.scripts["tauri:ios:build"], "tauri ios build");
  assert.equal(packageJson.scripts["tauri:android:init"], "tauri android init");
  assert.match(packageJson.scripts["mobile:doctor"], /check-mobile-readiness/);
  assert.match(macosDmgScript, /tauri:build -- --bundles app/);
  assert.match(macosDmgScript, /codesign --verify --deep --strict/);
  assert.match(macosDmgScript, /verify-macos-dmg\.sh/);
  assert.match(macosDmgVerifyScript, /hdiutil verify/);
});
