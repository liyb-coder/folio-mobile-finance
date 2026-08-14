function assertClient(client) {
  if (!client || typeof client.from !== "function") {
    throw new TypeError("A Supabase data client is required.");
  }
  return client;
}

function normalizedBytea(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function remoteEnvelope(envelope) {
  return {
    event_id: envelope.event_id ?? envelope.eventId,
    vault_id: envelope.vault_id ?? envelope.vaultId,
    device_id: envelope.device_id ?? envelope.deviceId,
    event_kind: envelope.event_kind ?? envelope.eventKind,
    logical_clock: envelope.logical_clock ?? envelope.logicalClock,
    idempotency_key: envelope.idempotency_key ?? envelope.idempotencyKey,
    event_hash: envelope.event_hash ?? envelope.eventHash,
    previous_event_hash: envelope.previous_event_hash ?? envelope.previousEventHash ?? null,
    payload_nonce: envelope.payload_nonce ?? envelope.payloadNonce,
    payload_ciphertext: envelope.payload_ciphertext ?? envelope.payloadCiphertext,
    aad_version: envelope.aad_version ?? envelope.aadVersion,
    occurred_at: envelope.occurred_at ?? envelope.occurredAt,
  };
}

export function createSupabaseSyncClient(client) {
  const supabase = assertClient(client);

  return Object.freeze({
    async bootstrapEncryptedVault(bootstrap) {
      const { error } = await supabase.rpc("bootstrap_encrypted_vault", {
        p_vault_id: bootstrap.cloudVaultId,
        p_encrypted_name: bootstrap.encryptedVaultName,
        p_name_nonce: bootstrap.vaultNameNonce,
        p_device_id: bootstrap.deviceId,
        p_platform: bootstrap.platform,
        p_public_key: bootstrap.devicePublicKey,
        p_key_envelope_id: bootstrap.keyEnvelopeId,
        p_envelope_nonce: bootstrap.keyEnvelopeNonce,
        p_wrapped_key: bootstrap.wrappedSyncKey,
        p_key_version: bootstrap.keyVersion,
      });
      if (error) throw error;
      return {
        status: "provisioned",
        vaultId: bootstrap.cloudVaultId,
        deviceId: bootstrap.deviceId,
      };
    },

    async appendEncryptedEvent(envelope) {
      const row = remoteEnvelope(envelope);
      const { error } = await supabase
        .from("encrypted_sync_events")
        .insert(row);
      if (!error) return { status: "inserted", eventId: row.event_id };
      if (error.code !== "23505") throw error;

      const { data: existing, error: readError } = await supabase
        .from("encrypted_sync_events")
        .select("event_id,event_hash")
        .eq("vault_id", row.vault_id)
        .eq("idempotency_key", row.idempotency_key)
        .maybeSingle();
      if (readError) throw readError;
      if (
        existing?.event_id !== row.event_id
        || normalizedBytea(existing?.event_hash) !== normalizedBytea(row.event_hash)
      ) {
        throw new Error("Sync idempotency collision requires reconciliation.");
      }
      return { status: "already_synced", eventId: row.event_id };
    },

    async pullEncryptedEvents({ vaultId, afterReceivedAt, afterEventId, limit = 250 }) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        throw new TypeError("Sync page size must be between 1 and 500.");
      }
      let query = supabase
        .from("encrypted_sync_events")
        .select("*")
        .eq("vault_id", vaultId)
        .order("received_at", { ascending: true })
        .order("event_id", { ascending: true })
        .limit(limit);
      if (afterReceivedAt) {
        const cursor = `received_at.gt.${afterReceivedAt},and(received_at.eq.${afterReceivedAt},event_id.gt.${afterEventId})`;
        query = query.or(cursor);
      }
      const { data, error } = await query;
      if (error) throw error;
      const events = data ?? [];
      const last = events.at(-1);
      return {
        events,
        cursor: last ? {
          receivedAt: last.received_at,
          eventId: last.event_id,
        } : null,
      };
    },

    async listEncryptedVaultDevices({ vaultId }) {
      if (typeof vaultId !== "string" || !vaultId.trim()) {
        throw new TypeError("Encrypted vault identifier is required.");
      }
      const { data, error } = await supabase
        .from("devices")
        .select("id,platform,created_at,last_seen_at,revoked_at")
        .eq("vault_id", vaultId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((device) => ({
        id: device.id,
        platform: device.platform,
        createdAt: device.created_at,
        lastSeenAt: device.last_seen_at,
        revokedAt: device.revoked_at,
      }));
    },
  });
}

export { remoteEnvelope };
