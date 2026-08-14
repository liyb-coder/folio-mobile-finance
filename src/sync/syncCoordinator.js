function assertMethod(target, method, label) {
  if (typeof target?.[method] !== "function") {
    throw new TypeError(`${label} must implement ${method}().`);
  }
}

function safeErrorCode(error) {
  const candidate = typeof error?.code === "string"
    ? error.code
    : typeof error?.message === "string" && /idempotency collision/i.test(error.message)
      ? "idempotency_collision"
      : "sync_unavailable";
  const normalized = candidate.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 80);
  return normalized || "sync_unavailable";
}

export class EncryptedSyncCoordinator {
  #local;
  #remote;

  constructor({ localRepository, remoteClient }) {
    for (const method of [
      "enableSync",
      "getSyncStatus",
      "prepareSyncOutbox",
      "listSyncOutbox",
      "recordSyncDelivery",
      "applyIncomingSyncEvents",
      "disableSync",
    ]) {
      assertMethod(localRepository, method, "Local encrypted repository");
    }
    for (const method of [
      "bootstrapEncryptedVault",
      "appendEncryptedEvent",
      "pullEncryptedEvents",
    ]) {
      assertMethod(remoteClient, method, "Remote encrypted sync client");
    }
    this.#local = localRepository;
    this.#remote = remoteClient;
  }

  async enable({ cloudUserId, platform }) {
    const bootstrap = await this.#local.enableSync({
      cloudUserId,
      platform,
      confirmedByUser: true,
    });
    try {
      await this.#remote.bootstrapEncryptedVault(bootstrap);
    } catch (error) {
      try {
        await this.#local.disableSync();
      } catch {
        // Preserve the remote failure as the actionable error. A later status
        // refresh still reports whether the local rollback also needs attention.
      }
      throw error;
    }
    return this.#local.getSyncStatus();
  }

  async flush({ batchSize = 250 } = {}) {
    await this.#local.prepareSyncOutbox(batchSize);
    const envelopes = await this.#local.listSyncOutbox();
    const results = [];
    for (const envelope of envelopes) {
      const eventId = envelope.eventId ?? envelope.event_id;
      try {
        const remote = await this.#remote.appendEncryptedEvent(envelope);
        const status = await this.#local.recordSyncDelivery({
          eventId,
          outcome: "synced",
          remoteReceivedAt: remote.receivedAt ?? new Date().toISOString(),
        });
        results.push({ eventId, outcome: "synced", status });
      } catch (error) {
        const errorCode = safeErrorCode(error);
        const needsReconciliation = errorCode === "idempotency_collision";
        const status = await this.#local.recordSyncDelivery({
          eventId,
          outcome: needsReconciliation ? "needs_reconciliation" : "retry",
          errorCode,
        });
        results.push({
          eventId,
          outcome: needsReconciliation ? "needs_reconciliation" : "retry",
          status,
        });
      }
    }
    return {
      attempted: envelopes.length,
      results,
      status: await this.#local.getSyncStatus(),
    };
  }

  async pull({ batchSize = 250 } = {}) {
    const status = await this.#local.getSyncStatus();
    if (!status?.enabled || !status?.cloudVaultId) {
      throw new Error("Encrypted sync must be enabled before pulling events.");
    }
    const page = await this.#remote.pullEncryptedEvents({
      vaultId: status.cloudVaultId,
      afterReceivedAt: status.lastInboundReceivedAt ?? null,
      afterEventId: status.lastInboundEventId ?? null,
      limit: batchSize,
    });
    if (page.events.length === 0) {
      return {
        received: 0,
        appliedCount: 0,
        duplicateCount: 0,
        conflictCount: 0,
        status,
      };
    }
    const applied = await this.#local.applyIncomingSyncEvents({
      events: page.events,
      cursorReceivedAt: page.cursor.receivedAt,
      cursorEventId: page.cursor.eventId,
    });
    return { received: page.events.length, ...applied };
  }

  async synchronize({ batchSize = 250 } = {}) {
    const upload = await this.flush({ batchSize });
    const download = await this.pull({ batchSize });
    return { upload, download };
  }

  async disable() {
    return this.#local.disableSync();
  }
}

export { safeErrorCode };
