import assert from "node:assert/strict";
import test from "node:test";
import { attachDocumentEvidence } from "../src/ai/documentEvidence.js";

test("local document evidence maps proposal ranges to pages without retaining the original file", () => {
  const proposal = {
    inputKind: "text",
    evidence: [
      { field: "account", text: "招商银行", range: [4, 8] },
      { field: "amount", text: "八千六百元", range: [16, 21] },
    ],
    warnings: [],
  };
  const document = {
    status: "extracted",
    fileName: "虚构账户截图.png",
    fileHash: "a".repeat(64),
    format: "image",
    byteCount: 2048,
    pageCount: 1,
    ocrPageCount: 1,
    unreadablePageCount: 0,
    truncated: false,
    evidence: [{
      page: 1,
      rangeStart: 0,
      rangeEnd: 24,
      confidenceBps: 9700,
      boundingBox: { x: 0.1, y: 0.6, width: 0.8, height: 0.2 },
    }],
  };

  const attached = attachDocumentEvidence(proposal, document);

  assert.equal(attached.inputKind, "file");
  assert.deepEqual(attached.evidence[0], {
    source: "local_document",
    fileName: "虚构账户截图.png",
    fileHash: "a".repeat(64),
    format: "image",
    byteCount: 2048,
    pageCount: 1,
    ocrPageCount: 1,
    unreadablePageCount: 0,
    truncated: false,
    originalStored: false,
    privacy: "device_only_ephemeral",
  });
  assert.deepEqual(attached.evidence[2].document.pages, [1]);
  assert.deepEqual(attached.evidence[2].document.blocks[0].range, [0, 24]);
  assert.equal("text" in attached.evidence[2].document.blocks[0], false);
  assert.equal(JSON.stringify(attached).includes("/Users/"), false);
});

test("truncated document extraction is visible during proposal review", () => {
  const attached = attachDocumentEvidence(
    { evidence: [], warnings: ["原有提示"] },
    {
      status: "extracted",
      fileName: "statement.pdf",
      fileHash: "b".repeat(64),
      format: "pdf",
      byteCount: 4096,
      pageCount: 12,
      ocrPageCount: 10,
      unreadablePageCount: 2,
      truncated: true,
      evidence: [],
    },
  );

  assert.deepEqual(attached.warnings, [
    "原有提示",
    "文件有 2 页未识别，本次提案只基于其余可读页面。",
  ]);
});
