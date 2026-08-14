import {
  assertReviewableProposal,
  createConfirmationCommand,
} from "../../folio-contracts/src/index.js";

const RECENT_REAUTHENTICATION_MS = 5 * 60 * 1000;
const SOURCE_KINDS = new Set(["text", "voice", "image", "document", "file"]);

export class AgentBoundaryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AgentBoundaryError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function tool(name, description, options = {}) {
  return Object.freeze({
    name,
    description,
    readOnly: options.readOnly ?? true,
    mutationScope: options.mutationScope ?? "none",
    financialMutation: "forbidden",
    requiresForeground: options.requiresForeground ?? false,
    requiresReauthentication: options.requiresReauthentication ?? false,
    autonomousExecution: options.autonomousExecution ?? "allowed",
  });
}

export const AGENT_TOOL_MANIFEST = Object.freeze([
  tool(
    "folio.create_review_proposal",
    "Turn extracted text into evidence-covered finance items that always remain pending review.",
    { readOnly: false, mutationScope: "pending_review_only", autonomousExecution: "proposal_only" },
  ),
  tool("folio.list_due_reminders", "List due finance reminders without exposing unrelated records."),
  tool("folio.get_planning_snapshot", "Read a deterministic cash-planning snapshot with citations."),
  tool("folio.open_review", "Open the Folio review surface for a pending proposal."),
  tool("folio.simulate_idle_cash_plan", "Simulate allocatable cash without creating a transaction."),
]);

export function createStepxPublicToolRegistry(allTools) {
  if (!allTools || typeof allTools !== "object") {
    throw new AgentBoundaryError("agent_registry_invalid", "Folio Agent tools are unavailable.");
  }
  return Object.freeze(Object.fromEntries(AGENT_TOOL_MANIFEST.map(({ name }) => {
    const handler = allTools[name];
    if (typeof handler !== "function") {
      throw new AgentBoundaryError(
        "agent_public_tool_missing",
        "A declared STEPX tool has no runtime handler.",
        { name },
      );
    }
    return [name, handler];
  })));
}

function requiredPort(group, method) {
  if (!group || typeof group[method] !== "function") {
    throw new AgentBoundaryError(
      "agent_port_missing",
      `Folio Agent port ${method} is required.`,
      { port: method },
    );
  }
}

function requiredText(value, field, maxLength = 40_000) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maxLength) {
    throw new AgentBoundaryError("agent_input_invalid", `${field} is required.`, { field });
  }
  return normalized;
}

function requireRecentForegroundReauthentication(context, now) {
  if (context?.foreground !== true) {
    throw new AgentBoundaryError(
      "foreground_required",
      "Confirmation must be performed while Folio is visible in the foreground.",
    );
  }
  const reauthenticatedAt = Date.parse(context.reauthenticatedAt ?? "");
  const age = now.getTime() - reauthenticatedAt;
  if (
    !Number.isFinite(reauthenticatedAt)
    || age < 0
    || age > RECENT_REAUTHENTICATION_MS
  ) {
    throw new AgentBoundaryError(
      "recent_reauthentication_required",
      "Confirmation requires a recent password or biometric reauthentication.",
    );
  }
}

function normalizePlanningSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentBoundaryError("planning_snapshot_invalid", "Planning snapshot is unavailable.");
  }
  const availableCashMinor = requiredText(value.availableCashMinor, "availableCashMinor", 64);
  const reservedMinor = requiredText(value.reservedMinor, "reservedMinor", 64);
  if (!/^-?\d+$/.test(availableCashMinor) || !/^-?\d+$/.test(reservedMinor)) {
    throw new AgentBoundaryError("planning_amount_invalid", "Planning amounts must use integer minor units.");
  }
  const currency = requiredText(value.currency, "currency", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new AgentBoundaryError("planning_currency_invalid", "Planning currency is invalid.");
  }
  if (
    !Number.isFinite(value.evidenceCoverage)
    || value.evidenceCoverage < 0
    || value.evidenceCoverage > 1
  ) {
    throw new AgentBoundaryError(
      "planning_evidence_coverage_invalid",
      "Planning evidence coverage must be between zero and one.",
    );
  }
  if (!Array.isArray(value.citations) || value.citations.length === 0) {
    throw new AgentBoundaryError(
      "planning_citations_required",
      "Planning snapshots require at least one ledger or reminder citation.",
    );
  }
  const citations = value.citations.map((citation) => requiredText(citation, "citation", 256));
  return Object.freeze({
    ...value,
    availableCashMinor,
    reservedMinor,
    currency,
    citations: Object.freeze(citations),
  });
}

export function createFolioAgentTools({
  proposals,
  reminders,
  repository,
  navigation,
  clock = () => new Date(),
}) {
  requiredPort(proposals, "create");
  requiredPort(proposals, "get");
  requiredPort(proposals, "confirm");
  requiredPort(reminders, "listDue");
  requiredPort(repository, "getPlanningSnapshot");
  requiredPort(navigation, "openReview");

  async function createReviewProposal(input) {
    if (!SOURCE_KINDS.has(input?.sourceKind)) {
      throw new AgentBoundaryError("source_kind_invalid", "Captured source kind is invalid.");
    }
    const sourceId = requiredText(input.sourceId, "sourceId", 256);
    const text = requiredText(input.text, "text");
    const proposal = await proposals.create({
      sourceKind: input.sourceKind,
      sourceId,
      text,
      context: input.context ?? null,
    });
    return assertReviewableProposal(proposal);
  }

  async function listDueReminders(input = {}) {
    const result = await reminders.listDue({
      from: input.from ?? null,
      through: input.through ?? null,
      limit: Number.isSafeInteger(input.limit) ? Math.min(Math.max(input.limit, 1), 50) : 20,
    });
    if (!Array.isArray(result)) {
      throw new AgentBoundaryError("reminder_result_invalid", "Reminder result must be a list.");
    }
    return structuredClone(result);
  }

  async function getPlanningSnapshot(input = {}) {
    const result = await repository.getPlanningSnapshot({
      horizonDays: Number.isSafeInteger(input.horizonDays)
        ? Math.min(Math.max(input.horizonDays, 1), 365)
        : 30,
    });
    return normalizePlanningSnapshot(result);
  }

  async function openReview(input) {
    const proposalId = requiredText(input?.proposalId, "proposalId", 256);
    const proposal = await proposals.get(proposalId);
    if (!proposal) {
      throw new AgentBoundaryError("proposal_not_found", "Review proposal was not found.");
    }
    assertReviewableProposal(proposal);
    return navigation.openReview({ proposalId });
  }

  async function confirmSelectedItems(input, context = {}) {
    requireRecentForegroundReauthentication(context, clock());
    const command = createConfirmationCommand(input);
    const proposal = await proposals.get(command.proposalId);
    if (!proposal) {
      throw new AgentBoundaryError("proposal_not_found", "Review proposal was not found.");
    }
    const reviewable = assertReviewableProposal(proposal);
    const knownItemIds = new Set(reviewable.items.map((item) => item.itemId));
    for (const itemId of command.confirmedItemIds) {
      if (!knownItemIds.has(itemId)) {
        throw new AgentBoundaryError(
          "confirmed_item_unknown",
          "A selected proposal item does not exist.",
          { itemId },
        );
      }
    }
    return proposals.confirm(command);
  }

  async function simulateIdleCashPlan(input = {}) {
    const snapshot = await getPlanningSnapshot(input);
    const requestedReserve = input.reserveMinor == null
      ? BigInt(snapshot.reservedMinor)
      : BigInt(requiredText(input.reserveMinor, "reserveMinor", 64));
    if (requestedReserve < 0n) {
      throw new AgentBoundaryError("reserve_amount_invalid", "Simulation reserve cannot be negative.");
    }
    const available = BigInt(snapshot.availableCashMinor);
    return Object.freeze({
      mode: "simulation",
      currency: snapshot.currency,
      horizonDays: Number.isSafeInteger(input.horizonDays) ? input.horizonDays : 30,
      availableCashMinor: available.toString(),
      reserveMinor: requestedReserve.toString(),
      simulatableMinor: (available > requestedReserve ? available - requestedReserve : 0n).toString(),
      evidenceCoverage: snapshot.evidenceCoverage,
      citations: snapshot.citations,
      mutationApplied: false,
    });
  }

  return Object.freeze({
    "folio.create_review_proposal": createReviewProposal,
    "folio.list_due_reminders": listDueReminders,
    "folio.get_planning_snapshot": getPlanningSnapshot,
    "folio.open_review": openReview,
    "folio.confirm_selected_items": confirmSelectedItems,
    "folio.simulate_idle_cash_plan": simulateIdleCashPlan,
  });
}

export { RECENT_REAUTHENTICATION_MS };
