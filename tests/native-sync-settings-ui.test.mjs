import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const modal = readFileSync(
  resolve(root, "src/sync/NativeSyncSettingsModal.jsx"),
  "utf8",
);
const app = readFileSync(resolve(root, "src/NativeVaultApp.jsx"), "utf8");
const main = readFileSync(resolve(root, "src/main.jsx"), "utf8");

test("native settings expose the complete optional encrypted-sync flow", () => {
  assert.match(modal, /验证云端身份/);
  assert.match(modal, /我确认启用端到端加密同步/);
  assert.match(modal, /确认启用同步/);
  assert.match(modal, /立即同步一批/);
  assert.match(modal, /隔离冲突/);
  assert.match(modal, /我确认停止此设备同步/);
  assert.match(modal, /确认停止同步/);
  assert.match(modal, /云端既有密文副本未被删除/);
  assert.match(app, /NativeSyncSettingsModal/);
  assert.match(main, /<NativeVaultApp config=\{runtimeConfig\}/);
});

test("native cloud identity password stays masked and is never rendered as a key setting", () => {
  assert.match(modal, /type=\{showPassword \? "text" : "password"\}/);
  assert.match(modal, /autoComplete=\{mode === "signup" \? "new-password" : "current-password"\}/);
  assert.match(modal, /令牌只保存在本次应用内存/);
  assert.doesNotMatch(modal, /access_token|refresh_token/);
  assert.doesNotMatch(modal, /同步密钥.{0,20}(输入|粘贴|显示)/);
});

test("first-phase settings keep sync out of the primary settings surface", () => {
  assert.match(app, /syncStatus\.enabled \? "端到端密文同步" : "仅保存在此 Mac"/);
  assert.doesNotMatch(app, /setDialog\("sync"\)/);
  assert.match(app, /新增资料、全量重录与导出/);
});

test("native conflict review re-verifies remote content and only exposes explicit keep-local", () => {
  assert.match(modal, /本机加密核对区/);
  assert.match(modal, /重新验证哈希与认证密文/);
  assert.match(modal, /我已核对远端内容，确认保留本机版本/);
  assert.match(modal, /明确保留本机版本/);
  assert.match(modal, /接受远端内容必须重新生成领域核对草稿，尚未开放/);
  assert.match(modal, /不删除密文、冲突证据或本机记录/);
  assert.doesNotMatch(modal, /自动接受远端|覆盖本机版本/);
  assert.match(app, /onKeepLocalSyncConflict=\{keepLocalSyncConflict\}/);
});

test("native sync settings show minimal device status without unsafe revoke affordances", () => {
  assert.match(modal, /已登记设备/);
  assert.match(modal, /平台、时间和不透明 ID，不包含财务内容/);
  assert.match(modal, /设备撤销属于高风险操作，必须增加近期重新认证和密钥轮换后才会开放/);
  assert.doesNotMatch(modal, /立即撤销设备|一键撤销/);
});
