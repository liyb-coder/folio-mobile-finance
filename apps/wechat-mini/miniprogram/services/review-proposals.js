const SOURCE_KINDS = ["text", "voice", "image", "document", "file"];
const ITEM_KINDS = ["account", "holding", "transaction", "reminder", "planning"];
const SERVER_MANAGED_FIELDS = [
  "applied",
  "appliedAt",
  "confirmed",
  "confirmedAt",
  "ledgerEventId",
  "ledgerEvents",
  "mutationApplied",
  "serverVersion",
  "status",
  "writeStatus",
];

function requiredText(value, field, maxLength) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${field} is invalid.`);
  }
  return normalized;
}

function normalizeBaseUrl(value) {
  const normalized = requiredText(value, "BFF address", 2048).replace(/\/$/, "");
  const match = /^(https?):\/\/([^/:?#]+)(?::\d+)?(?:\/[^?#]*)?$/.exec(normalized);
  if (!match) throw new Error("BFF address is invalid.");
  const protocol = match[1];
  const hostname = match[2].toLowerCase();
  const loopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  if (protocol !== "https" && !(protocol === "http" && loopback)) {
    throw new Error("Remote BFF must use HTTPS.");
  }
  return normalized;
}

function assertNoServerState(value, path, seen) {
  if (!value || typeof value !== "object") return;
  if (seen.indexOf(value) >= 0) throw new Error("Proposal must be acyclic.");
  seen.push(value);
  Object.keys(value).forEach((field) => {
    if (SERVER_MANAGED_FIELDS.indexOf(field) >= 0) {
      throw new Error(`Proposal contains server-managed state at ${path.concat(field).join(".")}.`);
    }
    assertNoServerState(value[field], path.concat(field), seen);
  });
  seen.pop();
}

function assertPendingProposal(proposal, input) {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    throw new Error("Review proposal is invalid.");
  }
  assertNoServerState(proposal, [], []);
  if (proposal.state !== "pending_review") throw new Error("Proposal must remain pending review.");
  if (proposal.sourceId !== input.sourceId || proposal.sourceKind !== input.sourceKind) {
    throw new Error("Proposal source does not match this capture.");
  }
  requiredText(proposal.proposalId, "proposalId", 256);
  if (!Array.isArray(proposal.items) || proposal.items.length < 1 || proposal.items.length > 20) {
    throw new Error("Proposal items are invalid.");
  }
  const itemIds = [];
  proposal.items.forEach((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Proposal item is invalid.");
    const itemId = requiredText(item.itemId, "itemId", 256);
    if (itemIds.indexOf(itemId) >= 0) throw new Error("Proposal item IDs must be unique.");
    itemIds.push(itemId);
    if (ITEM_KINDS.indexOf(item.kind) < 0) throw new Error("Proposal item kind is invalid.");
    requiredText(item.title, "item title", 160);
    if (!Array.isArray(item.evidence) || item.evidence.length < 1) {
      throw new Error("Every proposal item requires evidence.");
    }
    item.evidence.forEach((evidence) => {
      if (!evidence || evidence.sourceId !== input.sourceId) {
        throw new Error("Proposal evidence source is invalid.");
      }
      const quote = requiredText(evidence.quote, "evidence quote", 40_000);
      if (input.text.indexOf(quote) < 0) throw new Error("Proposal evidence is not present in the source.");
    });
  });
  return proposal;
}

async function createReviewProposal({ baseUrl, sourceId, sourceKind = "text", text, requestImpl } = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedSourceId = requiredText(sourceId, "sourceId", 256);
  const normalizedText = requiredText(text, "captured text", 40_000);
  if (SOURCE_KINDS.indexOf(sourceKind) < 0) throw new Error("Source kind is invalid.");
  const request = requestImpl || wx.request;
  if (typeof request !== "function") throw new Error("WeChat request capability is unavailable.");

  const input = {
    sourceId: normalizedSourceId,
    sourceKind,
    text: normalizedText,
  };
  return new Promise((resolve, reject) => {
    request({
      url: `${normalizedBaseUrl}/v1/review-proposals`,
      method: "POST",
      header: { "content-type": "application/json" },
      data: input,
      timeout: 20_000,
      success(response) {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error("Folio 暂时无法整理这段内容。"));
          return;
        }
        try {
          resolve(structuredClone(assertPendingProposal(response.data && response.data.proposal, input)));
        } catch (error) {
          reject(error);
        }
      },
      fail() {
        reject(new Error("网络不可用，本次内容尚未提交。"));
      },
    });
  });
}

module.exports = Object.freeze({ createReviewProposal });
