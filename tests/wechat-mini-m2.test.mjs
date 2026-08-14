import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = path.resolve("apps/wechat-mini/miniprogram");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function loadReviewClient(requestImpl) {
  const source = read("services/review-proposals.js");
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    Promise,
    URL,
    structuredClone,
    wx: { request: requestImpl },
  });
  new vm.Script(`(function (module, exports) { ${source}\n})(module, exports);`).runInContext(context);
  return module.exports;
}

function validProposal() {
  return {
    proposalId: "proposal-m2-1",
    state: "pending_review",
    sourceKind: "text",
    sourceId: "text-m2-1",
    summary: "识别到一笔收入和一个提醒",
    items: [
      {
        itemId: "item-income-1",
        kind: "transaction",
        title: "建行租金收入 8,000 元",
        evidence: [{ sourceId: "text-m2-1", quote: "建行新增租金收入8000" }],
      },
      {
        itemId: "item-reminder-1",
        kind: "reminder",
        title: "8月20日交保费 10,000 元",
        evidence: [{ sourceId: "text-m2-1", quote: "8月20日提醒我交保费10000" }],
      },
    ],
  };
}

test("M2 capture page provides a real text-to-review state instead of a placeholder toast", () => {
  const logic = read("pages/capture/index.js");
  const template = read("pages/capture/index.wxml");
  assert.match(logic, /createReviewProposal/);
  assert.match(logic, /submitText/);
  assert.match(logic, /status:\s*"idle"/);
  assert.match(template, /textarea/);
  assert.match(template, /整理为待核对项/);
  assert.match(template, /wx:for="{{proposal\.items}}"/);
  assert.match(template, /等待逐项确认/);
  assert.doesNotMatch(template, /可编辑文本与逐项核对流程将在下一里程碑接入/);
});

test("mini-program review client sends only captured text to a BFF and accepts pending review", async () => {
  let captured;
  const { createReviewProposal } = loadReviewClient((options) => {
    captured = options;
    options.success({ statusCode: 200, data: { proposal: validProposal() } });
  });
  const proposal = await createReviewProposal({
    baseUrl: "http://127.0.0.1:8787",
    sourceId: "text-m2-1",
    sourceKind: "text",
    text: "建行新增租金收入8000，8月20日提醒我交保费10000",
  });
  assert.equal(captured.url, "http://127.0.0.1:8787/v1/review-proposals");
  assert.equal(captured.method, "POST");
  assert.deepEqual(
    Object.keys(captured.data).sort(),
    ["sourceId", "sourceKind", "text"],
  );
  assert.equal(proposal.state, "pending_review");
  assert.equal(proposal.items.length, 2);
});

test("mini-program review client rejects forged writes, missing evidence and insecure remote BFFs", async () => {
  const hostileCases = [
    { ...validProposal(), state: "confirmed", ledgerEventId: "forged" },
    {
      ...validProposal(),
      items: [{ ...validProposal().items[0], evidence: [] }],
    },
    {
      ...validProposal(),
      items: [{
        ...validProposal().items[0],
        evidence: [{ sourceId: "text-m2-1", quote: "原文里不存在的9000元" }],
      }],
    },
  ];
  for (const hostile of hostileCases) {
    const { createReviewProposal } = loadReviewClient((options) => {
      options.success({ statusCode: 200, data: { proposal: hostile } });
    });
    await assert.rejects(() => createReviewProposal({
      baseUrl: "http://127.0.0.1:8787",
      sourceId: "text-m2-1",
      sourceKind: "text",
      text: "建行新增租金收入8000，8月20日提醒我交保费10000",
    }));
  }

  const { createReviewProposal } = loadReviewClient(() => {
    throw new Error("network must not be reached");
  });
  await assert.rejects(() => createReviewProposal({
    baseUrl: "http://folio.example",
    sourceId: "text-m2-1",
    sourceKind: "text",
    text: "测试收入100",
  }), /HTTPS/);
});

test("M2 runtime configuration is secret-free and empty until a developer configures the BFF", () => {
  const config = read("config/runtime.js");
  assert.match(config, /bffBaseUrl:\s*""/);
  assert.doesNotMatch(config, /api.?key|app.?secret|access.?token|deepseek/i);
  assert.doesNotMatch(config, /sk-[a-z0-9]/i);
});
