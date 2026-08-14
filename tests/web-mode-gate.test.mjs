import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const main = readFileSync(resolve(root, "src/main.jsx"), "utf8");
const gates = readFileSync(resolve(root, "src/auth/WebModeGate.jsx"), "utf8");
const demo = readFileSync(resolve(root, "src/App.jsx"), "utf8");

test("browser local mode fails closed instead of falling through to demo", () => {
  assert.match(main, /LockedWebGate localMode=\{runtimeConfig\.dataMode === "local"\}/);
  assert.match(gates, /本机数据不能由普通网页打开/);
  assert.match(gates, /当前页面未加载账户、流水、事项或 AI 证据/);
});

test("public demo is explicitly acknowledged and permanently marked fictional", () => {
  assert.match(main, /<PublicDemoGate>/);
  assert.match(gates, /我明白，进入虚构演示/);
  assert.match(gates, /此按钮不是登录/);
  assert.match(demo, /className="public-demo-banner"/);
  assert.match(demo, /不含、不保存也不应输入真实财务数据/);
});
