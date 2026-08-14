function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${field} is required.`);
  }
  return value.trim();
}

function clone(value) {
  return structuredClone(value);
}

export class DraftService {
  #drafts = new Map();
  #ledger;
  #clock;
  #idFactory;

  constructor({ ledger, clock = () => new Date(), idFactory = () => crypto.randomUUID() }) {
    if (!ledger || typeof ledger.appendBatch !== "function") {
      throw new TypeError("DraftService requires a ledger.");
    }
    this.#ledger = ledger;
    this.#clock = clock;
    this.#idFactory = idFactory;
  }

  createDraft(input) {
    if (!Array.isArray(input.proposedEvents) || input.proposedEvents.length === 0) {
      throw new TypeError("A draft requires at least one proposed event.");
    }

    const id = input.id ? requiredText(input.id, "id") : this.#idFactory();
    if (this.#drafts.has(id)) {
      throw new Error(`Draft "${id}" already exists.`);
    }

    const itemIds = new Set();
    const proposedEvents = input.proposedEvents.map((item) => {
      const itemId = requiredText(item.id, "proposed event id");
      if (itemIds.has(itemId)) {
        throw new Error(`Draft item id "${itemId}" is duplicated.`);
      }
      itemIds.add(itemId);
      return {
        id: itemId,
        event: clone(item.event),
        evidence: clone(item.evidence ?? []),
        confidence: item.confidence ?? null,
      };
    });

    const draft = {
      id,
      source: requiredText(input.source, "source"),
      sourceFingerprint: input.sourceFingerprint
        ? requiredText(input.sourceFingerprint, "sourceFingerprint")
        : null,
      status: "needs_review",
      proposedEvents,
      createdAt: this.#clock().toISOString(),
      confirmedAt: null,
      rejectedAt: null,
      receipt: null,
    };

    this.#drafts.set(id, draft);
    return clone(draft);
  }

  confirmDraft(draftId, confirmation) {
    const draft = this.#getMutableDraft(draftId);
    if (draft.status === "confirmed") {
      return clone(draft.receipt);
    }
    if (draft.status !== "needs_review") {
      throw new Error(`Draft "${draft.id}" cannot be confirmed from ${draft.status}.`);
    }
    if (confirmation?.confirmedByUser !== true) {
      throw new Error("Explicit user confirmation is required.");
    }

    const selected = new Set(confirmation.selectedItemIds ?? []);
    if (selected.size === 0) {
      throw new Error("At least one reviewed draft item must be selected.");
    }
    const knownIds = new Set(draft.proposedEvents.map((item) => item.id));
    for (const itemId of selected) {
      if (!knownIds.has(itemId)) {
        throw new Error(`Draft item "${itemId}" does not exist.`);
      }
    }

    const inputs = draft.proposedEvents
      .filter((item) => selected.has(item.id))
      .map((item) => ({
        ...clone(item.event),
        idempotencyKey: `draft:${draft.id}:${item.id}`,
        metadata: {
          ...(item.event.metadata ?? {}),
          draftId: draft.id,
          draftItemId: item.id,
          confirmedBy: requiredText(confirmation.confirmedBy, "confirmedBy"),
        },
      }));

    const ledgerResults = this.#ledger.appendBatch(inputs);
    draft.status = "confirmed";
    draft.confirmedAt = this.#clock().toISOString();
    draft.receipt = {
      draftId: draft.id,
      selectedItemIds: [...selected],
      events: ledgerResults.map((result) => result.event),
      confirmedAt: draft.confirmedAt,
    };

    return clone(draft.receipt);
  }

  rejectDraft(draftId, reason) {
    const draft = this.#getMutableDraft(draftId);
    if (draft.status !== "needs_review") {
      throw new Error(`Draft "${draft.id}" cannot be rejected from ${draft.status}.`);
    }
    draft.status = "rejected";
    draft.rejectedAt = this.#clock().toISOString();
    draft.rejectionReason = requiredText(reason, "reason");
    return clone(draft);
  }

  getDraft(draftId) {
    return clone(this.#getMutableDraft(draftId));
  }

  #getMutableDraft(draftId) {
    const id = requiredText(draftId, "draftId");
    const draft = this.#drafts.get(id);
    if (!draft) {
      throw new Error(`Draft "${id}" was not found.`);
    }
    return draft;
  }
}
