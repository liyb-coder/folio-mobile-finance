const PUBLIC_CONFIG_FIELDS = Object.freeze([
  "appId",
  "bffBaseUrl",
  "environment",
  "clientVersion",
]);

const ALLOWED_ENVIRONMENTS = new Set(["development", "test", "staging", "production"]);
const ALLOWED_SOURCE_KINDS = new Set(["text", "voice", "image", "document", "file"]);
const ALLOWED_ITEM_KINDS = new Set([
  "account",
  "holding",
  "transaction",
  "reminder",
  "planning",
]);
const SERVER_MANAGED_PROPOSAL_FIELDS = new Set([
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
]);

export const MINI_PROGRAM_PORT_REQUIREMENTS = Object.freeze({
  identity: Object.freeze(["beginLogin", "bindAccount", "reauthenticate", "logout"]),
  capture: Object.freeze([
    "startVoice",
    "stopVoice",
    "chooseImage",
    "chooseDocument",
    "releaseTransientSource",
  ]),
  proposals: Object.freeze(["create", "get", "confirm", "reject"]),
  repository: Object.freeze(["getSnapshot", "getSyncCursor"]),
  reminders: Object.freeze(["requestSubscription", "getSubscriptionState"]),
});

export class ContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ContractError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function requireNonEmptyString(value, code, label, maxLength = 512) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maxLength) {
    throw new ContractError(code, `${label} is required.`);
  }
  return normalized;
}

function normalizedSecretKey(key) {
  return String(key).replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function assertNoClientSecrets(value, path = [], ancestors = new WeakSet()) {
  if (!value || typeof value !== "object") return;
  if (ancestors.has(value)) {
    throw new ContractError(
      "runtime_config_cyclic",
      "Mini-program runtime configuration must be acyclic.",
      { field: path.join(".") },
    );
  }
  ancestors.add(value);
  for (const [key, nested] of Object.entries(value)) {
    const normalized = normalizedSecretKey(key);
    if (
      normalized.includes("apikey")
      || normalized.includes("appsecret")
      || normalized.includes("servicerole")
      || normalized.includes("privatekey")
      || normalized.includes("providersecret")
      || normalized.includes("accesstoken")
    ) {
      throw new ContractError(
        "client_secret_forbidden",
        "Mini-program runtime configuration must not contain secrets.",
        { field: [...path, key].join(".") },
      );
    }
    assertNoClientSecrets(nested, [...path, key], ancestors);
  }
  ancestors.delete(value);
}

export function assertSafeMiniProgramConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new ContractError("runtime_config_invalid", "Mini-program runtime config is required.");
  }
  assertNoClientSecrets(config);

  const unknownFields = Object.keys(config).filter((key) => !PUBLIC_CONFIG_FIELDS.includes(key));
  if (unknownFields.length > 0) {
    throw new ContractError(
      "runtime_config_field_forbidden",
      "Mini-program runtime config contains an unsupported field.",
      { field: unknownFields[0] },
    );
  }

  const appId = requireNonEmptyString(config.appId, "app_id_required", "appId", 64);
  if (!/^wx[a-zA-Z0-9]{16}$/.test(appId)) {
    throw new ContractError("app_id_invalid", "Mini-program appId is invalid.");
  }

  const bffBaseUrl = requireNonEmptyString(
    config.bffBaseUrl,
    "bff_base_url_required",
    "bffBaseUrl",
    2048,
  );
  let parsedUrl;
  try {
    parsedUrl = new URL(bffBaseUrl);
  } catch {
    throw new ContractError("bff_base_url_invalid", "BFF base URL is invalid.");
  }
  if (parsedUrl.protocol !== "https:") {
    throw new ContractError("https_required", "Mini-program BFF must use HTTPS.");
  }
  if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    throw new ContractError("bff_base_url_invalid", "BFF base URL must not contain credentials or query data.");
  }

  const environment = requireNonEmptyString(
    config.environment,
    "environment_required",
    "environment",
    32,
  );
  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    throw new ContractError("environment_invalid", "Mini-program environment is invalid.");
  }
  if (
    environment === "production"
    && (
      parsedUrl.hostname === "localhost"
      || parsedUrl.hostname.endsWith(".localhost")
      || parsedUrl.hostname === "::1"
      || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(parsedUrl.hostname)
    )
  ) {
    throw new ContractError(
      "production_endpoint_invalid",
      "Production mini-program BFF must use a configured public hostname.",
    );
  }

  const clientVersion = requireNonEmptyString(
    config.clientVersion,
    "client_version_required",
    "clientVersion",
    64,
  );

  return Object.freeze({ appId, bffBaseUrl, environment, clientVersion });
}

export function assertMiniProgramPorts(ports) {
  if (!ports || typeof ports !== "object") {
    throw new ContractError("platform_ports_required", "Mini-program platform ports are required.");
  }
  for (const [groupName, methods] of Object.entries(MINI_PROGRAM_PORT_REQUIREMENTS)) {
    const group = ports[groupName];
    for (const method of methods) {
      if (!group || typeof group[method] !== "function") {
        throw new ContractError(
          "missing_platform_port",
          `Mini-program platform port ${groupName}.${method} is required.`,
          { port: `${groupName}.${method}` },
        );
      }
    }
  }
  return ports;
}

function assertNoServerManagedState(value, path = [], ancestors = new WeakSet()) {
  if (!value || typeof value !== "object") return;
  if (ancestors.has(value)) {
    throw new ContractError(
      "proposal_cyclic",
      "Review proposals must be acyclic.",
      { field: path.join(".") },
    );
  }
  ancestors.add(value);
  for (const [field, nested] of Object.entries(value)) {
    if (SERVER_MANAGED_PROPOSAL_FIELDS.has(field)) {
      throw new ContractError(
        "proposal_contains_server_state",
        "Review proposals cannot carry server-managed ledger state.",
        { field: [...path, field].join(".") },
      );
    }
    assertNoServerManagedState(nested, [...path, field], ancestors);
  }
  ancestors.delete(value);
}

export function assertReviewableProposal(proposal) {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    throw new ContractError("proposal_invalid", "A proposal object is required.");
  }
  assertNoServerManagedState(proposal);
  const proposalId = requireNonEmptyString(
    proposal.proposalId,
    "proposal_id_required",
    "proposalId",
    256,
  );
  if (proposal.state !== "pending_review") {
    throw new ContractError(
      "proposal_not_reviewable",
      "External and AI-derived proposals must enter pending review.",
    );
  }
  if (!ALLOWED_SOURCE_KINDS.has(proposal.sourceKind)) {
    throw new ContractError("proposal_source_invalid", "Proposal source kind is invalid.");
  }
  const sourceId = requireNonEmptyString(
    proposal.sourceId,
    "proposal_source_id_required",
    "sourceId",
    256,
  );
  if (!Array.isArray(proposal.items) || proposal.items.length === 0 || proposal.items.length > 50) {
    throw new ContractError("proposal_items_required", "Proposal must contain reviewable items.");
  }

  const itemIds = new Set();
  const items = proposal.items.map((item) => {
    if (!item || typeof item !== "object") {
      throw new ContractError("proposal_item_invalid", "Proposal item is invalid.");
    }
    assertNoServerManagedState(item);
    const itemId = requireNonEmptyString(
      item.itemId,
      "proposal_item_id_required",
      "itemId",
      256,
    );
    if (itemIds.has(itemId)) {
      throw new ContractError("proposal_item_duplicate", "Proposal item IDs must be unique.");
    }
    itemIds.add(itemId);
    if (!ALLOWED_ITEM_KINDS.has(item.kind)) {
      throw new ContractError("proposal_item_kind_invalid", "Proposal item kind is invalid.");
    }
    if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
      throw new ContractError(
        "proposal_evidence_required",
        "Every proposal item requires source evidence.",
        { itemId },
      );
    }
    const normalizedEvidence = item.evidence.map((evidence) => {
      if (!evidence || typeof evidence !== "object") {
        throw new ContractError("proposal_evidence_invalid", "Proposal evidence is invalid.");
      }
      const evidenceSourceId = requireNonEmptyString(
        evidence.sourceId,
        "proposal_evidence_source_required",
        "evidence.sourceId",
        256,
      );
      if (evidenceSourceId !== sourceId) {
        throw new ContractError(
          "proposal_evidence_source_mismatch",
          "Proposal evidence must reference the captured source.",
          { itemId, evidenceSourceId, sourceId },
        );
      }
      const normalizedQuote = typeof evidence.quote === "string" ? evidence.quote.trim() : "";
      const hasQuote = normalizedQuote.length > 0 && normalizedQuote.length <= 40_000;
      const hasRegion = Array.isArray(evidence.region)
        && evidence.region.length === 4
        && evidence.region.every((coordinate) => Number.isFinite(coordinate) && coordinate >= 0)
        && evidence.region[2] >= evidence.region[0]
        && evidence.region[3] >= evidence.region[1];
      if (!hasQuote && !hasRegion) {
        throw new ContractError(
          "proposal_evidence_invalid",
          "Proposal evidence requires a quote or source region.",
          { itemId },
        );
      }
      return Object.freeze({
        ...evidence,
        sourceId: evidenceSourceId,
        ...(hasQuote ? { quote: normalizedQuote } : {}),
        ...(hasRegion ? { region: Object.freeze([...evidence.region]) } : {}),
      });
    });
    return Object.freeze({
      ...item,
      itemId,
      evidence: Object.freeze(normalizedEvidence),
    });
  });

  return Object.freeze({
    ...proposal,
    proposalId,
    sourceId,
    state: "pending_review",
    items: Object.freeze(items),
  });
}

export function createConfirmationCommand(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ContractError("confirmation_invalid", "Confirmation command is required.");
  }
  if (input.confirmedByUser !== true) {
    throw new ContractError(
      "explicit_confirmation_required",
      "Ledger confirmation requires explicit user intent.",
    );
  }
  const proposalId = requireNonEmptyString(
    input.proposalId,
    "proposal_id_required",
    "proposalId",
    256,
  );
  const idempotencyKey = requireNonEmptyString(
    input.idempotencyKey,
    "idempotency_key_required",
    "idempotencyKey",
    256,
  );
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new ContractError(
      "expected_version_invalid",
      "Confirmation requires a non-negative expected version.",
    );
  }
  if (!Array.isArray(input.confirmedItemIds) || input.confirmedItemIds.length === 0) {
    throw new ContractError("confirmed_items_required", "Confirmation requires selected items.");
  }
  const confirmedItemIds = input.confirmedItemIds.map((itemId) => requireNonEmptyString(
    itemId,
    "confirmed_item_id_invalid",
    "confirmedItemId",
    256,
  ));
  if (new Set(confirmedItemIds).size !== confirmedItemIds.length) {
    throw new ContractError("confirmed_items_duplicate", "Confirmed item IDs must be unique.");
  }

  return Object.freeze({
    proposalId,
    expectedVersion: input.expectedVersion,
    idempotencyKey,
    confirmedItemIds: Object.freeze(confirmedItemIds),
    confirmedByUser: true,
  });
}
