import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve(import.meta.dirname, "../src/NativeVaultApp.jsx"), "utf8");

test("film planning preview uses the same allocation contract as native planning", () => {
  const fixture = source.match(/planning:\s*\{[\s\S]*?notes:\s*"虚构演示规划，不构成投资建议。"/u)?.[0] ?? "";

  assert.match(fixture, /allocations:\s*\[/u);
  assert.match(fixture, /category:\s*"cash",\s*targetBps:\s*1_500/u);
  assert.match(fixture, /category:\s*"equity",\s*targetBps:\s*2_500/u);
});
