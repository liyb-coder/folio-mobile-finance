import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const source = readFileSync(resolve(root, "src/NativeVaultApp.jsx"), "utf8");

test("security settings exposes reauthenticated Apple biometric enable and removal flows", () => {
  assert.match(source, /function BiometricSettingsModal/);
  assert.match(source, /label="当前应用密码"/);
  assert.match(source, /确认启用 \$\{APPLE_BIOMETRIC_LABEL\}/);
  assert.match(source, /确认关闭 \$\{APPLE_BIOMETRIC_LABEL\}/);
  assert.match(source, /onEnableBiometric=\{enableBiometric\}/);
  assert.match(source, /onDisableBiometric=\{disableBiometric\}/);
});

test("Apple biometric settings explain system ownership and password fallback", () => {
  assert.match(source, /Folio 不会收到面容或指纹模板/);
  assert.match(source, /比对完全由 \$\{APPLE_BIOMETRIC_SYSTEM\} 处理/);
  assert.match(source, /应用密码仍可正常解锁/);
  assert.doesNotMatch(source, /保存.{0,8}(?:面容|指纹)模板/);
});

test("security settings exposes an explicit reauthenticated password rotation flow", () => {
  assert.match(source, /function PasswordChangeModal/);
  assert.match(source, /label="当前应用密码"/);
  assert.match(source, /label="新应用密码"/);
  assert.match(source, /label="再次输入新密码"/);
  assert.match(source, /我已妥善记录新密码/);
  assert.match(source, /确认修改应用密码/);
  assert.match(source, /onChangePassword=\{changePassword\}/);
  assert.match(source, /Touch ID 不需要重新登记/);
});
