import { assertReviewableProposal } from "../../packages/folio-contracts/src/index.js";

function normalizeBaseUrl(value) {
  const url = new URL(String(value || ""));
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error("DeepSeek BFF must use HTTPS, except for a loopback development server.");
  }
  return url.href.replace(/\/$/, "");
}

export function createDeepSeekBffClient({
  baseUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20_000,
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");

  async function parseText({ proposalId, sourceId, sourceKind = "text", text } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${normalizedBaseUrl}/v1/review-proposals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposalId, sourceId, sourceKind, text }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response?.ok) throw new Error("DeepSeek BFF could not create a review proposal.");
    const payload = await response.json();
    return assertReviewableProposal(payload?.proposal);
  }

  return Object.freeze({ baseUrl: normalizedBaseUrl, parseText });
}
