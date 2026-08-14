import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  createPlanningForm,
  PLANNING_ALLOCATIONS,
  toPlanningDraftInput,
} from "../src/data/local/planningDraft.js";
import { derivePlanningJourney } from "../src/data/local/planningJourney.js";

const appSource = readFileSync(
  resolve(import.meta.dirname, "../src/NativeVaultApp.jsx"),
  "utf8",
);
const stylesSource = readFileSync(
  resolve(import.meta.dirname, "../src/styles.css"),
  "utf8",
);
const planningStart = appSource.indexOf("function LocalPlanning(");
const planningEnd = appSource.indexOf("\nfunction LocalModule(", planningStart);
const planningSource = appSource.slice(planningStart, planningEnd);

test("planning journey presents the three money horizons in order", () => {
  const stages = ["安全底线", "未来 12 个月", "长期资金"];
  const positions = stages.map((label) => planningSource.indexOf(label));

  assert.ok(positions[0] >= 0, "规划页缺少第一阶段“安全底线”");
  assert.ok(positions[1] > positions[0], "规划页应在安全底线之后展示“未来 12 个月”");
  assert.ok(positions[2] > positions[1], "规划页应在未来用款之后展示“长期资金”");
});

test("future-12-month goals expose both add and edit entry points", () => {
  assert.ok(/>\s*添加目标\s*</u.test(planningSource), "未来 12 个月区域缺少“添加目标”入口");
  assert.ok(planningSource.includes("编辑目标"), "已有目标缺少明确的编辑入口或无障碍标签");
});

test("long-term simulation states that it neither trades nor recommends", () => {
  assert.ok(planningSource.includes("仅试算，不会交易"), "模拟器必须明确声明不会发起交易");
  assert.ok(/不是\s*Folio\s*推荐/u.test(planningSource), "目标区间必须明确说明由用户设置、不是 Folio 推荐");
});

test("planning journey exposes its data basis and a concrete next-step CTA", () => {
  assert.ok(planningSource.includes("查看数据口径"), "规划页缺少数据口径入口");
  assert.ok(planningSource.includes("补齐必要支出"), "下一步列表缺少安全底线任务");
  assert.ok(planningSource.includes("确认未来用款"), "下一步列表缺少未来用款任务");
  assert.ok(planningSource.includes("开始金额试算"), "下一步列表缺少长期资金试算任务");
  assert.ok(planningSource.includes("继续完成规划"), "规划页缺少主行动按钮“继续完成规划”");
});

test("planning stage rail reserves enough width so labels never sit under content cards", () => {
  assert.match(
    stylesSource,
    /\.planning-stage\s*\{[\s\S]*?grid-template-columns:\s*132px\s+minmax\(0,\s*1fr\);[\s\S]*?gap:\s*20px;/,
  );
  assert.match(
    stylesSource,
    /\.planning-stage-label\s*\{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?padding:\s*4px\s+0\s+10px\s+42px;/,
  );
  assert.match(
    stylesSource,
    /@media \(max-width:\s*1180px\)[\s\S]*?\.planning-stage\s*\{\s*grid-template-columns:\s*132px\s+minmax\(0,\s*1fr\);\s*gap:\s*18px;/,
  );
});

test("three-stage planning remains compatible with persisted allocation arrays", () => {
  const allocations = PLANNING_ALLOCATIONS.map((item, index) => ({
    category: item.category,
    targetBps: [1_500, 3_000, 2_500, 1_000, 1_500, 500][index],
  }));
  const form = createPlanningForm({
    name: "家庭长期资产规划",
    cashBufferMinor: 5_000_000,
    notes: "保留现有六类配置",
    allocations,
  });

  assert.deepEqual(toPlanningDraftInput(form).allocations, allocations);
  assert.ok(
    /planning\?\.allocations\s*\?\?\s*\[\]/u.test(planningSource),
    "新旅程必须继续读取现有 planning.allocations 数组",
  );
});

test("planning journey deducts the safety floor, confirmed one-off goals, and liabilities", () => {
  const journey = derivePlanningJourney({
    now: new Date("2026-08-14T12:00:00+08:00"),
    baseCurrency: "CNY",
    planning: {
      cashBufferMinor: 5_000_000,
      allocations: [
        { category: "cash", targetBps: 1_500 },
        { category: "stable", targetBps: 3_000 },
        { category: "equity", targetBps: 2_500 },
        { category: "gold", targetBps: 1_000 },
      ],
    },
    accounts: [
      { id: "cash", accountType: "cash", currency: "CNY" },
      { id: "property", accountType: "property", currency: "CNY" },
      { id: "debt", accountType: "liability", currency: "CNY" },
    ],
    balances: [
      { accountId: "cash", currency: "CNY", balanceMinor: 12_000_000 },
      { accountId: "property", currency: "CNY", balanceMinor: 80_000_000 },
      { accountId: "debt", currency: "CNY", balanceMinor: -1_000_000 },
    ],
    reminders: [
      { id: "annual", title: "年度保费", dueOn: "2026-10-01", amountMinor: 2_000_000, currency: "CNY", recurrenceRule: "yearly", status: "active" },
      { id: "rent", title: "月租", dueOn: "2026-09-01", amountMinor: 800_000, currency: "CNY", recurrenceRule: "monthly", status: "active" },
    ],
  });

  assert.equal(journey.liquidMinor, 12_000_000);
  assert.equal(journey.liabilityMinor, 1_000_000);
  assert.equal(journey.futureNeedMinor, 2_000_000);
  assert.equal(journey.goals.length, 1);
  assert.equal(journey.longTermAvailableMinor, 4_000_000);
});

test("planning journey excludes property, insurance, and unclassified holdings from the allocation denominator", () => {
  const journey = derivePlanningJourney({
    planning: {
      cashBufferMinor: 0,
      allocations: [{ category: "equity", targetBps: 4_000 }],
    },
    accounts: [{ id: "cash", accountType: "cash", currency: "CNY" }],
    balances: [{ accountId: "cash", currency: "CNY", balanceMinor: 1_000_000 }],
    holdings: [
      { id: "fund", productType: "fund", marketValueMinor: 2_000_000, currency: "CNY" },
      { id: "insurance", productType: "insurance", marketValueMinor: 9_000_000, currency: "CNY" },
      { id: "other", productType: "other", name: "自住房", marketValueMinor: 30_000_000, currency: "CNY" },
    ],
  });

  assert.equal(journey.allocationTotalMinor, 3_000_000);
  assert.equal(journey.allocationRows.find((row) => row.category === "equity").amountMinor, 2_000_000);
});
