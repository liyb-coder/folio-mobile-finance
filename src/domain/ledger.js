import { assertCurrency, normalizeMinor } from "./money.js";

const EVENT_STATUSES = Object.freeze(["confirmed", "reconciled"]);

export class IdempotencyConflictError extends Error {
  constructor(key) {
    super(`Idempotency key "${key}" was already used with different content.`);
    this.name = "IdempotencyConflictError";
  }
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function canonicalize(value) {
  return JSON.stringify(stableValue(value));
}

function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${field} is required.`);
  }
  return value.trim();
}

function normalizeTimestamp(value, field) {
  const text = requiredText(value, field);
  if (Number.isNaN(Date.parse(text))) {
    throw new TypeError(`${field} must be an ISO-compatible timestamp.`);
  }
  return new Date(text).toISOString();
}

function normalizeEventContent(input) {
  const status = input.status ?? "confirmed";
  if (!EVENT_STATUSES.includes(status)) {
    throw new TypeError(`Ledger status must be one of: ${EVENT_STATUSES.join(", ")}.`);
  }

  return {
    vaultId: requiredText(input.vaultId, "vaultId"),
    accountId: requiredText(input.accountId, "accountId"),
    eventType: requiredText(input.eventType, "eventType"),
    deltaMinor: normalizeMinor(input.deltaMinor),
    currency: assertCurrency(input.currency),
    occurredAt: normalizeTimestamp(input.occurredAt, "occurredAt"),
    status,
    idempotencyKey: requiredText(input.idempotencyKey, "idempotencyKey"),
    linkId: input.linkId ? requiredText(input.linkId, "linkId") : null,
    reversesEventId: input.reversesEventId
      ? requiredText(input.reversesEventId, "reversesEventId")
      : null,
    metadata: stableValue(input.metadata ?? {}),
  };
}

function clone(value) {
  return structuredClone(value);
}

export class InMemoryLedger {
  #events = [];
  #eventById = new Map();
  #eventByIdempotencyKey = new Map();
  #clock;
  #idFactory;

  constructor(options = {}) {
    this.#clock = options.clock ?? (() => new Date());
    this.#idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  append(input) {
    const [result] = this.appendBatch([input]);
    return result;
  }

  appendBatch(inputs) {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new TypeError("appendBatch requires at least one event.");
    }

    const nextEvents = [...this.#events];
    const nextById = new Map(this.#eventById);
    const nextByKey = new Map(this.#eventByIdempotencyKey);
    const results = [];

    for (const input of inputs) {
      const content = normalizeEventContent(input);
      const fingerprint = canonicalize(content);
      const existing = nextByKey.get(content.idempotencyKey);

      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new IdempotencyConflictError(content.idempotencyKey);
        }
        results.push({ event: clone(existing.event), duplicate: true });
        continue;
      }

      const id = input.id
        ? requiredText(input.id, "id")
        : requiredText(this.#idFactory(), "generated event id");
      if (nextById.has(id)) {
        throw new Error(`Ledger event id "${id}" already exists.`);
      }

      const event = Object.freeze({
        id,
        ...content,
        createdAt: normalizeTimestamp(this.#clock().toISOString(), "createdAt"),
      });
      nextEvents.push(event);
      nextById.set(id, event);
      nextByKey.set(content.idempotencyKey, { event, fingerprint });
      results.push({ event: clone(event), duplicate: false });
    }

    this.#events = nextEvents;
    this.#eventById = nextById;
    this.#eventByIdempotencyKey = nextByKey;
    return results;
  }

  reverse(eventId, options = {}) {
    const original = this.#eventById.get(requiredText(eventId, "eventId"));
    if (!original) {
      throw new Error(`Ledger event "${eventId}" was not found.`);
    }

    return this.append({
      vaultId: original.vaultId,
      accountId: original.accountId,
      eventType: "reversal",
      deltaMinor: (-BigInt(original.deltaMinor)).toString(),
      currency: original.currency,
      occurredAt: options.occurredAt ?? this.#clock().toISOString(),
      status: "confirmed",
      idempotencyKey: requiredText(options.idempotencyKey, "idempotencyKey"),
      linkId: original.linkId,
      reversesEventId: original.id,
      metadata: {
        reason: requiredText(options.reason, "reason"),
      },
    });
  }

  getBalance({ vaultId, accountId, currency }) {
    const normalizedVault = requiredText(vaultId, "vaultId");
    const normalizedAccount = requiredText(accountId, "accountId");
    const normalizedCurrency = assertCurrency(currency);

    return this.#events
      .filter((event) =>
        event.vaultId === normalizedVault
        && event.accountId === normalizedAccount
        && event.currency === normalizedCurrency,
      )
      .reduce((total, event) => total + BigInt(event.deltaMinor), 0n)
      .toString();
  }

  listEvents(query = {}) {
    return this.#events
      .filter((event) => !query.vaultId || event.vaultId === query.vaultId)
      .filter((event) => !query.accountId || event.accountId === query.accountId)
      .map(clone);
  }
}

export { EVENT_STATUSES };
