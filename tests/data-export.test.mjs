import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { createLocalRepository } from "../src/data/local/localRepository.js";

test("portable export uses a single explicit native command with reauthentication", async () => {
  const calls = [];
  const repository = createLocalRepository(async (command, payload) => {
    calls.push([command, payload]);
    return { status: "exported" };
  });
  const request = {
    currentPassword: "correct horse battery staple",
    includeAuditLog: true,
    confirmedByUser: true,
  };
  await repository.createDataExport(request);
  assert.deepEqual(calls, [
    ["vault_data_export_create", { request }],
  ]);
});

test("first-phase UI exposes Markdown portability instead of the legacy export surface", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "../src/NativeVaultApp.jsx"),
    "utf8",
  );
  assert.match(source, /新增资料、全量重录与导出/);
  assert.match(source, /onSaveMarkdownExport/);
  assert.match(source, /serializeStructuredFolioMarkdown/);
  assert.doesNotMatch(source, /setDialog\("data-export"\)/);
});
