import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

import {
  DeepSeekProviderError,
  createDeepSeekProvider,
} from "../services/folio-bff/deepseek-provider.js";
import { createFolioBffServer } from "../services/folio-bff/server.js";
import { createDeepSeekBffClient } from "../src/ai/deepSeekBffClient.js";

const sourceText = "建行新增租金收入8000，今年8月20日需要交保费一万。";

function upstreamJson(content, model = "deepseek-v4-flash") {
  return new Response(JSON.stringify({
    model,
    choices: [{ finish_reason: "stop", message: { content } }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function validModelContent() {
  return JSON.stringify({
    summary: "识别到 1 笔收入和 1 个保费提醒",
    items: [
      {
        kind: "transaction",
        title: "建行租金收入",
        evidenceQuote: "建行新增租金收入8000",
        missingFields: ["交易具体日期"],
      },
      {
        kind: "reminder",
        title: "保费提醒",
        evidenceQuote: "今年8月20日需要交保费一万",
        missingFields: [],
      },
    ],
  });
}

test("DeepSeek provider fails before network access when the server credential is absent", () => {
  let called = false;
  assert.throws(
    () => createDeepSeekProvider({ apiKey: "", fetchImpl: async () => { called = true; } }),
    (error) => error instanceof DeepSeekProviderError && error.code === "deepseek_credential_missing",
  );
  assert.equal(called, false);
});

test("DeepSeek provider requests JSON output and returns evidence-covered pending review only", async () => {
  let captured;
  const provider = createDeepSeekProvider({
    apiKey: "server-only-test-key",
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return upstreamJson(validModelContent());
    },
  });

  const proposal = await provider.parseFinancialText({
    proposalId: "proposal-deepseek-1",
    sourceId: "voice-session-1",
    sourceKind: "voice",
    text: sourceText,
  });

  assert.equal(captured.url, "https://api.deepseek.com/chat/completions");
  assert.equal(captured.init.headers.authorization, "Bearer server-only-test-key");
  const requestBody = JSON.parse(captured.init.body);
  assert.equal(requestBody.response_format.type, "json_object");
  assert.match(requestBody.messages[0].content, /json/i);
  assert.equal(proposal.state, "pending_review");
  assert.equal(proposal.provider.id, "deepseek_bff_v1");
  assert.equal(proposal.items.length, 2);
  assert.equal(proposal.items[0].evidence[0].quote, "建行新增租金收入8000");
  assert.equal(JSON.stringify(proposal).includes("server-only-test-key"), false);
});

test("DeepSeek provider rejects hallucinated evidence, malformed JSON and server state", async () => {
  const cases = [
    [JSON.stringify({ summary: "x", items: [{ kind: "transaction", title: "x", evidenceQuote: "中国银行收入9000", missingFields: [] }] }), "deepseek_evidence_mismatch"],
    ["{not-json", "deepseek_output_invalid"],
    [JSON.stringify({ summary: "x", items: [{ kind: "transaction", title: "x", evidenceQuote: "建行新增租金收入8000", missingFields: [], ledgerEventId: "forged" }] }), "deepseek_output_field_forbidden"],
  ];

  for (const [content, code] of cases) {
    const provider = createDeepSeekProvider({
      apiKey: "server-only-test-key",
      fetchImpl: async () => upstreamJson(content),
    });
    await assert.rejects(
      provider.parseFinancialText({
        proposalId: `proposal-${code}`,
        sourceId: "voice-session-1",
        sourceKind: "voice",
        text: sourceText,
      }),
      (error) => error instanceof DeepSeekProviderError && error.code === code,
    );
  }
});

test("DeepSeek provider fails closed on truncation, empty finance output and upstream errors", async () => {
  const truncated = createDeepSeekProvider({
    apiKey: "server-only-test-key",
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ finish_reason: "length", message: { content: validModelContent() } }],
    }), { status: 200 }),
  });
  await assert.rejects(
    truncated.parseFinancialText({ sourceId: "text-1", text: sourceText }),
    (error) => error.code === "deepseek_output_truncated",
  );

  const empty = createDeepSeekProvider({
    apiKey: "server-only-test-key",
    fetchImpl: async () => upstreamJson(JSON.stringify({ summary: "无财务事项", items: [] })),
  });
  await assert.rejects(
    empty.parseFinancialText({ sourceId: "text-1", text: sourceText }),
    (error) => error.code === "deepseek_items_invalid",
  );

  const upstreamRejected = createDeepSeekProvider({
    apiKey: "server-only-test-key",
    fetchImpl: async () => new Response("upstream private diagnostics", { status: 429 }),
  });
  await assert.rejects(
    upstreamRejected.parseFinancialText({ sourceId: "text-1", text: sourceText }),
    (error) => error.code === "deepseek_upstream_rejected"
      && !error.message.includes("private diagnostics"),
  );
});

test("local BFF exposes a sanitized health route and a proposal-only route", async (t) => {
  const expectedProposal = Object.freeze({
    proposalId: "proposal-server-1",
    state: "pending_review",
    sourceKind: "text",
    sourceId: "text-1",
    items: Object.freeze([Object.freeze({
      itemId: "item-1",
      kind: "transaction",
      evidence: Object.freeze([Object.freeze({ sourceId: "text-1", quote: "测试收入100" })]),
    })]),
  });
  const server = createFolioBffServer({
    configured: true,
    parseFinancialText: async () => expectedProposal,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();

  const health = await fetch(`http://127.0.0.1:${port}/health`).then((response) => response.json());
  assert.deepEqual(health, { ok: true, provider: "deepseek_bff_v1", configured: true });

  const response = await fetch(`http://127.0.0.1:${port}/v1/review-proposals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceId: "text-1", sourceKind: "text", text: "测试收入100" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { proposal: expectedProposal });
});

test("desktop client accepts loopback development BFF and rejects forged confirmed proposals", async () => {
  const validProposal = {
    proposalId: "proposal-client-1",
    state: "pending_review",
    sourceKind: "text",
    sourceId: "text-1",
    items: [{
      itemId: "item-1",
      kind: "transaction",
      evidence: [{ sourceId: "text-1", quote: "测试收入100" }],
    }],
  };
  const client = createDeepSeekBffClient({
    baseUrl: "http://127.0.0.1:8787",
    fetchImpl: async () => new Response(JSON.stringify({ proposal: validProposal }), { status: 200 }),
  });
  const proposal = await client.parseText({ sourceId: "text-1", text: "测试收入100" });
  assert.equal(proposal.state, "pending_review");

  const hostileClient = createDeepSeekBffClient({
    baseUrl: "http://127.0.0.1:8787",
    fetchImpl: async () => new Response(JSON.stringify({
      proposal: { ...validProposal, state: "confirmed", ledgerEventId: "forged" },
    }), { status: 200 }),
  });
  await assert.rejects(hostileClient.parseText({ sourceId: "text-1", text: "测试收入100" }));

  assert.throws(
    () => createDeepSeekBffClient({ baseUrl: "http://folio.example" }),
    /must use HTTPS/,
  );
});
