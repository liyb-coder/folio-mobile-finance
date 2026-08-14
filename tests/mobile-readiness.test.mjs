import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("mobile readiness doctor exposes every official Rust target as structured evidence", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/check-mobile-readiness.mjs", "--json"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.requiredRustTargets, [
    "aarch64-apple-ios",
    "aarch64-apple-ios-sim",
    "x86_64-apple-ios",
    "aarch64-linux-android",
    "armv7-linux-androideabi",
    "i686-linux-android",
    "x86_64-linux-android",
  ]);
  assert.equal(typeof report.ready, "boolean");
  assert.ok(report.checks.some((item) => item.label === "iPhoneSimulator SDK"));
  assert.ok(report.checks.some((item) => item.label === "Android SDK 组件"));
  assert.ok(report.checks.some((item) => item.label === "Rust 移动 targets"));
});
