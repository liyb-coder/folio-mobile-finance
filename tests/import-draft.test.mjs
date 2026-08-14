import assert from "node:assert/strict";
import test from "node:test";
import {
  arrayBufferToBase64,
  createCsvTextPayload,
  createImportMapping,
  createPastedTablePayload,
  presentImportRowError,
  toImportDraftInput,
  validateImportFileMeta,
  validateImportMapping,
} from "../src/data/local/importDraft.js";

test("import file validation accepts bounded CSV, TSV and XLSX files", () => {
  assert.equal(validateImportFileMeta({ name: "虚构流水.csv", size: 128 }), "");
  assert.equal(validateImportFileMeta({ name: "飞书复制流水.tsv", size: 256 }), "");
  assert.equal(validateImportFileMeta({ name: "虚构流水.xlsx", size: 1024 }), "");
  assert.match(
    validateImportFileMeta({ name: "真实账单.pdf", size: 128 }),
    /仅支持/,
  );
  assert.match(
    validateImportFileMeta({ name: "超大流水.csv", size: 10 * 1024 * 1024 + 1 }),
    /10 MB/,
  );
});

test("import mapping uses native suggestions and requires date and amount", () => {
  const inspection = {
    headers: ["日期", "金额", "类型", "说明"],
    suggestedMapping: {
      date: "日期",
      amount: "金额",
      transactionType: "类型",
      description: "说明",
    },
  };
  const mapping = createImportMapping(inspection);
  assert.deepEqual(mapping, {
    date: "日期",
    amount: "金额",
    transactionType: "类型",
    description: "说明",
    category: "",
    currency: "",
    externalId: "",
  });
  assert.equal(validateImportMapping(mapping, inspection, "account-1"), "");
  assert.match(
    validateImportMapping({ ...mapping, amount: "" }, inspection, "account-1"),
    /金额列/,
  );
  assert.deepEqual(
    toImportDraftInput(
      { fileName: "虚构流水.csv", contentBase64: "YSxi" },
      "account-1",
      mapping,
    ),
    {
      fileName: "虚构流水.csv",
      contentBase64: "YSxi",
      accountId: "account-1",
      mapping: {
        date: "日期",
        amount: "金额",
        transactionType: "类型",
        description: "说明",
        category: null,
        currency: null,
        externalId: null,
      },
    },
  );
});

test("binary import content is encoded without text coercion", () => {
  const bytes = Uint8Array.from([0, 1, 2, 253, 254, 255]);
  assert.equal(arrayBufferToBase64(bytes.buffer), "AAEC/f7/");
  const payload = createCsvTextPayload("日期,金额\n2026-07-01,100.00");
  assert.equal(payload.fileName, "粘贴流水.csv");
  assert.equal(
    new TextDecoder().decode(
      Uint8Array.from(atob(payload.contentBase64), (character) => character.charCodeAt(0)),
    ),
    "日期,金额\n2026-07-01,100.00",
  );
});

test("pasted spreadsheet cells preserve tabs and select the TSV parser", () => {
  const text = "日期\t金额\t类型\t说明\n2026-07-01\t-368.50\t支出\t虚构日用品";
  const payload = createPastedTablePayload(text);
  assert.equal(payload.fileName, "粘贴表格.tsv");
  assert.equal(
    new TextDecoder().decode(
      Uint8Array.from(atob(payload.contentBase64), (character) => character.charCodeAt(0)),
    ),
    text,
  );
  assert.equal(
    createPastedTablePayload("日期,金额\n2026-07-01,100.00").fileName,
    "粘贴流水.csv",
  );
});

test("native row errors are presented in concise Chinese", () => {
  assert.equal(
    presentImportRowError("Date must be a supported calendar date."),
    "日期必须是有效的 YYYY-MM-DD。",
  );
  assert.equal(
    presentImportRowError("External identifier is duplicated within this import file."),
    "外部流水号在本次文件中重复。",
  );
});
