import http from "node:http";

import { DEEPSEEK_PROVIDER_ID } from "./deepseek-provider.js";

const MAX_BODY_BYTES = 64 * 1024;

function sendJson(response, status, payload, origin) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...(origin ? { "access-control-allow-origin": origin, vary: "origin" } : {}),
  });
  response.end(body);
}

async function readJson(request) {
  if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    const error = new Error("JSON content type is required.");
    error.code = "content_type_invalid";
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large.");
      error.code = "request_too_large";
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (cause) {
    const error = new Error("Request JSON is invalid.", { cause });
    error.code = "request_json_invalid";
    throw error;
  }
}

function safeOrigin(request, allowedOrigins) {
  const origin = typeof request.headers.origin === "string" ? request.headers.origin : "";
  return allowedOrigins.includes(origin) ? origin : "";
}

export function createFolioBffServer({
  configured = false,
  parseFinancialText,
  allowedOrigins = ["http://127.0.0.1:5173", "http://localhost:5173", "tauri://localhost"],
} = {}) {
  if (typeof parseFinancialText !== "function") {
    throw new TypeError("parseFinancialText is required.");
  }
  return http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const origin = safeOrigin(request, allowedOrigins);

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        ...(origin ? { "access-control-allow-origin": origin, vary: "origin" } : {}),
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
      });
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        provider: DEEPSEEK_PROVIDER_ID,
        configured: configured === true,
      }, origin);
      return;
    }
    if (request.method !== "POST" || url.pathname !== "/v1/review-proposals") {
      sendJson(response, 404, { error: { code: "route_not_found" } }, origin);
      return;
    }
    try {
      const body = await readJson(request);
      const proposal = await parseFinancialText({
        proposalId: body?.proposalId,
        sourceId: body?.sourceId,
        sourceKind: body?.sourceKind,
        text: body?.text,
      });
      sendJson(response, 200, { proposal }, origin);
    } catch (error) {
      const code = typeof error?.code === "string" ? error.code : "proposal_unavailable";
      const status = code.startsWith("request_") || code.startsWith("source_") || code === "content_type_invalid"
        ? 400
        : 502;
      sendJson(response, status, { error: { code } }, origin);
    }
  });
}
