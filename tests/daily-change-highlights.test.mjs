import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  dailyChangeLabel,
  deriveDailyChangeHighlights,
} from "../src/data/local/dailyChangeHighlights.js";

test("marks records by persisted confirmation time instead of financial occurrence time", () => {
  const highlights = deriveDailyChangeHighlights({
    accounts: [
      { id: "new-account", createdAt: "2026-08-09T00:00:00.000Z", confirmedAt: "2026-08-10T01:00:00.000Z" },
      { id: "existing-account", createdAt: "2026-07-01T01:00:00.000Z" },
    ],
    transactions: [{
      id: "late-entry",
      accountId: "existing-account",
      occurredAt: "2026-03-01T00:00:00.000Z",
      createdAt: "2026-08-10T02:00:00.000Z",
    }],
  }, new Date("2026-08-10T12:00:00+08:00"));

  assert.equal(highlights.accounts["new-account"], "new");
  assert.equal(highlights.accounts["existing-account"], "updated");
  assert.equal(highlights.transactions["late-entry"], "new");
});

test("keeps a new record new when a same-day operation also updates it", () => {
  const highlights = deriveDailyChangeHighlights({
    holdings: [{ id: "holding-1", createdAt: "2026-08-10T01:00:00.000Z" }],
    holdingOperations: [{
      holdingId: "holding-1",
      holdingAccountId: "account-1",
      createdAt: "2026-08-10T03:00:00.000Z",
    }],
    reminders: [
      {
        id: "reminder-new",
        createdAt: "2026-08-10T04:00:00.000Z",
        updatedAt: "2026-08-10T04:00:00.000Z",
      },
      {
        id: "reminder-updated",
        createdAt: "2026-07-01T04:00:00.000Z",
        updatedAt: "2026-08-10T05:00:00.000Z",
      },
    ],
  }, new Date("2026-08-10T18:00:00+08:00"));

  assert.equal(highlights.holdings["holding-1"], "new");
  assert.equal(highlights.accounts["account-1"], "updated");
  assert.equal(highlights.reminders["reminder-new"], "new");
  assert.equal(highlights.reminders["reminder-updated"], "updated");
});

test("keeps a change visible at 23h59m and hides it at the rolling 24-hour boundary", () => {
  const source = {
    transactions: [{
      id: "recent",
      accountId: "account-1",
      createdAt: "2026-08-10T03:00:00.000Z",
    }],
  };

  const visible = deriveDailyChangeHighlights(
    source,
    new Date("2026-08-11T02:59:00.000Z"),
  );
  assert.equal(visible.transactions.recent, "new");
  assert.equal(visible.accounts["account-1"], "updated");
  assert.equal(visible.nextExpiryAt, "2026-08-11T03:00:00.000Z");

  const expired = deriveDailyChangeHighlights(
    source,
    new Date("2026-08-11T03:00:00.000Z"),
  );
  assert.deepEqual(expired.transactions, {});
  assert.deepEqual(expired.accounts, {});
});

test("distinguishes newly created records from recently updated records", () => {
  const highlights = deriveDailyChangeHighlights({
    accounts: [
      { id: "created", createdAt: "2026-08-10T04:00:00.000Z", updatedAt: "2026-08-10T05:00:00.000Z" },
      { id: "updated", createdAt: "2026-07-01T04:00:00.000Z", updatedAt: "2026-08-10T05:00:00.000Z" },
    ],
  }, new Date("2026-08-11T03:00:00.000Z"));

  assert.equal(highlights.accounts.created, "new");
  assert.equal(highlights.accounts.updated, "updated");
  assert.equal(dailyChangeLabel("new"), "NEW · 新增");
  assert.equal(dailyChangeLabel("updated"), "NEW · 更新");

  const afterCreationWindow = deriveDailyChangeHighlights({
    accounts: [{
      id: "created-then-updated",
      createdAt: "2026-08-10T04:00:00.000Z",
      updatedAt: "2026-08-10T05:00:00.000Z",
    }],
  }, new Date("2026-08-11T04:30:00.000Z"));
  assert.equal(afterCreationWindow.accounts["created-then-updated"], "updated");
});

test("ignores invalid, future, and non-persisted timestamps", () => {
  const highlights = deriveDailyChangeHighlights({
    accounts: [
      { id: "invalid", createdAt: "not-a-time", updatedAt: "still-not-a-time" },
      { id: "future", createdAt: "2026-08-12T03:00:00.000Z" },
      { id: "occurrence-only", occurredAt: "2026-08-11T02:59:00.000Z" },
    ],
    reminders: [{ id: "missing", createdAt: null, updatedAt: undefined }],
  }, new Date("2026-08-11T03:00:00.000Z"));

  assert.deepEqual(highlights.accounts, {});
  assert.deepEqual(highlights.reminders, {});
});

test("workspace evaluates newly confirmed records against the current clock immediately", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "../src/NativeVaultApp.jsx"),
    "utf8",
  );
  const derivation = source.match(/const dailyChanges = useMemo\([\s\S]*?\n\s*\]\);/u)?.[0] ?? "";

  assert.match(
    derivation,
    /deriveDailyChangeHighlights\([\s\S]*?\}, new Date\(\)\)/u,
    "刚确认的数据必须使用当前时钟计算 NEW，而不是沿用页面打开时的旧时钟",
  );
});
