import assert from "node:assert/strict";
import test from "node:test";
import {
  createModelProviderRegistry,
  defaultModelProviderRegistry,
  localModelProvider,
} from "../src/ai/modelProvider.js";

test("default model provider exposes only local read and proposal capabilities", () => {
  assert.deepEqual(defaultModelProviderRegistry.list(), [{
    id: "folio_local_v1",
    label: "Folio 本地规则",
    dataBoundary: "device",
    capabilities: ["extract_proposal", "answer_ledger"],
  }]);
  assert.equal(localModelProvider.dataBoundary, "device");
  assert.equal(localModelProvider.capabilities.includes("transcribe_audio"), false);
});

test("model provider registry invokes local work without external consent", () => {
  const result = defaultModelProviderRegistry.invoke({
    capability: "answer_ledger",
    input: {
      question: "我现在总余额有多少钱？",
      snapshot: { vault: { baseCurrency: "CNY" }, accounts: [], balances: [] },
      now: new Date("2026-07-26T08:00:00+08:00"),
    },
  });
  assert.equal(result.status, "answered");
  assert.equal(result.privacy, "local_only");
});

test("external providers fail closed until the current request explicitly allows transfer", () => {
  let calls = 0;
  const external = {
    id: "test_external",
    label: "Test external",
    dataBoundary: "external",
    capabilities: ["transcribe_audio"],
    transcribe_audio(input) {
      calls += 1;
      return { transcript: input.name };
    },
  };
  const registry = createModelProviderRegistry([localModelProvider, external]);

  assert.throws(
    () => registry.invoke({
      providerId: "test_external",
      capability: "transcribe_audio",
      input: { name: "private.wav" },
    }),
    /explicit consent/,
  );
  assert.equal(calls, 0);

  assert.deepEqual(
    registry.invoke({
      providerId: "test_external",
      capability: "transcribe_audio",
      input: { name: "consented.wav" },
      allowExternal: true,
    }),
    { transcript: "consented.wav" },
  );
  assert.equal(calls, 1);
});

test("provider registration rejects undeclared or unimplemented capabilities", () => {
  assert.throws(
    () => createModelProviderRegistry([{
      id: "broken",
      dataBoundary: "device",
      capabilities: ["extract_document"],
    }]),
    /does not implement/,
  );
  assert.throws(
    () => createModelProviderRegistry([{
      id: "unknown",
      dataBoundary: "device",
      capabilities: ["rewrite_ledger"],
      rewrite_ledger() {},
    }]),
    /Unsupported model capability/,
  );
});
