export class MemoryEncryptedQueueStore {
  #records = new Map();

  async put(record) {
    this.#records.set(record.event_id, structuredClone(record));
  }

  async get(eventId) {
    const record = this.#records.get(eventId);
    return record ? structuredClone(record) : null;
  }

  async list() {
    return [...this.#records.values()].map((record) => structuredClone(record));
  }
}

export class EncryptedSyncQueue {
  #store;

  constructor(store = new MemoryEncryptedQueueStore()) {
    if (!store?.put || !store?.get || !store?.list) {
      throw new TypeError("Encrypted queue store must implement put(), get(), and list().");
    }
    this.#store = store;
  }

  async enqueue(envelope) {
    if (!envelope?.event_id || !envelope?.payload_ciphertext) {
      throw new TypeError("Only encrypted event envelopes can enter the sync queue.");
    }
    const existing = await this.#store.get(envelope.event_id);
    if (existing) {
      if (
        existing.envelope.event_hash !== envelope.event_hash
        || existing.envelope.idempotency_key !== envelope.idempotency_key
      ) {
        throw new Error("Queue event identifier collision requires reconciliation.");
      }
      return existing;
    }
    const record = {
      event_id: envelope.event_id,
      vault_id: envelope.vault_id,
      status: "pending",
      attempts: 0,
      last_error_code: null,
      envelope: structuredClone(envelope),
    };
    await this.#store.put(record);
    return record;
  }

  async pending(vaultId) {
    const records = await this.#store.list();
    return records
      .filter((record) => record.vault_id === vaultId && record.status === "pending")
      .sort((a, b) => a.envelope.logical_clock - b.envelope.logical_clock);
  }

  async markAttempt(eventId, errorCode = null) {
    const record = await this.#store.get(eventId);
    if (!record) throw new Error("Queued encrypted event does not exist.");
    record.attempts += 1;
    record.last_error_code = errorCode;
    await this.#store.put(record);
    return record;
  }

  async markSynced(eventId) {
    const record = await this.#store.get(eventId);
    if (!record) throw new Error("Queued encrypted event does not exist.");
    record.status = "synced";
    record.last_error_code = null;
    await this.#store.put(record);
    return record;
  }

  async markConflict(eventId, errorCode = "conflict") {
    const record = await this.#store.get(eventId);
    if (!record) throw new Error("Queued encrypted event does not exist.");
    record.status = "needs_reconciliation";
    record.last_error_code = errorCode;
    await this.#store.put(record);
    return record;
  }
}
