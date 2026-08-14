import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { createTauriVaultAdapter } from "../src/security/tauriVaultAdapter.js";

const root = resolve(import.meta.dirname, "..");

test("clear-all data crosses one authenticated native boundary", async () => {
  const calls = [];
  const adapter = createTauriVaultAdapter(async (command, payload) => {
    calls.push([command, payload]);
    return { status: "cleared", vaultId: "primary" };
  });

  const result = await adapter.clearAllData({
    vaultId: "primary",
    currentPassword: "correct horse battery staple",
  });

  assert.equal(result.status, "cleared");
  assert.deepEqual(calls, [[
    "vault_clear_all_data",
    {
      request: {
        vaultId: "primary",
        currentPassword: "correct horse battery staple",
        confirmedByUser: true,
      },
    },
  ]]);
});

test("settings separates incremental import, full re-entry, export, and destructive clear", () => {
  const source = readFileSync(resolve(root, "src/NativeVaultApp.jsx"), "utf8");
  assert.match(source, /新增资料、全量重录与导出/);
  assert.match(source, /<b>新增或导入资料<\/b>/);
  assert.match(source, /<b>重新录入全量数据<\/b>/);
  assert.match(source, /用这份快照重新开始/);
  assert.match(source, /只新增最近变化/);
  assert.match(source, /<b>导出 Markdown<\/b>/);
  assert.match(source, /<b>清空 Folio 数据<\/b>/);
  assert.match(source, /再次输入当前应用密码/);
  assert.match(source, /我确认永久清除当前 Folio 全部数据/);
  assert.match(source, /onClearAllData/);
});

test("runtime pet assets stay within the lightweight animation budget", () => {
  const styles = readFileSync(resolve(root, "src/styles.css"), "utf8");
  const vite = readFileSync(resolve(root, "vite.config.mjs"), "utf8");
  assert.match(styles, /folio-cat-idle-transparent\.png/);
  assert.match(styles, /folio-cat-welcome-transparent\.webp/);
  assert.match(styles, /folio-cat-rest-grooming-static-transparent\.png/);
  assert.match(styles, /\.folio-desk-pet\.state-rest \.folio-pet-frame\s*\{[\s\S]*animation:\s*none/);
  assert.doesNotMatch(vite, /transparent\.gif/);
  assert.match(styles, /translate3d/);
  assert.match(styles, /prefers-reduced-motion/);
});
