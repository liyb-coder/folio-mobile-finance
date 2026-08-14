use crate::vault::VaultRuntime;
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use chrono::{Datelike, NaiveDate};
use hkdf::Hkdf;
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use sha2_10::Sha256 as HkdfSha256;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroizing;

const KEY_LENGTH: usize = 32;
const NONCE_LENGTH: usize = 24;
const MAX_OUTBOX_BATCH: usize = 250;

fn random_array<const N: usize>() -> Result<[u8; N], String> {
    let mut output = [0_u8; N];
    getrandom::fill(&mut output).map_err(|_| "Secure random generation failed.".to_owned())?;
    Ok(output)
}

fn random_uuid() -> Result<String, String> {
    let mut bytes = random_array::<16>()?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Ok(format!(
        "{}-{}-{}-{}-{}",
        hex::encode(&bytes[0..4]),
        hex::encode(&bytes[4..6]),
        hex::encode(&bytes[6..8]),
        hex::encode(&bytes[8..10]),
        hex::encode(&bytes[10..16])
    ))
}

fn random_id(prefix: &str) -> Result<String, String> {
    Ok(format!("{prefix}-{}", hex::encode(random_array::<16>()?)))
}

fn validate_uuid(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim().to_ascii_lowercase();
    let bytes = value.as_bytes();
    if bytes.len() != 36
        || ![8, 13, 18, 23]
            .into_iter()
            .all(|index| bytes[index] == b'-')
        || !bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| [8, 13, 18, 23].contains(&index) || byte.is_ascii_hexdigit())
    {
        return Err(format!("{label} must be a UUID."));
    }
    Ok(value)
}

fn validate_conflict_id(value: &str) -> Result<String, String> {
    let value = value.trim().to_ascii_lowercase();
    let encoded = value
        .strip_prefix("sync_conflict-")
        .ok_or_else(|| "Sync conflict identifier is invalid.".to_owned())?;
    if encoded.len() != 32 || !encoded.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Sync conflict identifier is invalid.".to_owned());
    }
    Ok(value)
}

fn validate_platform(value: &str) -> Result<String, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "macos" => Ok("macos".to_owned()),
        "ios" => Ok("ios".to_owned()),
        "android" => Ok("android".to_owned()),
        _ => Err("Sync platform must be macos, ios, or android.".to_owned()),
    }
}

fn postgres_bytea(bytes: &[u8]) -> String {
    format!("\\x{}", hex::encode(bytes))
}

fn wrap_aad(
    cloud_vault_id: &str,
    sender_device_id: &str,
    recipient_device_id: &str,
    key_version: i64,
) -> Vec<u8> {
    format!(
        "folio:sync-key-wrap:v1:{cloud_vault_id}:{sender_device_id}:{recipient_device_id}:{key_version}"
    )
    .into_bytes()
}

fn wrap_sync_key(
    sync_key: &[u8; KEY_LENGTH],
    device_private_key: &[u8; KEY_LENGTH],
    device_public_key: &[u8; KEY_LENGTH],
    cloud_vault_id: &str,
    device_id: &str,
    key_version: i64,
) -> Result<([u8; NONCE_LENGTH], Vec<u8>), String> {
    let secret = StaticSecret::from(*device_private_key);
    let public = PublicKey::from(*device_public_key);
    let shared = secret.diffie_hellman(&public);
    let aad = wrap_aad(cloud_vault_id, device_id, device_id, key_version);
    let hkdf = Hkdf::<HkdfSha256>::new(Some(cloud_vault_id.as_bytes()), shared.as_bytes());
    let mut wrapping_key = Zeroizing::new([0_u8; KEY_LENGTH]);
    hkdf.expand(&aad, wrapping_key.as_mut())
        .map_err(|_| "Unable to derive the device wrapping key.".to_owned())?;
    let nonce = random_array::<NONCE_LENGTH>()?;
    let cipher = XChaCha20Poly1305::new_from_slice(wrapping_key.as_ref())
        .map_err(|_| "Unable to initialize the device wrapping cipher.".to_owned())?;
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: sync_key,
                aad: &aad,
            },
        )
        .map_err(|_| "Unable to wrap the sync key for this device.".to_owned())?;
    Ok((nonce, ciphertext))
}

fn encrypt_vault_name(
    sync_key: &[u8; KEY_LENGTH],
    cloud_vault_id: &str,
    display_name: &str,
) -> Result<([u8; NONCE_LENGTH], Vec<u8>), String> {
    let nonce = random_array::<NONCE_LENGTH>()?;
    let aad = format!("folio:vault-name:{cloud_vault_id}:v1");
    let cipher = XChaCha20Poly1305::new_from_slice(sync_key)
        .map_err(|_| "Unable to initialize vault metadata encryption.".to_owned())?;
    let plaintext = Zeroizing::new(display_name.as_bytes().to_vec());
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext.as_slice(),
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| "Unable to encrypt vault metadata.".to_owned())?;
    Ok((nonce, ciphertext))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnableSyncRequest {
    cloud_user_id: String,
    platform: String,
    confirmed_by_user: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncBootstrapResponse {
    enabled: bool,
    cloud_vault_id: String,
    cloud_user_id: String,
    device_id: String,
    platform: String,
    device_public_key: String,
    encrypted_vault_name: String,
    vault_name_nonce: String,
    key_envelope_id: String,
    key_envelope_nonce: String,
    wrapped_sync_key: String,
    key_version: i64,
}

type StoredBootstrap = (
    String,
    String,
    String,
    String,
    Vec<u8>,
    Vec<u8>,
    Vec<u8>,
    String,
    Vec<u8>,
    Vec<u8>,
    i64,
    bool,
);

fn bootstrap_response(stored: StoredBootstrap) -> SyncBootstrapResponse {
    SyncBootstrapResponse {
        cloud_vault_id: stored.0,
        cloud_user_id: stored.1,
        device_id: stored.2,
        platform: stored.3,
        device_public_key: postgres_bytea(&stored.4),
        encrypted_vault_name: postgres_bytea(&stored.5),
        vault_name_nonce: postgres_bytea(&stored.6),
        key_envelope_id: stored.7,
        key_envelope_nonce: postgres_bytea(&stored.8),
        wrapped_sync_key: postgres_bytea(&stored.9),
        key_version: stored.10,
        enabled: stored.11,
    }
}

fn read_bootstrap(
    connection: &rusqlite::Connection,
    local_vault_id: &str,
) -> Result<Option<StoredBootstrap>, String> {
    connection
        .query_row(
            "SELECT cloud_vault_id, cloud_user_id, device_id, platform,
                    device_public_key, encrypted_vault_name, vault_name_nonce,
                    key_envelope_id, key_envelope_nonce, wrapped_sync_key,
                    key_version, enabled
             FROM sync_config WHERE local_vault_id = ?1",
            [local_vault_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                    row.get(9)?,
                    row.get(10)?,
                    row.get::<_, i64>(11)? == 1,
                ))
            },
        )
        .optional()
        .map_err(|_| "Unable to inspect encrypted sync configuration.".to_owned())
}

fn enable_sync_at(
    connection: &mut rusqlite::Connection,
    local_vault_id: &str,
    request: EnableSyncRequest,
) -> Result<SyncBootstrapResponse, String> {
    if !request.confirmed_by_user {
        return Err("Enabling cloud sync requires explicit confirmation.".to_owned());
    }
    let cloud_user_id = validate_uuid(&request.cloud_user_id, "cloudUserId")?;
    let platform = validate_platform(&request.platform)?;
    if let Some(existing) = read_bootstrap(connection, local_vault_id)? {
        if existing.1 != cloud_user_id {
            return Err("This vault is already bound to a different cloud identity.".to_owned());
        }
        if !existing.11 {
            connection
                .execute(
                    "UPDATE sync_config
                     SET enabled = 1, disabled_at = NULL
                     WHERE local_vault_id = ?1",
                    [local_vault_id],
                )
                .map_err(|_| "Unable to re-enable encrypted sync.".to_owned())?;
        }
        return read_bootstrap(connection, local_vault_id)?
            .map(bootstrap_response)
            .ok_or_else(|| "Encrypted sync configuration disappeared.".to_owned());
    }

    let display_name: String = connection
        .query_row(
            "SELECT display_name FROM vaults WHERE id = ?1",
            [local_vault_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to read local vault metadata.".to_owned())?;
    let cloud_vault_id = random_uuid()?;
    let device_id = random_uuid()?;
    let key_envelope_id = random_uuid()?;
    let device_private_key = Zeroizing::new(random_array::<KEY_LENGTH>()?);
    let device_secret = StaticSecret::from(*device_private_key);
    let device_public_key = PublicKey::from(&device_secret).to_bytes();
    let sync_key = Zeroizing::new(random_array::<KEY_LENGTH>()?);
    let (name_nonce, encrypted_name) =
        encrypt_vault_name(&sync_key, &cloud_vault_id, &display_name)?;
    let (envelope_nonce, wrapped_sync_key) = wrap_sync_key(
        &sync_key,
        &device_private_key,
        &device_public_key,
        &cloud_vault_id,
        &device_id,
        1,
    )?;

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "Unable to start encrypted sync setup.".to_owned())?;
    transaction
        .execute(
            "INSERT INTO sync_config(
                local_vault_id, cloud_vault_id, cloud_user_id, device_id,
                platform, device_private_key, device_public_key, sync_key,
                encrypted_vault_name, vault_name_nonce, key_envelope_id,
                key_envelope_nonce, wrapped_sync_key, key_version,
                logical_clock, enabled, created_at
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                1, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![
                local_vault_id,
                cloud_vault_id,
                cloud_user_id,
                device_id,
                platform,
                device_private_key.as_slice(),
                device_public_key.as_slice(),
                sync_key.as_slice(),
                encrypted_name,
                name_nonce.as_slice(),
                key_envelope_id,
                envelope_nonce.as_slice(),
                wrapped_sync_key,
            ],
        )
        .map_err(|_| "Unable to save encrypted sync configuration.".to_owned())?;
    transaction
        .execute(
            "INSERT INTO audit_events(
                id, vault_id, category, action, actor_id, object_type,
                object_id, metadata_json, occurred_at
             ) VALUES (
                ?1, ?2, 'sync', 'enabled', 'local-user', 'device', ?3, ?4,
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![
                random_id("audit")?,
                local_vault_id,
                device_id,
                json!({
                    "cloudVaultId": cloud_vault_id,
                    "platform": platform
                })
                .to_string()
            ],
        )
        .map_err(|_| "Unable to audit encrypted sync setup.".to_owned())?;
    transaction
        .commit()
        .map_err(|_| "Unable to commit encrypted sync setup.".to_owned())?;

    read_bootstrap(connection, local_vault_id)?
        .map(bootstrap_response)
        .ok_or_else(|| "Encrypted sync configuration was not installed.".to_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatusResponse {
    enabled: bool,
    cloud_vault_id: Option<String>,
    device_id: Option<String>,
    platform: Option<String>,
    pending_count: i64,
    reconciliation_count: i64,
    inbound_conflict_count: i64,
    last_logical_clock: i64,
    last_inbound_received_at: Option<String>,
    last_inbound_event_id: Option<String>,
}

fn sync_status_at(
    connection: &rusqlite::Connection,
    local_vault_id: &str,
) -> Result<SyncStatusResponse, String> {
    let config: Option<(
        String,
        String,
        String,
        bool,
        i64,
        Option<String>,
        Option<String>,
    )> = connection
        .query_row(
            "SELECT cloud_vault_id, device_id, platform, enabled, logical_clock,
                    last_inbound_received_at, last_inbound_event_id
             FROM sync_config WHERE local_vault_id = ?1",
            [local_vault_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get::<_, i64>(3)? == 1,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .optional()
        .map_err(|_| "Unable to read encrypted sync status.".to_owned())?;
    let (pending_count, reconciliation_count): (i64, i64) = connection
        .query_row(
            "SELECT
                coalesce(sum(CASE WHEN state.status = 'pending' THEN 1 ELSE 0 END), 0),
                coalesce(sum(CASE WHEN state.status = 'needs_reconciliation' THEN 1 ELSE 0 END), 0)
             FROM sync_delivery_state state
             JOIN sync_outbox_events event
               ON event.cloud_event_id = state.cloud_event_id
             WHERE event.local_vault_id = ?1",
            [local_vault_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| "Unable to count encrypted sync delivery state.".to_owned())?;
    let inbound_conflict_count: i64 = connection
        .query_row(
            "SELECT count(*)
             FROM sync_inbox_conflicts conflict
             WHERE conflict.local_vault_id = ?1
               AND NOT EXISTS (
                 SELECT 1
                 FROM sync_inbox_conflict_resolutions resolution
                 WHERE resolution.local_vault_id = conflict.local_vault_id
                   AND resolution.conflict_id = conflict.id
               )",
            [local_vault_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to count encrypted sync conflicts.".to_owned())?;
    Ok(SyncStatusResponse {
        enabled: config.as_ref().is_some_and(|value| value.3),
        cloud_vault_id: config.as_ref().map(|value| value.0.clone()),
        device_id: config.as_ref().map(|value| value.1.clone()),
        platform: config.as_ref().map(|value| value.2.clone()),
        pending_count,
        reconciliation_count,
        inbound_conflict_count,
        last_logical_clock: config.as_ref().map_or(0, |value| value.4),
        last_inbound_received_at: config.as_ref().and_then(|value| value.5.clone()),
        last_inbound_event_id: config.as_ref().and_then(|value| value.6.clone()),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareOutboxRequest {
    limit: Option<usize>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalLedgerPayload {
    schema_version: u8,
    local_event_id: String,
    account_id: String,
    draft_id: Option<String>,
    import_batch_id: Option<String>,
    event_type: String,
    delta_minor: i64,
    currency: String,
    occurred_at: String,
    status: String,
    local_idempotency_key: String,
    link_id: Option<String>,
    reverses_event_id: Option<String>,
    metadata: serde_json::Value,
    local_created_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct HoldingSnapshotPayload {
    schema_version: u8,
    holding_id: String,
    account_id: String,
    name: String,
    product_type: String,
    currency: String,
    masked_identifier: Option<String>,
    notes: Option<String>,
    created_at: String,
    archived_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct HoldingValuationSyncPayload {
    schema_version: u8,
    valuation_id: String,
    holding_id: String,
    draft_id: String,
    draft_source_type: String,
    units_micros: i64,
    cost_basis_minor: i64,
    market_value_minor: i64,
    as_of_date: String,
    source_type: String,
    created_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct HoldingOperationSyncPayload {
    schema_version: u8,
    operation_id: String,
    holding_id: String,
    draft_id: String,
    draft_source_type: String,
    operation_kind: String,
    amount_minor: i64,
    currency: String,
    units_delta_micros: i64,
    before_valuation_id: String,
    after_valuation_id: Option<String>,
    settlement_account_id: Option<String>,
    ledger_link_id: Option<String>,
    primary_ledger_event_id: Option<String>,
    secondary_ledger_event_id: Option<String>,
    occurred_on: String,
    description: String,
    notes: Option<String>,
    created_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct HoldingOperationCorrectionSyncPayload {
    schema_version: u8,
    correction_id: String,
    draft_id: String,
    draft_source_type: String,
    original_operation_id: String,
    compensating_operation_id: String,
    reason: String,
    created_at: String,
}

struct LocalDomainCandidate {
    event_kind: &'static str,
    source_id: String,
    source_version_id: String,
    occurred_at: String,
    payload: serde_json::Value,
}

type LocalLedgerRow = (
    String,
    String,
    Option<String>,
    Option<String>,
    String,
    i64,
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    String,
    String,
);

fn event_aad(
    cloud_vault_id: &str,
    device_id: &str,
    cloud_event_id: &str,
    event_kind: &str,
    idempotency_key: &str,
    logical_clock: i64,
    occurred_at: &str,
    previous_event_hash: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    serde_json::to_vec(&json!({
        "aadVersion": 2,
        "deviceId": device_id,
        "eventId": cloud_event_id,
        "eventKind": event_kind,
        "idempotencyKey": idempotency_key,
        "logicalClock": logical_clock,
        "occurredAt": occurred_at,
        "previousEventHash": previous_event_hash.map(hex::encode),
        "vaultId": cloud_vault_id
    }))
    .map_err(|_| "Unable to encode encrypted sync metadata.".to_owned())
}

fn source_was_queued(
    connection: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    event_kind: &str,
    source_version_id: &str,
) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM sync_outbox_events
                WHERE local_vault_id = ?1 AND event_kind = ?2
                  AND source_version_id = ?3
             )",
            params![local_vault_id, event_kind, source_version_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to inspect encrypted domain sync state.".to_owned())
}

fn immutable_source_was_received(
    connection: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    object_type: &str,
    object_id: &str,
) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM audit_events
                WHERE vault_id = ?1 AND category = 'sync'
                  AND action = 'incoming_applied'
                  AND object_type = ?2 AND object_id = ?3
             )",
            params![local_vault_id, object_type, object_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to inspect encrypted inbound domain history.".to_owned())
}

fn mutable_snapshot_needs_queue(
    connection: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    event_kind: &str,
    object_type: &str,
    object_id: &str,
) -> Result<bool, String> {
    let has_version: bool = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM sync_entity_versions
                WHERE local_vault_id = ?1 AND event_kind = ?2 AND source_id = ?3
             )",
            params![local_vault_id, event_kind, object_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to inspect encrypted snapshot version history.".to_owned())?;
    if !has_version {
        return Ok(true);
    }
    let latest_incoming_rowid: Option<i64> = connection
        .query_row(
            "SELECT max(rowid) FROM audit_events
             WHERE vault_id = ?1 AND category = 'sync'
               AND action = 'incoming_applied'
               AND object_type = ?2 AND object_id = ?3",
            params![local_vault_id, object_type, object_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to inspect the latest inbound snapshot audit.".to_owned())?;
    let Some(latest_incoming_rowid) = latest_incoming_rowid else {
        return Ok(true);
    };
    let local_sql = match event_kind {
        "account_snapshot" => {
            "SELECT max(rowid) FROM audit_events
             WHERE vault_id = ?1 AND object_type = 'account' AND object_id = ?2
               AND action IN ('account_created', 'account_updated', 'account_archived')"
        }
        "holding_snapshot" => {
            "SELECT max(rowid) FROM audit_events
             WHERE vault_id = ?1 AND object_type = 'holding' AND object_id = ?2
               AND action IN ('holding_created', 'holding_updated', 'holding_archived')"
        }
        "reminder_snapshot" => {
            "SELECT max(rowid) FROM audit_events
             WHERE vault_id = ?1 AND object_type = 'reminder' AND object_id = ?2
               AND action IN (
                 'reminder_create', 'reminder_update',
                 'reminder_complete', 'reminder_archive'
               )"
        }
        _ => return Err("Encrypted mutable snapshot kind is unsupported.".to_owned()),
    };
    let latest_local_rowid: Option<i64> = connection
        .query_row(local_sql, params![local_vault_id, object_id], |row| {
            row.get(0)
        })
        .map_err(|_| "Unable to inspect local snapshot mutation history.".to_owned())?;
    Ok(latest_local_rowid.is_some_and(|rowid| rowid > latest_incoming_rowid))
}

fn collect_domain_candidates(
    transaction: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    limit: usize,
) -> Result<Vec<LocalDomainCandidate>, String> {
    let mut candidates = Vec::with_capacity(limit);
    {
        let mut statement = transaction
            .prepare(
                "SELECT account.id, account.institution_name, account.display_name,
                        account.account_type, account.currency,
                        account.masked_identifier, account.notes, account.created_at,
                        account.archived_at,
                        coalesce((
                          SELECT audit.id FROM audit_events audit
                          WHERE audit.vault_id = account.vault_id
                            AND audit.object_type = 'account'
                            AND audit.object_id = account.id
                            AND audit.action IN (
                              'account_created', 'account_updated', 'account_archived'
                            )
                          ORDER BY audit.occurred_at DESC, audit.id DESC LIMIT 1
                        ), 'account-initial:' || account.id),
                        coalesce((
                          SELECT audit.occurred_at FROM audit_events audit
                          WHERE audit.vault_id = account.vault_id
                            AND audit.object_type = 'account'
                            AND audit.object_id = account.id
                            AND audit.action IN (
                              'account_created', 'account_updated', 'account_archived'
                            )
                          ORDER BY audit.occurred_at DESC, audit.id DESC LIMIT 1
                        ), account.created_at)
                 FROM accounts account
                 WHERE account.vault_id = ?1
                 ORDER BY account.created_at, account.id",
            )
            .map_err(|_| "Unable to inspect account sync snapshots.".to_owned())?;
        let rows = statement
            .query_map([local_vault_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                ))
            })
            .map_err(|_| "Unable to read account sync snapshots.".to_owned())?;
        for row in rows {
            let row = row.map_err(|_| "Unable to decode an account sync snapshot.".to_owned())?;
            if source_was_queued(transaction, local_vault_id, "account_snapshot", &row.9)?
                || !mutable_snapshot_needs_queue(
                    transaction,
                    local_vault_id,
                    "account_snapshot",
                    "account",
                    &row.0,
                )?
            {
                continue;
            }
            candidates.push(LocalDomainCandidate {
                event_kind: "account_snapshot",
                source_id: row.0.clone(),
                source_version_id: row.9,
                occurred_at: row.10,
                payload: json!({
                    "schemaVersion": 1,
                    "accountId": row.0,
                    "institutionName": row.1,
                    "displayName": row.2,
                    "accountType": row.3,
                    "currency": row.4,
                    "maskedIdentifier": row.5,
                    "notes": row.6,
                    "createdAt": row.7,
                    "archivedAt": row.8
                }),
            });
            if candidates.len() == limit {
                return Ok(candidates);
            }
        }
    }

    {
        let mut statement = transaction
            .prepare(
                "SELECT holding.id, holding.account_id, holding.name,
                        holding.product_type, holding.currency,
                        holding.masked_identifier, holding.notes,
                        holding.created_at, holding.archived_at,
                        coalesce((
                          SELECT audit.id FROM audit_events audit
                          WHERE audit.vault_id = holding.vault_id
                            AND audit.object_type = 'holding'
                            AND audit.object_id = holding.id
                            AND audit.action IN (
                              'holding_created', 'holding_updated', 'holding_archived'
                            )
                          ORDER BY audit.occurred_at DESC, audit.id DESC LIMIT 1
                        ), 'holding-initial:' || holding.id),
                        coalesce((
                          SELECT audit.occurred_at FROM audit_events audit
                          WHERE audit.vault_id = holding.vault_id
                            AND audit.object_type = 'holding'
                            AND audit.object_id = holding.id
                            AND audit.action IN (
                              'holding_created', 'holding_updated', 'holding_archived'
                            )
                          ORDER BY audit.occurred_at DESC, audit.id DESC LIMIT 1
                        ), holding.created_at)
                 FROM holdings holding
                 WHERE holding.vault_id = ?1
                 ORDER BY holding.created_at, holding.id",
            )
            .map_err(|_| "Unable to inspect holding sync snapshots.".to_owned())?;
        let rows = statement
            .query_map([local_vault_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                ))
            })
            .map_err(|_| "Unable to read holding sync snapshots.".to_owned())?;
        for row in rows {
            let row = row.map_err(|_| "Unable to decode a holding sync snapshot.".to_owned())?;
            if source_was_queued(transaction, local_vault_id, "holding_snapshot", &row.9)?
                || !mutable_snapshot_needs_queue(
                    transaction,
                    local_vault_id,
                    "holding_snapshot",
                    "holding",
                    &row.0,
                )?
            {
                continue;
            }
            candidates.push(LocalDomainCandidate {
                event_kind: "holding_snapshot",
                source_id: row.0.clone(),
                source_version_id: row.9,
                occurred_at: row.10,
                payload: serde_json::to_value(HoldingSnapshotPayload {
                    schema_version: 1,
                    holding_id: row.0,
                    account_id: row.1,
                    name: row.2,
                    product_type: row.3,
                    currency: row.4,
                    masked_identifier: row.5,
                    notes: row.6,
                    created_at: row.7,
                    archived_at: row.8,
                })
                .map_err(|_| "Unable to serialize an encrypted holding snapshot.".to_owned())?,
            });
            if candidates.len() == limit {
                return Ok(candidates);
            }
        }
    }

    {
        let mut statement = transaction
            .prepare(
                "SELECT valuation.id, valuation.holding_id, valuation.draft_id,
                        draft.source_type, valuation.units_micros,
                        valuation.cost_basis_minor, valuation.market_value_minor,
                        valuation.as_of_date, valuation.source_type,
                        valuation.created_at
                 FROM holding_valuations valuation
                 JOIN draft_changes draft
                   ON draft.id = valuation.draft_id
                  AND draft.vault_id = valuation.vault_id
                 WHERE valuation.vault_id = ?1
                   AND NOT EXISTS (
                     SELECT 1 FROM sync_outbox_events queued
                     WHERE queued.local_vault_id = valuation.vault_id
                       AND queued.event_kind = 'holding_valuation'
                       AND queued.source_version_id = valuation.id
                   )
                 ORDER BY valuation.created_at, valuation.id",
            )
            .map_err(|_| "Unable to inspect unsynced holding valuations.".to_owned())?;
        let rows = statement
            .query_map([local_vault_id], |row| {
                Ok(HoldingValuationSyncPayload {
                    schema_version: 1,
                    valuation_id: row.get(0)?,
                    holding_id: row.get(1)?,
                    draft_id: row.get(2)?,
                    draft_source_type: row.get(3)?,
                    units_micros: row.get(4)?,
                    cost_basis_minor: row.get(5)?,
                    market_value_minor: row.get(6)?,
                    as_of_date: row.get(7)?,
                    source_type: row.get(8)?,
                    created_at: row.get(9)?,
                })
            })
            .map_err(|_| "Unable to read unsynced holding valuations.".to_owned())?;
        for row in rows {
            let payload =
                row.map_err(|_| "Unable to decode an unsynced holding valuation.".to_owned())?;
            if immutable_source_was_received(
                transaction,
                local_vault_id,
                "holding_valuation",
                &payload.valuation_id,
            )? {
                continue;
            }
            candidates.push(LocalDomainCandidate {
                event_kind: "holding_valuation",
                source_id: payload.holding_id.clone(),
                source_version_id: payload.valuation_id.clone(),
                occurred_at: payload.created_at.clone(),
                payload: serde_json::to_value(payload).map_err(|_| {
                    "Unable to serialize an encrypted holding valuation.".to_owned()
                })?,
            });
            if candidates.len() == limit {
                return Ok(candidates);
            }
        }
    }

    {
        let mut statement = transaction
            .prepare(
                "SELECT event.id, event.account_id, event.draft_id,
                        event.import_batch_id, event.event_type, event.delta_minor,
                        event.currency, event.occurred_at, event.status,
                        event.idempotency_key, event.link_id,
                        event.reverses_event_id, event.metadata_json, event.created_at
                 FROM ledger_events event
                 WHERE event.vault_id = ?1
                   AND NOT EXISTS (
                     SELECT 1 FROM sync_outbox_events queued
                     WHERE queued.local_vault_id = event.vault_id
                       AND queued.event_kind = 'ledger_event'
                       AND queued.source_version_id = event.id
                   )
                 ORDER BY event.created_at, event.id",
            )
            .map_err(|_| "Unable to inspect unsynced ledger events.".to_owned())?;
        let rows = statement
            .query_map([local_vault_id], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                    row.get(9)?,
                    row.get(10)?,
                    row.get(11)?,
                    row.get(12)?,
                    row.get(13)?,
                ))
            })
            .map_err(|_| "Unable to read unsynced ledger events.".to_owned())?;
        for row in rows {
            let row: LocalLedgerRow =
                row.map_err(|_| "Unable to decode an unsynced ledger event.".to_owned())?;
            if immutable_source_was_received(transaction, local_vault_id, "ledger_event", &row.0)? {
                continue;
            }
            let payload = LocalLedgerPayload {
                schema_version: 1,
                local_event_id: row.0.clone(),
                account_id: row.1,
                draft_id: row.2,
                import_batch_id: row.3,
                event_type: row.4,
                delta_minor: row.5,
                currency: row.6,
                occurred_at: row.7.clone(),
                status: row.8,
                local_idempotency_key: row.9,
                link_id: row.10,
                reverses_event_id: row.11,
                metadata: serde_json::from_str(&row.12)
                    .map_err(|_| "Local ledger metadata is invalid.".to_owned())?,
                local_created_at: row.13,
            };
            candidates.push(LocalDomainCandidate {
                event_kind: "ledger_event",
                source_id: row.0.clone(),
                source_version_id: row.0,
                occurred_at: row.7,
                payload: serde_json::to_value(payload)
                    .map_err(|_| "Unable to serialize an encrypted ledger event.".to_owned())?,
            });
            if candidates.len() == limit {
                return Ok(candidates);
            }
        }
    }

    {
        let mut statement = transaction
            .prepare(
                "SELECT operation.id, operation.holding_id, operation.draft_id,
                        draft.source_type, operation.operation_kind,
                        operation.amount_minor, operation.currency,
                        operation.units_delta_micros,
                        operation.before_valuation_id, operation.after_valuation_id,
                        operation.settlement_account_id, operation.ledger_link_id,
                        operation.primary_ledger_event_id,
                        operation.secondary_ledger_event_id,
                        operation.occurred_on, operation.description,
                        operation.notes, operation.created_at
                 FROM holding_operations operation
                 JOIN draft_changes draft
                   ON draft.id = operation.draft_id
                  AND draft.vault_id = operation.vault_id
                 WHERE operation.vault_id = ?1
                   AND NOT EXISTS (
                     SELECT 1 FROM sync_outbox_events queued
                     WHERE queued.local_vault_id = operation.vault_id
                       AND queued.event_kind = 'holding_operation'
                       AND queued.source_version_id = operation.id
                   )
                 ORDER BY operation.created_at, operation.id",
            )
            .map_err(|_| "Unable to inspect unsynced holding operations.".to_owned())?;
        let rows = statement
            .query_map([local_vault_id], |row| {
                Ok(HoldingOperationSyncPayload {
                    schema_version: 1,
                    operation_id: row.get(0)?,
                    holding_id: row.get(1)?,
                    draft_id: row.get(2)?,
                    draft_source_type: row.get(3)?,
                    operation_kind: row.get(4)?,
                    amount_minor: row.get(5)?,
                    currency: row.get(6)?,
                    units_delta_micros: row.get(7)?,
                    before_valuation_id: row.get(8)?,
                    after_valuation_id: row.get(9)?,
                    settlement_account_id: row.get(10)?,
                    ledger_link_id: row.get(11)?,
                    primary_ledger_event_id: row.get(12)?,
                    secondary_ledger_event_id: row.get(13)?,
                    occurred_on: row.get(14)?,
                    description: row.get(15)?,
                    notes: row.get(16)?,
                    created_at: row.get(17)?,
                })
            })
            .map_err(|_| "Unable to read unsynced holding operations.".to_owned())?;
        for row in rows {
            let payload =
                row.map_err(|_| "Unable to decode an unsynced holding operation.".to_owned())?;
            if immutable_source_was_received(
                transaction,
                local_vault_id,
                "holding_operation",
                &payload.operation_id,
            )? {
                continue;
            }
            candidates.push(LocalDomainCandidate {
                event_kind: "holding_operation",
                source_id: payload.holding_id.clone(),
                source_version_id: payload.operation_id.clone(),
                occurred_at: payload.created_at.clone(),
                payload: serde_json::to_value(payload).map_err(|_| {
                    "Unable to serialize an encrypted holding operation.".to_owned()
                })?,
            });
            if candidates.len() == limit {
                return Ok(candidates);
            }
        }
    }

    {
        let mut statement = transaction
            .prepare(
                "SELECT correction.id, correction.draft_id, draft.source_type,
                        correction.original_operation_id,
                        correction.compensating_operation_id,
                        correction.reason, correction.created_at
                 FROM holding_operation_corrections correction
                 JOIN draft_changes draft
                   ON draft.id = correction.draft_id
                  AND draft.vault_id = correction.vault_id
                 WHERE correction.vault_id = ?1
                   AND NOT EXISTS (
                     SELECT 1 FROM sync_outbox_events queued
                     WHERE queued.local_vault_id = correction.vault_id
                       AND queued.event_kind = 'holding_operation_correction'
                       AND queued.source_version_id = correction.id
                   )
                 ORDER BY correction.created_at, correction.id",
            )
            .map_err(|_| "Unable to inspect unsynced holding operation corrections.".to_owned())?;
        let rows = statement
            .query_map([local_vault_id], |row| {
                Ok(HoldingOperationCorrectionSyncPayload {
                    schema_version: 1,
                    correction_id: row.get(0)?,
                    draft_id: row.get(1)?,
                    draft_source_type: row.get(2)?,
                    original_operation_id: row.get(3)?,
                    compensating_operation_id: row.get(4)?,
                    reason: row.get(5)?,
                    created_at: row.get(6)?,
                })
            })
            .map_err(|_| "Unable to read holding operation corrections.".to_owned())?;
        for row in rows {
            let payload =
                row.map_err(|_| "Unable to decode a holding operation correction.".to_owned())?;
            if immutable_source_was_received(
                transaction,
                local_vault_id,
                "holding_operation_correction",
                &payload.correction_id,
            )? {
                continue;
            }
            candidates.push(LocalDomainCandidate {
                event_kind: "holding_operation_correction",
                source_id: payload.original_operation_id.clone(),
                source_version_id: payload.correction_id.clone(),
                occurred_at: payload.created_at.clone(),
                payload: serde_json::to_value(payload).map_err(|_| {
                    "Unable to serialize a holding operation correction.".to_owned()
                })?,
            });
            if candidates.len() == limit {
                return Ok(candidates);
            }
        }
    }

    {
        let mut statement = transaction
            .prepare(
                "SELECT reminder.id, reminder.linked_account_id, reminder.category,
                        reminder.title, reminder.amount_minor, reminder.currency,
                        reminder.due_at, reminder.advance_seconds,
                        reminder.recurrence_rule, reminder.recurrence_anchor_month,
                        reminder.recurrence_anchor_day, reminder.status, reminder.notes,
                        reminder.created_at, reminder.updated_at, reminder.archived_at,
                        coalesce((
                          SELECT audit.id FROM audit_events audit
                          WHERE audit.vault_id = reminder.vault_id
                            AND audit.object_type = 'reminder'
                            AND audit.object_id = reminder.id
                            AND audit.action IN (
                              'reminder_create', 'reminder_update',
                              'reminder_complete', 'reminder_archive'
                            )
                          ORDER BY audit.occurred_at DESC, audit.id DESC LIMIT 1
                        ), 'reminder-initial:' || reminder.id),
                        coalesce((
                          SELECT audit.occurred_at FROM audit_events audit
                          WHERE audit.vault_id = reminder.vault_id
                            AND audit.object_type = 'reminder'
                            AND audit.object_id = reminder.id
                            AND audit.action IN (
                              'reminder_create', 'reminder_update',
                              'reminder_complete', 'reminder_archive'
                            )
                          ORDER BY audit.occurred_at DESC, audit.id DESC LIMIT 1
                        ), reminder.updated_at)
                 FROM reminders reminder
                 WHERE reminder.vault_id = ?1
                 ORDER BY reminder.created_at, reminder.id",
            )
            .map_err(|_| "Unable to inspect reminder sync snapshots.".to_owned())?;
        let rows = statement
            .query_map([local_vault_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, Option<i64>>(9)?,
                    row.get::<_, Option<i64>>(10)?,
                    row.get::<_, String>(11)?,
                    row.get::<_, Option<String>>(12)?,
                    row.get::<_, String>(13)?,
                    row.get::<_, String>(14)?,
                    row.get::<_, Option<String>>(15)?,
                    row.get::<_, String>(16)?,
                    row.get::<_, String>(17)?,
                ))
            })
            .map_err(|_| "Unable to read reminder sync snapshots.".to_owned())?;
        for row in rows {
            let row = row.map_err(|_| "Unable to decode a reminder sync snapshot.".to_owned())?;
            if source_was_queued(transaction, local_vault_id, "reminder_snapshot", &row.16)?
                || !mutable_snapshot_needs_queue(
                    transaction,
                    local_vault_id,
                    "reminder_snapshot",
                    "reminder",
                    &row.0,
                )?
            {
                continue;
            }
            let occurrences = reminder_occurrence_snapshots(transaction, local_vault_id, &row.0)?;
            candidates.push(LocalDomainCandidate {
                event_kind: "reminder_snapshot",
                source_id: row.0.clone(),
                source_version_id: row.16,
                occurred_at: row.17,
                payload: json!({
                    "schemaVersion": 1,
                    "reminderId": row.0,
                    "linkedAccountId": row.1,
                    "category": row.2,
                    "title": row.3,
                    "amountMinor": row.4,
                    "currency": row.5,
                    "dueAt": row.6,
                    "advanceSeconds": row.7,
                    "recurrenceRule": row.8,
                    "recurrenceAnchorMonth": row.9,
                    "recurrenceAnchorDay": row.10,
                    "status": row.11,
                    "notes": row.12,
                    "createdAt": row.13,
                    "updatedAt": row.14,
                    "archivedAt": row.15,
                    "occurrences": occurrences
                }),
            });
            if candidates.len() == limit {
                return Ok(candidates);
            }
        }
    }
    Ok(candidates)
}

fn prepare_outbox_at(
    connection: &mut rusqlite::Connection,
    local_vault_id: &str,
    request: PrepareOutboxRequest,
) -> Result<SyncStatusResponse, String> {
    let limit = request.limit.unwrap_or(MAX_OUTBOX_BATCH);
    if limit == 0 || limit > MAX_OUTBOX_BATCH {
        return Err("Sync preparation limit must be between 1 and 250.".to_owned());
    }
    let config: (String, String, Vec<u8>, i64, bool) = connection
        .query_row(
            "SELECT cloud_vault_id, device_id, sync_key, logical_clock, enabled
             FROM sync_config WHERE local_vault_id = ?1",
            [local_vault_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get::<_, i64>(4)? == 1,
                ))
            },
        )
        .optional()
        .map_err(|_| "Unable to read encrypted sync configuration.".to_owned())?
        .ok_or_else(|| "Encrypted sync has not been configured.".to_owned())?;
    if !config.4 {
        return Err("Encrypted sync is disabled.".to_owned());
    }
    if config.2.len() != KEY_LENGTH {
        return Err("Encrypted sync key is invalid.".to_owned());
    }
    let mut sync_key = Zeroizing::new([0_u8; KEY_LENGTH]);
    sync_key.copy_from_slice(&config.2);

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "Unable to start encrypted outbox preparation.".to_owned())?;
    let candidates = collect_domain_candidates(&transaction, local_vault_id, limit)?;
    let mut logical_clock = config.3;
    let mut previous_hash: Option<Vec<u8>> = transaction
        .query_row(
            "SELECT event_hash FROM sync_outbox_events
             WHERE local_vault_id = ?1
             ORDER BY logical_clock DESC LIMIT 1",
            [local_vault_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "Unable to continue the encrypted event hash chain.".to_owned())?;

    for candidate in candidates {
        logical_clock += 1;
        let cloud_event_id = random_uuid()?;
        let cloud_idempotency_key = format!(
            "local-domain:{}:{}:v2",
            candidate.event_kind, candidate.source_version_id
        );
        let plaintext = Zeroizing::new(
            serde_json::to_vec(&candidate.payload)
                .map_err(|_| "Unable to serialize an encrypted domain event.".to_owned())?,
        );
        let aad = event_aad(
            &config.0,
            &config.1,
            &cloud_event_id,
            candidate.event_kind,
            &cloud_idempotency_key,
            logical_clock,
            &candidate.occurred_at,
            previous_hash.as_deref(),
        )?;
        let nonce = random_array::<NONCE_LENGTH>()?;
        let cipher = XChaCha20Poly1305::new_from_slice(sync_key.as_ref())
            .map_err(|_| "Unable to initialize encrypted sync.".to_owned())?;
        let ciphertext = cipher
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: plaintext.as_slice(),
                    aad: &aad,
                },
            )
            .map_err(|_| "Unable to encrypt a local domain event.".to_owned())?;
        let mut hasher = Sha256::new();
        hasher.update(&aad);
        hasher.update(nonce);
        hasher.update(&ciphertext);
        let event_hash = hasher.finalize().to_vec();
        transaction
            .execute(
                "INSERT INTO sync_outbox_events(
                    cloud_event_id, local_vault_id, event_kind, source_id,
                    source_version_id, device_id, logical_clock, idempotency_key, event_hash,
                    previous_event_hash, payload_nonce, payload_ciphertext,
                    aad_version, occurred_at, created_at
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 2, ?13,
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![
                    cloud_event_id,
                    local_vault_id,
                    candidate.event_kind,
                    candidate.source_id,
                    candidate.source_version_id,
                    config.1,
                    logical_clock,
                    cloud_idempotency_key,
                    event_hash,
                    previous_hash,
                    nonce.as_slice(),
                    ciphertext,
                    candidate.occurred_at,
                ],
            )
            .map_err(|_| "Unable to append an encrypted sync envelope.".to_owned())?;
        if matches!(
            candidate.event_kind,
            "account_snapshot" | "holding_snapshot" | "reminder_snapshot"
        ) {
            transaction
                .execute(
                    "INSERT INTO sync_entity_versions(
                        local_vault_id, event_kind, source_id, device_id,
                        logical_clock, event_hash, cloud_event_id, updated_at
                     ) VALUES (
                        ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                     )
                     ON CONFLICT(local_vault_id, event_kind, source_id)
                     DO UPDATE SET
                       device_id = excluded.device_id,
                       logical_clock = excluded.logical_clock,
                       event_hash = excluded.event_hash,
                       cloud_event_id = excluded.cloud_event_id,
                       updated_at = excluded.updated_at",
                    params![
                        local_vault_id,
                        candidate.event_kind,
                        candidate.source_id,
                        config.1,
                        logical_clock,
                        event_hash,
                        cloud_event_id,
                    ],
                )
                .map_err(|_| "Unable to record the local sync entity version.".to_owned())?;
        }
        transaction
            .execute(
                "INSERT INTO sync_delivery_state(
                    cloud_event_id, status, attempt_count, updated_at
                 ) VALUES (
                    ?1, 'pending', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                [&cloud_event_id],
            )
            .map_err(|_| "Unable to create encrypted sync delivery state.".to_owned())?;
        previous_hash = Some(event_hash);
    }
    transaction
        .execute(
            "UPDATE sync_config SET logical_clock = ?1 WHERE local_vault_id = ?2",
            params![logical_clock, local_vault_id],
        )
        .map_err(|_| "Unable to advance the encrypted sync clock.".to_owned())?;
    transaction
        .commit()
        .map_err(|_| "Unable to commit encrypted sync preparation.".to_owned())?;
    sync_status_at(connection, local_vault_id)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutboxEnvelope {
    event_id: String,
    vault_id: String,
    device_id: String,
    event_kind: String,
    logical_clock: i64,
    idempotency_key: String,
    event_hash: String,
    previous_event_hash: Option<String>,
    payload_nonce: String,
    payload_ciphertext: String,
    aad_version: i64,
    occurred_at: String,
}

fn list_outbox_at(
    connection: &rusqlite::Connection,
    local_vault_id: &str,
) -> Result<Vec<SyncOutboxEnvelope>, String> {
    let cloud_vault_id: String = connection
        .query_row(
            "SELECT cloud_vault_id FROM sync_config
             WHERE local_vault_id = ?1 AND enabled = 1",
            [local_vault_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "Unable to read encrypted sync configuration.".to_owned())?
        .ok_or_else(|| "Encrypted sync is disabled.".to_owned())?;
    let mut statement = connection
        .prepare(
            "SELECT event.cloud_event_id, event.device_id, event.event_kind,
                    event.logical_clock, event.idempotency_key, event.event_hash,
                    event.previous_event_hash, event.payload_nonce,
                    event.payload_ciphertext, event.aad_version, event.occurred_at
             FROM sync_outbox_events event
             JOIN sync_delivery_state state
               ON state.cloud_event_id = event.cloud_event_id
             WHERE event.local_vault_id = ?1 AND state.status = 'pending'
             ORDER BY event.logical_clock, event.cloud_event_id
             LIMIT 250",
        )
        .map_err(|_| "Unable to inspect the encrypted sync outbox.".to_owned())?;
    let mapped = statement
        .query_map([local_vault_id], |row| {
            let event_hash: Vec<u8> = row.get(5)?;
            let previous_event_hash: Option<Vec<u8>> = row.get(6)?;
            let nonce: Vec<u8> = row.get(7)?;
            let ciphertext: Vec<u8> = row.get(8)?;
            Ok(SyncOutboxEnvelope {
                event_id: row.get(0)?,
                vault_id: cloud_vault_id.clone(),
                device_id: row.get(1)?,
                event_kind: row.get(2)?,
                logical_clock: row.get(3)?,
                idempotency_key: row.get(4)?,
                event_hash: postgres_bytea(&event_hash),
                previous_event_hash: previous_event_hash.as_deref().map(postgres_bytea),
                payload_nonce: postgres_bytea(&nonce),
                payload_ciphertext: postgres_bytea(&ciphertext),
                aad_version: row.get(9)?,
                occurred_at: row.get(10)?,
            })
        })
        .map_err(|_| "Unable to read the encrypted sync outbox.".to_owned())?;
    let envelopes = mapped
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Unable to decode the encrypted sync outbox.".to_owned())?;
    Ok(envelopes)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordDeliveryRequest {
    event_id: String,
    outcome: String,
    remote_received_at: Option<String>,
    error_code: Option<String>,
}

fn record_delivery_at(
    connection: &mut rusqlite::Connection,
    local_vault_id: &str,
    request: RecordDeliveryRequest,
) -> Result<SyncStatusResponse, String> {
    let event_id = validate_uuid(&request.event_id, "eventId")?;
    let (outcome, state) = match request.outcome.as_str() {
        "synced" => ("synced", "synced"),
        "retry" => ("retry", "pending"),
        "needs_reconciliation" => ("needs_reconciliation", "needs_reconciliation"),
        _ => return Err("Unsupported sync delivery outcome.".to_owned()),
    };
    let error_code = request
        .error_code
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    if error_code.as_ref().is_some_and(|value| {
        value.len() > 80
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    }) {
        return Err("Sync error code is invalid.".to_owned());
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "Unable to start sync delivery recording.".to_owned())?;
    let updated = transaction
        .execute(
            "UPDATE sync_delivery_state
             SET status = ?1,
                 attempt_count = attempt_count + 1,
                 last_error_code = ?2,
                 remote_received_at = CASE WHEN ?1 = 'synced' THEN ?3 ELSE remote_received_at END,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE cloud_event_id = ?4
               AND EXISTS (
                 SELECT 1 FROM sync_outbox_events event
                 WHERE event.cloud_event_id = sync_delivery_state.cloud_event_id
                   AND event.local_vault_id = ?5
               )",
            params![
                state,
                error_code,
                request.remote_received_at,
                event_id,
                local_vault_id
            ],
        )
        .map_err(|_| "Unable to update encrypted sync delivery state.".to_owned())?;
    if updated != 1 {
        return Err("Encrypted sync event does not exist.".to_owned());
    }
    transaction
        .execute(
            "INSERT INTO sync_delivery_attempts(
                id, cloud_event_id, outcome, error_code, occurred_at
             ) VALUES (
                ?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![random_id("sync_attempt")?, event_id, outcome, error_code],
        )
        .map_err(|_| "Unable to append encrypted sync delivery audit.".to_owned())?;
    transaction
        .commit()
        .map_err(|_| "Unable to commit encrypted sync delivery state.".to_owned())?;
    sync_status_at(connection, local_vault_id)
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncIncomingEnvelope {
    #[serde(alias = "event_id")]
    event_id: String,
    #[serde(alias = "vault_id")]
    vault_id: String,
    #[serde(alias = "device_id")]
    device_id: String,
    #[serde(alias = "event_kind")]
    event_kind: String,
    #[serde(alias = "logical_clock")]
    logical_clock: i64,
    #[serde(alias = "idempotency_key")]
    idempotency_key: String,
    #[serde(alias = "event_hash")]
    event_hash: String,
    #[serde(alias = "previous_event_hash")]
    previous_event_hash: Option<String>,
    #[serde(alias = "payload_nonce")]
    payload_nonce: String,
    #[serde(alias = "payload_ciphertext")]
    payload_ciphertext: String,
    #[serde(alias = "aad_version")]
    aad_version: i64,
    #[serde(alias = "occurred_at")]
    occurred_at: String,
    #[serde(alias = "received_at")]
    received_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyIncomingRequest {
    events: Vec<SyncIncomingEnvelope>,
    cursor_received_at: Option<String>,
    cursor_event_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyIncomingResponse {
    applied_count: usize,
    duplicate_count: usize,
    conflict_count: usize,
    status: SyncStatusResponse,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflictSummary {
    id: String,
    direction: String,
    cloud_event_id: String,
    event_kind: String,
    source_id: Option<String>,
    reason_code: String,
    remote_device_id: Option<String>,
    logical_clock: Option<i64>,
    occurred_at: String,
    resolution_action: Option<String>,
    resolved_at: Option<String>,
    can_inspect: bool,
    can_keep_local: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSyncConflictsRequest {
    include_resolved: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectSyncConflictRequest {
    conflict_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflictInspection {
    conflict: SyncConflictSummary,
    incoming_payload: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveSyncConflictRequest {
    conflict_id: String,
    confirmed_by_user: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveSyncConflictResponse {
    resolution_id: String,
    conflict_id: String,
    resolution_action: String,
    resolved_at: String,
    status: SyncStatusResponse,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountSnapshotPayload {
    schema_version: u8,
    account_id: String,
    institution_name: String,
    display_name: String,
    account_type: String,
    currency: String,
    masked_identifier: Option<String>,
    notes: Option<String>,
    created_at: String,
    archived_at: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReminderSnapshotPayload {
    schema_version: u8,
    reminder_id: String,
    linked_account_id: Option<String>,
    category: String,
    title: String,
    amount_minor: Option<i64>,
    currency: Option<String>,
    due_at: String,
    advance_seconds: i64,
    recurrence_rule: Option<String>,
    #[serde(default)]
    recurrence_anchor_month: Option<i64>,
    #[serde(default)]
    recurrence_anchor_day: Option<i64>,
    status: String,
    notes: Option<String>,
    created_at: String,
    updated_at: String,
    archived_at: Option<String>,
    #[serde(default)]
    occurrences: Vec<ReminderOccurrenceSnapshotPayload>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReminderOccurrenceSnapshotPayload {
    id: String,
    due_on: String,
    completed_at: String,
    next_due_on: Option<String>,
    confirmation_draft_id: String,
    created_at: String,
}

struct VerifiedIncoming {
    envelope: SyncIncomingEnvelope,
    event_hash: Vec<u8>,
    previous_event_hash: Option<Vec<u8>>,
    nonce: Vec<u8>,
    ciphertext: Vec<u8>,
    payload: serde_json::Value,
}

fn parse_postgres_bytea(
    value: &str,
    expected: Option<usize>,
    label: &str,
) -> Result<Vec<u8>, String> {
    let encoded = value.strip_prefix("\\x").unwrap_or(value);
    if encoded.is_empty() || encoded.len() % 2 != 0 {
        return Err(format!("{label} is not valid PostgreSQL bytea."));
    }
    let decoded =
        hex::decode(encoded).map_err(|_| format!("{label} is not valid PostgreSQL bytea."))?;
    if expected.is_some_and(|length| decoded.len() != length) {
        return Err(format!("{label} has an invalid length."));
    }
    Ok(decoded)
}

fn verify_incoming(
    envelope: SyncIncomingEnvelope,
    cloud_vault_id: &str,
    sync_key: &[u8; KEY_LENGTH],
) -> Result<VerifiedIncoming, String> {
    if validate_uuid(&envelope.event_id, "eventId")? != envelope.event_id.to_ascii_lowercase()
        || validate_uuid(&envelope.vault_id, "vaultId")? != cloud_vault_id
    {
        return Err("Encrypted sync event belongs to an unexpected vault.".to_owned());
    }
    validate_uuid(&envelope.device_id, "deviceId")?;
    if !matches!(
        envelope.event_kind.as_str(),
        "account_snapshot"
            | "holding_snapshot"
            | "holding_valuation"
            | "ledger_event"
            | "holding_operation"
            | "holding_operation_correction"
            | "reminder_snapshot"
    ) {
        return Err("Encrypted sync event kind is unsupported.".to_owned());
    }
    if envelope.logical_clock <= 0
        || envelope.aad_version != 2
        || envelope.idempotency_key.len() < 16
        || envelope.idempotency_key.len() > 160
        || envelope.occurred_at.trim().is_empty()
        || envelope.received_at.trim().is_empty()
    {
        return Err("Encrypted sync event metadata is invalid.".to_owned());
    }
    let event_hash = parse_postgres_bytea(&envelope.event_hash, Some(32), "eventHash")?;
    let previous_event_hash = envelope
        .previous_event_hash
        .as_deref()
        .map(|value| parse_postgres_bytea(value, Some(32), "previousEventHash"))
        .transpose()?;
    let nonce = parse_postgres_bytea(&envelope.payload_nonce, Some(NONCE_LENGTH), "payloadNonce")?;
    let ciphertext = parse_postgres_bytea(&envelope.payload_ciphertext, None, "payloadCiphertext")?;
    if ciphertext.len() < 17 || ciphertext.len() > 1_048_576 {
        return Err("Encrypted sync payload has an invalid size.".to_owned());
    }
    let aad = event_aad(
        cloud_vault_id,
        &envelope.device_id,
        &envelope.event_id,
        &envelope.event_kind,
        &envelope.idempotency_key,
        envelope.logical_clock,
        &envelope.occurred_at,
        previous_event_hash.as_deref(),
    )?;
    let mut hasher = Sha256::new();
    hasher.update(&aad);
    hasher.update(&nonce);
    hasher.update(&ciphertext);
    if hasher.finalize().as_slice() != event_hash.as_slice() {
        return Err("Encrypted sync event hash verification failed.".to_owned());
    }
    let cipher = XChaCha20Poly1305::new_from_slice(sync_key)
        .map_err(|_| "Unable to initialize encrypted sync verification.".to_owned())?;
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: &ciphertext,
                    aad: &aad,
                },
            )
            .map_err(|_| "Encrypted sync payload authentication failed.".to_owned())?,
    );
    let payload: serde_json::Value = serde_json::from_slice(plaintext.as_slice())
        .map_err(|_| "Encrypted sync payload is not valid JSON.".to_owned())?;
    Ok(VerifiedIncoming {
        envelope,
        event_hash,
        previous_event_hash,
        nonce,
        ciphertext,
        payload,
    })
}

fn inbox_state(
    transaction: &rusqlite::Transaction<'_>,
    event_id: &str,
    status: &str,
    source_id: Option<&str>,
    error_code: Option<&str>,
) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO sync_inbox_state(
                cloud_event_id, status, source_id, error_code, updated_at
             ) VALUES (
                ?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )
             ON CONFLICT(cloud_event_id) DO UPDATE SET
               status = excluded.status,
               source_id = excluded.source_id,
               error_code = excluded.error_code,
               updated_at = excluded.updated_at",
            params![event_id, status, source_id, error_code],
        )
        .map_err(|_| "Unable to update encrypted inbox state.".to_owned())?;
    Ok(())
}

fn record_inbox_conflict(
    transaction: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    verified: &VerifiedIncoming,
    source_id: Option<&str>,
    reason_code: &str,
) -> Result<(), String> {
    transaction
        .execute(
            "INSERT OR IGNORE INTO sync_inbox_conflicts(
                id, local_vault_id, cloud_event_id, event_kind, source_id,
                reason_code, details_json, occurred_at
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![
                random_id("sync_conflict")?,
                local_vault_id,
                verified.envelope.event_id,
                verified.envelope.event_kind,
                source_id,
                reason_code,
                json!({
                    "remoteDeviceId": verified.envelope.device_id,
                    "logicalClock": verified.envelope.logical_clock,
                    "requiresExplicitResolution": true
                })
                .to_string(),
            ],
        )
        .map_err(|_| "Unable to isolate an encrypted sync conflict.".to_owned())?;
    inbox_state(
        transaction,
        &verified.envelope.event_id,
        "conflict",
        source_id,
        Some(reason_code),
    )
}

fn inbox_hash_chain_is_valid(
    transaction: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    verified: &VerifiedIncoming,
) -> Result<bool, String> {
    if verified.envelope.logical_clock == 1 {
        return Ok(verified.previous_event_hash.is_none());
    }
    let predecessor: Option<Vec<u8>> = transaction
        .query_row(
            "SELECT event_hash FROM sync_inbox_events
             WHERE local_vault_id = ?1 AND device_id = ?2 AND logical_clock = ?3",
            params![
                local_vault_id,
                verified.envelope.device_id,
                verified.envelope.logical_clock - 1
            ],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "Unable to verify the encrypted device hash chain.".to_owned())?;
    Ok(predecessor.is_some() && predecessor.as_deref() == verified.previous_event_hash.as_deref())
}

fn current_account_snapshot(
    transaction: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    account_id: &str,
) -> Result<Option<AccountSnapshotPayload>, String> {
    transaction
        .query_row(
            "SELECT id, institution_name, display_name, account_type, currency,
                    masked_identifier, notes, created_at, archived_at
             FROM accounts WHERE vault_id = ?1 AND id = ?2",
            params![local_vault_id, account_id],
            |row| {
                Ok(AccountSnapshotPayload {
                    schema_version: 1,
                    account_id: row.get(0)?,
                    institution_name: row.get(1)?,
                    display_name: row.get(2)?,
                    account_type: row.get(3)?,
                    currency: row.get(4)?,
                    masked_identifier: row.get(5)?,
                    notes: row.get(6)?,
                    created_at: row.get(7)?,
                    archived_at: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(|_| "Unable to inspect the local account sync state.".to_owned())
}

fn entity_version(
    transaction: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    event_kind: &str,
    source_id: &str,
) -> Result<Option<(String, i64, Vec<u8>)>, String> {
    transaction
        .query_row(
            "SELECT device_id, logical_clock, event_hash
             FROM sync_entity_versions
             WHERE local_vault_id = ?1 AND event_kind = ?2 AND source_id = ?3",
            params![local_vault_id, event_kind, source_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|_| "Unable to inspect the local sync entity version.".to_owned())
}

fn save_entity_version(
    transaction: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    verified: &VerifiedIncoming,
    source_id: &str,
) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO sync_entity_versions(
                local_vault_id, event_kind, source_id, device_id,
                logical_clock, event_hash, cloud_event_id, updated_at
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )
             ON CONFLICT(local_vault_id, event_kind, source_id)
             DO UPDATE SET
               device_id = excluded.device_id,
               logical_clock = excluded.logical_clock,
               event_hash = excluded.event_hash,
               cloud_event_id = excluded.cloud_event_id,
               updated_at = excluded.updated_at",
            params![
                local_vault_id,
                verified.envelope.event_kind,
                source_id,
                verified.envelope.device_id,
                verified.envelope.logical_clock,
                verified.event_hash,
                verified.envelope.event_id,
            ],
        )
        .map_err(|_| "Unable to save the encrypted sync entity version.".to_owned())?;
    Ok(())
}

fn append_incoming_audit(
    transaction: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    verified: &VerifiedIncoming,
    object_type: &str,
    object_id: &str,
) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO audit_events(
                id, vault_id, category, action, actor_id, object_type,
                object_id, metadata_json, occurred_at
             ) VALUES (
                ?1, ?2, 'sync', 'incoming_applied', 'sync_remote', ?3, ?4, ?5,
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![
                random_id("audit")?,
                local_vault_id,
                object_type,
                object_id,
                json!({
                    "cloudEventId": verified.envelope.event_id,
                    "remoteDeviceId": verified.envelope.device_id,
                    "eventKind": verified.envelope.event_kind
                })
                .to_string()
            ],
        )
        .map_err(|_| "Unable to append the incoming sync audit event.".to_owned())?;
    Ok(())
}

enum ApplyOutcome {
    Applied,
    Duplicate,
    Conflict,
}

fn apply_account_snapshot(
    transaction: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    verified: &VerifiedIncoming,
) -> Result<ApplyOutcome, String> {
    let payload: AccountSnapshotPayload = serde_json::from_value(verified.payload.clone())
        .map_err(|_| "Encrypted account snapshot is invalid.".to_owned())?;
    if payload.schema_version != 1
        || payload.account_id.trim().is_empty()
        || payload.institution_name.trim().is_empty()
        || payload.display_name.trim().is_empty()
        || payload.currency.len() != 3
    {
        record_inbox_conflict(
            transaction,
            local_vault_id,
            verified,
            Some(&payload.account_id),
            "invalid_payload",
        )?;
        return Ok(ApplyOutcome::Conflict);
    }
    let current = current_account_snapshot(transaction, local_vault_id, &payload.account_id)?;
    let current_json = current
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(|_| "Unable to compare account sync snapshots.".to_owned())?;
    let incoming_json = serde_json::to_value(&payload)
        .map_err(|_| "Unable to compare an account sync snapshot.".to_owned())?;
    if current_json.as_ref() == Some(&incoming_json) {
        save_entity_version(transaction, local_vault_id, verified, &payload.account_id)?;
        inbox_state(
            transaction,
            &verified.envelope.event_id,
            "duplicate",
            Some(&payload.account_id),
            None,
        )?;
        return Ok(ApplyOutcome::Duplicate);
    }
    if let Some((device_id, logical_clock, _)) = entity_version(
        transaction,
        local_vault_id,
        "account_snapshot",
        &payload.account_id,
    )? {
        if device_id != verified.envelope.device_id {
            record_inbox_conflict(
                transaction,
                local_vault_id,
                verified,
                Some(&payload.account_id),
                "concurrent_edit",
            )?;
            return Ok(ApplyOutcome::Conflict);
        }
        if verified.envelope.logical_clock <= logical_clock {
            inbox_state(
                transaction,
                &verified.envelope.event_id,
                "duplicate",
                Some(&payload.account_id),
                Some("stale_version"),
            )?;
            return Ok(ApplyOutcome::Duplicate);
        }
    } else if current.is_some() {
        record_inbox_conflict(
            transaction,
            local_vault_id,
            verified,
            Some(&payload.account_id),
            "concurrent_edit",
        )?;
        return Ok(ApplyOutcome::Conflict);
    }

    if current.is_some() {
        transaction
            .execute(
                "UPDATE accounts SET
                    institution_name = ?1, display_name = ?2, account_type = ?3,
                    currency = ?4, masked_identifier = ?5, notes = ?6,
                    created_at = ?7, archived_at = ?8
                 WHERE vault_id = ?9 AND id = ?10",
                params![
                    payload.institution_name,
                    payload.display_name,
                    payload.account_type,
                    payload.currency,
                    payload.masked_identifier,
                    payload.notes,
                    payload.created_at,
                    payload.archived_at,
                    local_vault_id,
                    payload.account_id,
                ],
            )
            .map_err(|_| "Unable to apply the encrypted account snapshot.".to_owned())?;
    } else {
        transaction
            .execute(
                "INSERT INTO accounts(
                    id, vault_id, institution_name, display_name, account_type,
                    currency, masked_identifier, notes, created_at, archived_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    payload.account_id,
                    local_vault_id,
                    payload.institution_name,
                    payload.display_name,
                    payload.account_type,
                    payload.currency,
                    payload.masked_identifier,
                    payload.notes,
                    payload.created_at,
                    payload.archived_at,
                ],
            )
            .map_err(|_| "Unable to create an account from encrypted sync.".to_owned())?;
    }
    save_entity_version(transaction, local_vault_id, verified, &payload.account_id)?;
    append_incoming_audit(
        transaction,
        local_vault_id,
        verified,
        "account",
        &payload.account_id,
    )?;
    inbox_state(
        transaction,
        &verified.envelope.event_id,
        "applied",
        Some(&payload.account_id),
        None,
    )?;
    Ok(ApplyOutcome::Applied)
}

fn sync_conflict(
    transaction: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    verified: &VerifiedIncoming,
    source_id: &str,
    reason_code: &str,
) -> Result<ApplyOutcome, String> {
    record_inbox_conflict(
        transaction,
        local_vault_id,
        verified,
        Some(source_id),
        reason_code,
    )?;
    Ok(ApplyOutcome::Conflict)
}

fn valid_sync_currency(value: &str) -> bool {
    value.len() == 3 && value.bytes().all(|byte| byte.is_ascii_uppercase())
}

fn valid_sync_date(value: &str) -> bool {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
}

fn current_holding_snapshot(
    transaction: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    holding_id: &str,
) -> Result<Option<HoldingSnapshotPayload>, String> {
    transaction
        .query_row(
            "SELECT id, account_id, name, product_type, currency,
                    masked_identifier, notes, created_at, archived_at
             FROM holdings WHERE vault_id = ?1 AND id = ?2",
            params![local_vault_id, holding_id],
            |row| {
                Ok(HoldingSnapshotPayload {
                    schema_version: 1,
                    holding_id: row.get(0)?,
                    account_id: row.get(1)?,
                    name: row.get(2)?,
                    product_type: row.get(3)?,
                    currency: row.get(4)?,
                    masked_identifier: row.get(5)?,
                    notes: row.get(6)?,
                    created_at: row.get(7)?,
                    archived_at: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(|_| "Unable to inspect the local holding sync state.".to_owned())
}

fn apply_holding_snapshot(
    transaction: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    verified: &VerifiedIncoming,
) -> Result<ApplyOutcome, String> {
    let payload: HoldingSnapshotPayload = serde_json::from_value(verified.payload.clone())
        .map_err(|_| "Encrypted holding snapshot is invalid.".to_owned())?;
    if payload.schema_version != 1
        || payload.holding_id.trim().is_empty()
        || payload.account_id.trim().is_empty()
        || payload.name.trim().is_empty()
        || payload.name.chars().count() > 120
        || !matches!(
            payload.product_type.as_str(),
            "cash_management" | "fixed_income" | "fund" | "security" | "insurance" | "other"
        )
        || !valid_sync_currency(&payload.currency)
        || payload.masked_identifier.as_ref().is_some_and(|value| {
            value.chars().count() > 16
                || !value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
        || payload
            .notes
            .as_ref()
            .is_some_and(|value| value.chars().count() > 1000)
        || payload.created_at.trim().is_empty()
    {
        return sync_conflict(
            transaction,
            local_vault_id,
            verified,
            &payload.holding_id,
            "invalid_payload",
        );
    }
    let account_currency: Option<String> = transaction
        .query_row(
            "SELECT currency FROM accounts WHERE vault_id = ?1 AND id = ?2",
            params![local_vault_id, payload.account_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "Unable to validate a synced holding account.".to_owned())?;
    let Some(account_currency) = account_currency else {
        return sync_conflict(
            transaction,
            local_vault_id,
            verified,
            &payload.holding_id,
            "missing_dependency",
        );
    };
    if account_currency != payload.currency {
        return sync_conflict(
            transaction,
            local_vault_id,
            verified,
            &payload.holding_id,
            "invalid_payload",
        );
    }

    let current = current_holding_snapshot(transaction, local_vault_id, &payload.holding_id)?;
    if current.as_ref() == Some(&payload) {
        save_entity_version(transaction, local_vault_id, verified, &payload.holding_id)?;
        inbox_state(
            transaction,
            &verified.envelope.event_id,
            "duplicate",
            Some(&payload.holding_id),
            None,
        )?;
        return Ok(ApplyOutcome::Duplicate);
    }
    if let Some((device_id, logical_clock, _)) = entity_version(
        transaction,
        local_vault_id,
        "holding_snapshot",
        &payload.holding_id,
    )? {
        if device_id != verified.envelope.device_id {
            return sync_conflict(
                transaction,
                local_vault_id,
                verified,
                &payload.holding_id,
                "concurrent_edit",
            );
        }
        if verified.envelope.logical_clock <= logical_clock {
            inbox_state(
                transaction,
                &verified.envelope.event_id,
                "duplicate",
                Some(&payload.holding_id),
                Some("stale_version"),
            )?;
            return Ok(ApplyOutcome::Duplicate);
        }
    } else if current.is_some() {
        return sync_conflict(
            transaction,
            local_vault_id,
            verified,
            &payload.holding_id,
            "concurrent_edit",
        );
    }
    let colliding_holding: Option<String> = transaction
        .query_row(
            "SELECT id FROM holdings
             WHERE vault_id = ?1 AND account_id = ?2 AND name = ?3 AND id <> ?4
             LIMIT 1",
            params![
                local_vault_id,
                payload.account_id,
                payload.name,
                payload.holding_id
            ],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "Unable to validate synced holding identity.".to_owned())?;
    if colliding_holding.is_some() {
        return sync_conflict(
            transaction,
            local_vault_id,
            verified,
            &payload.holding_id,
            "idempotency_collision",
        );
    }

    if current.is_some() {
        transaction
            .execute(
                "UPDATE holdings SET
                    account_id = ?1, name = ?2, product_type = ?3, currency = ?4,
                    masked_identifier = ?5, notes = ?6, created_at = ?7,
                    archived_at = ?8
                 WHERE vault_id = ?9 AND id = ?10",
                params![
                    payload.account_id,
                    payload.name,
                    payload.product_type,
                    payload.currency,
                    payload.masked_identifier,
                    payload.notes,
                    payload.created_at,
                    payload.archived_at,
                    local_vault_id,
                    payload.holding_id,
                ],
            )
            .map_err(|_| "Unable to apply the encrypted holding snapshot.".to_owned())?;
    } else {
        transaction
            .execute(
                "INSERT INTO holdings(
                    id, vault_id, account_id, name, product_type, currency,
                    masked_identifier, notes, created_at, archived_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    payload.holding_id,
                    local_vault_id,
                    payload.account_id,
                    payload.name,
                    payload.product_type,
                    payload.currency,
                    payload.masked_identifier,
                    payload.notes,
                    payload.created_at,
                    payload.archived_at,
                ],
            )
            .map_err(|_| "Unable to create a holding from encrypted sync.".to_owned())?;
    }
    save_entity_version(transaction, local_vault_id, verified, &payload.holding_id)?;
    append_incoming_audit(
        transaction,
        local_vault_id,
        verified,
        "holding",
        &payload.holding_id,
    )?;
    inbox_state(
        transaction,
        &verified.envelope.event_id,
        "applied",
        Some(&payload.holding_id),
        None,
    )?;
    Ok(ApplyOutcome::Applied)
}

fn ensure_synced_draft(
    transaction: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    draft_id: &str,
    source_type: &str,
    created_at: &str,
    event_kind: &str,
) -> Result<bool, String> {
    let existing: Option<(String, String, String)> = transaction
        .query_row(
            "SELECT vault_id, source_type, status
             FROM draft_changes WHERE id = ?1",
            [draft_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|_| "Unable to inspect a synced review confirmation.".to_owned())?;
    if let Some((vault_id, existing_source_type, status)) = existing {
        return Ok(vault_id == local_vault_id
            && existing_source_type == source_type
            && status == "confirmed");
    }
    transaction
        .execute(
            "INSERT INTO draft_changes(
                id, vault_id, source_type, source_fingerprint, status,
                proposed_events_json, evidence_json, created_at,
                confirmed_at, confirmed_by
             ) VALUES (
                ?1, ?2, ?3, ?4, 'confirmed', ?5, ?6, ?7, ?7, 'sync_remote'
             )",
            params![
                draft_id,
                local_vault_id,
                source_type,
                format!("encrypted-sync:{draft_id}"),
                json!({
                    "kind": event_kind,
                    "source": "encrypted_sync",
                    "reviewedOnOriginDevice": true
                })
                .to_string(),
                json!([{
                    "source": "encrypted_sync",
                    "reviewedOnOriginDevice": true
                }])
                .to_string(),
                created_at,
            ],
        )
        .map_err(|_| "Unable to restore a synced review confirmation.".to_owned())?;
    Ok(true)
}

fn current_holding_valuation(
    transaction: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    valuation_id: &str,
    draft_id: &str,
) -> Result<Option<HoldingValuationSyncPayload>, String> {
    transaction
        .query_row(
            "SELECT valuation.id, valuation.holding_id, valuation.draft_id,
                    draft.source_type, valuation.units_micros,
                    valuation.cost_basis_minor, valuation.market_value_minor,
                    valuation.as_of_date, valuation.source_type,
                    valuation.created_at
             FROM holding_valuations valuation
             JOIN draft_changes draft
               ON draft.id = valuation.draft_id
              AND draft.vault_id = valuation.vault_id
             WHERE valuation.vault_id = ?1
               AND (valuation.id = ?2 OR valuation.draft_id = ?3)
             LIMIT 1",
            params![local_vault_id, valuation_id, draft_id],
            |row| {
                Ok(HoldingValuationSyncPayload {
                    schema_version: 1,
                    valuation_id: row.get(0)?,
                    holding_id: row.get(1)?,
                    draft_id: row.get(2)?,
                    draft_source_type: row.get(3)?,
                    units_micros: row.get(4)?,
                    cost_basis_minor: row.get(5)?,
                    market_value_minor: row.get(6)?,
                    as_of_date: row.get(7)?,
                    source_type: row.get(8)?,
                    created_at: row.get(9)?,
                })
            },
        )
        .optional()
        .map_err(|_| "Unable to inspect synced holding valuation idempotency.".to_owned())
}

fn apply_holding_valuation(
    transaction: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    verified: &VerifiedIncoming,
) -> Result<ApplyOutcome, String> {
    let payload: HoldingValuationSyncPayload = serde_json::from_value(verified.payload.clone())
        .map_err(|_| "Encrypted holding valuation is invalid.".to_owned())?;
    if payload.schema_version != 1
        || payload.valuation_id.trim().is_empty()
        || payload.holding_id.trim().is_empty()
        || payload.draft_id.trim().is_empty()
        || payload.draft_source_type.trim().is_empty()
        || payload.draft_source_type.chars().count() > 80
        || payload.units_micros < 0
        || payload.cost_basis_minor < 0
        || payload.market_value_minor < 0
        || !valid_sync_date(&payload.as_of_date)
        || !matches!(payload.source_type.as_str(), "manual" | "import")
        || payload.created_at.trim().is_empty()
    {
        return sync_conflict(
            transaction,
            local_vault_id,
            verified,
            &payload.valuation_id,
            "invalid_payload",
        );
    }
    let holding_exists: bool = transaction
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM holdings WHERE vault_id = ?1 AND id = ?2
             )",
            params![local_vault_id, payload.holding_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to validate a synced holding valuation.".to_owned())?;
    if !holding_exists {
        return sync_conflict(
            transaction,
            local_vault_id,
            verified,
            &payload.valuation_id,
            "missing_dependency",
        );
    }
    if let Some(existing) = current_holding_valuation(
        transaction,
        local_vault_id,
        &payload.valuation_id,
        &payload.draft_id,
    )? {
        if existing == payload {
            inbox_state(
                transaction,
                &verified.envelope.event_id,
                "duplicate",
                Some(&payload.valuation_id),
                None,
            )?;
            return Ok(ApplyOutcome::Duplicate);
        }
        return sync_conflict(
            transaction,
            local_vault_id,
            verified,
            &payload.valuation_id,
            "idempotency_collision",
        );
    }
    if !ensure_synced_draft(
        transaction,
        local_vault_id,
        &payload.draft_id,
        &payload.draft_source_type,
        &payload.created_at,
        "holding_valuation",
    )? {
        return sync_conflict(
            transaction,
            local_vault_id,
            verified,
            &payload.valuation_id,
            "idempotency_collision",
        );
    }
    transaction
        .execute(
            "INSERT INTO holding_valuations(
                id, vault_id, holding_id, draft_id, units_micros,
                cost_basis_minor, market_value_minor, as_of_date,
                source_type, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                payload.valuation_id,
                local_vault_id,
                payload.holding_id,
                payload.draft_id,
                payload.units_micros,
                payload.cost_basis_minor,
                payload.market_value_minor,
                payload.as_of_date,
                payload.source_type,
                payload.created_at,
            ],
        )
        .map_err(|_| "Unable to append an encrypted remote holding valuation.".to_owned())?;
    append_incoming_audit(
        transaction,
        local_vault_id,
        verified,
        "holding_valuation",
        &payload.valuation_id,
    )?;
    inbox_state(
        transaction,
        &verified.envelope.event_id,
        "applied",
        Some(&payload.valuation_id),
        None,
    )?;
    Ok(ApplyOutcome::Applied)
}

fn current_holding_operation(
    transaction: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    operation_id: &str,
    draft_id: &str,
) -> Result<Option<HoldingOperationSyncPayload>, String> {
    transaction
        .query_row(
            "SELECT operation.id, operation.holding_id, operation.draft_id,
                    draft.source_type, operation.operation_kind,
                    operation.amount_minor, operation.currency,
                    operation.units_delta_micros,
                    operation.before_valuation_id, operation.after_valuation_id,
                    operation.settlement_account_id, operation.ledger_link_id,
                    operation.primary_ledger_event_id,
                    operation.secondary_ledger_event_id,
                    operation.occurred_on, operation.description,
                    operation.notes, operation.created_at
             FROM holding_operations operation
             JOIN draft_changes draft
               ON draft.id = operation.draft_id
              AND draft.vault_id = operation.vault_id
             WHERE operation.vault_id = ?1
               AND (operation.id = ?2 OR operation.draft_id = ?3)
             LIMIT 1",
            params![local_vault_id, operation_id, draft_id],
            |row| {
                Ok(HoldingOperationSyncPayload {
                    schema_version: 1,
                    operation_id: row.get(0)?,
                    holding_id: row.get(1)?,
                    draft_id: row.get(2)?,
                    draft_source_type: row.get(3)?,
                    operation_kind: row.get(4)?,
                    amount_minor: row.get(5)?,
                    currency: row.get(6)?,
                    units_delta_micros: row.get(7)?,
                    before_valuation_id: row.get(8)?,
                    after_valuation_id: row.get(9)?,
                    settlement_account_id: row.get(10)?,
                    ledger_link_id: row.get(11)?,
                    primary_ledger_event_id: row.get(12)?,
                    secondary_ledger_event_id: row.get(13)?,
                    occurred_on: row.get(14)?,
                    description: row.get(15)?,
                    notes: row.get(16)?,
                    created_at: row.get(17)?,
                })
            },
        )
        .optional()
        .map_err(|_| "Unable to inspect synced holding operation idempotency.".to_owned())
}

fn synced_valuation_belongs_to_holding(
    transaction: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    valuation_id: &str,
    holding_id: &str,
) -> Result<bool, String> {
    transaction
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM holding_valuations
                WHERE vault_id = ?1 AND id = ?2 AND holding_id = ?3
             )",
            params![local_vault_id, valuation_id, holding_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to validate a synced holding operation valuation.".to_owned())
}

fn synced_ledger_reference_is_valid(
    transaction: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    event_id: &str,
    currency: &str,
    link_id: Option<&str>,
) -> Result<bool, String> {
    transaction
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM ledger_events
                WHERE vault_id = ?1 AND id = ?2 AND currency = ?3
                  AND (
                    (?4 IS NULL AND link_id IS NULL)
                    OR link_id = ?4
                  )
             )",
            params![local_vault_id, event_id, currency, link_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to validate a synced holding ledger reference.".to_owned())
}

fn apply_holding_operation(
    transaction: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    verified: &VerifiedIncoming,
) -> Result<ApplyOutcome, String> {
    let payload: HoldingOperationSyncPayload = serde_json::from_value(verified.payload.clone())
        .map_err(|_| "Encrypted holding operation is invalid.".to_owned())?;
    let is_position = matches!(payload.operation_kind.as_str(), "purchase" | "redeem");
    let is_cashflow = matches!(payload.operation_kind.as_str(), "dividend" | "fee");
    let reference_shape_is_valid = if is_position {
        payload.after_valuation_id.is_some()
            && if payload.settlement_account_id.is_some() {
                payload.ledger_link_id.is_some()
                    && payload.primary_ledger_event_id.is_some()
                    && payload.secondary_ledger_event_id.is_some()
            } else {
                payload.ledger_link_id.is_none()
                    && payload.primary_ledger_event_id.is_none()
                    && payload.secondary_ledger_event_id.is_none()
            }
    } else if is_cashflow {
        payload.after_valuation_id.is_none()
            && payload.units_delta_micros == 0
            && payload.settlement_account_id.is_some()
            && payload.ledger_link_id.is_none()
            && payload.primary_ledger_event_id.is_some()
            && payload.secondary_ledger_event_id.is_none()
    } else {
        false
    };
    if payload.schema_version != 1
        || payload.operation_id.trim().is_empty()
        || payload.holding_id.trim().is_empty()
        || payload.draft_id.trim().is_empty()
        || payload.draft_source_type.trim().is_empty()
        || payload.draft_source_type.chars().count() > 80
        || payload.amount_minor <= 0
        || !valid_sync_currency(&payload.currency)
        || payload.before_valuation_id.trim().is_empty()
        || !valid_sync_date(&payload.occurred_on)
        || payload.description.trim().is_empty()
        || payload.description.chars().count() > 120
        || payload
            .notes
            .as_ref()
            .is_some_and(|value| value.chars().count() > 1000)
        || payload.created_at.trim().is_empty()
        || (payload.operation_kind == "purchase" && payload.units_delta_micros <= 0)
        || (payload.operation_kind == "redeem" && payload.units_delta_micros >= 0)
        || payload.primary_ledger_event_id == payload.secondary_ledger_event_id
            && payload.primary_ledger_event_id.is_some()
        || !reference_shape_is_valid
    {
        return sync_conflict(
            transaction,
            local_vault_id,
            verified,
            &payload.operation_id,
            "invalid_payload",
        );
    }
    let holding_currency: Option<String> = transaction
        .query_row(
            "SELECT currency FROM holdings WHERE vault_id = ?1 AND id = ?2",
            params![local_vault_id, payload.holding_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "Unable to validate a synced holding operation.".to_owned())?;
    if holding_currency.as_deref() != Some(payload.currency.as_str()) {
        return sync_conflict(
            transaction,
            local_vault_id,
            verified,
            &payload.operation_id,
            if holding_currency.is_none() {
                "missing_dependency"
            } else {
                "invalid_payload"
            },
        );
    }
    if !synced_valuation_belongs_to_holding(
        transaction,
        local_vault_id,
        &payload.before_valuation_id,
        &payload.holding_id,
    )? || payload
        .after_valuation_id
        .as_deref()
        .map(|valuation_id| {
            synced_valuation_belongs_to_holding(
                transaction,
                local_vault_id,
                valuation_id,
                &payload.holding_id,
            )
        })
        .transpose()?
        == Some(false)
    {
        return sync_conflict(
            transaction,
            local_vault_id,
            verified,
            &payload.operation_id,
            "missing_dependency",
        );
    }
    if let Some(account_id) = payload.settlement_account_id.as_deref() {
        let currency: Option<String> = transaction
            .query_row(
                "SELECT currency FROM accounts WHERE vault_id = ?1 AND id = ?2",
                params![local_vault_id, account_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| "Unable to validate a synced settlement account.".to_owned())?;
        if currency.as_deref() != Some(payload.currency.as_str()) {
            return sync_conflict(
                transaction,
                local_vault_id,
                verified,
                &payload.operation_id,
                if currency.is_none() {
                    "missing_dependency"
                } else {
                    "invalid_payload"
                },
            );
        }
    }
    for event_id in [
        payload.primary_ledger_event_id.as_deref(),
        payload.secondary_ledger_event_id.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if !synced_ledger_reference_is_valid(
            transaction,
            local_vault_id,
            event_id,
            &payload.currency,
            payload.ledger_link_id.as_deref(),
        )? {
            return sync_conflict(
                transaction,
                local_vault_id,
                verified,
                &payload.operation_id,
                "missing_dependency",
            );
        }
    }
    if let Some(existing) = current_holding_operation(
        transaction,
        local_vault_id,
        &payload.operation_id,
        &payload.draft_id,
    )? {
        if existing == payload {
            inbox_state(
                transaction,
                &verified.envelope.event_id,
                "duplicate",
                Some(&payload.operation_id),
                None,
            )?;
            return Ok(ApplyOutcome::Duplicate);
        }
        return sync_conflict(
            transaction,
            local_vault_id,
            verified,
            &payload.operation_id,
            "idempotency_collision",
        );
    }
    if !ensure_synced_draft(
        transaction,
        local_vault_id,
        &payload.draft_id,
        &payload.draft_source_type,
        &payload.created_at,
        "holding_operation",
    )? {
        return sync_conflict(
            transaction,
            local_vault_id,
            verified,
            &payload.operation_id,
            "idempotency_collision",
        );
    }
    transaction
        .execute(
            "INSERT INTO holding_operations(
                id, vault_id, holding_id, draft_id, operation_kind,
                amount_minor, currency, units_delta_micros,
                before_valuation_id, after_valuation_id,
                settlement_account_id, ledger_link_id,
                primary_ledger_event_id, secondary_ledger_event_id,
                occurred_on, description, notes, created_at
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18
             )",
            params![
                payload.operation_id,
                local_vault_id,
                payload.holding_id,
                payload.draft_id,
                payload.operation_kind,
                payload.amount_minor,
                payload.currency,
                payload.units_delta_micros,
                payload.before_valuation_id,
                payload.after_valuation_id,
                payload.settlement_account_id,
                payload.ledger_link_id,
                payload.primary_ledger_event_id,
                payload.secondary_ledger_event_id,
                payload.occurred_on,
                payload.description,
                payload.notes,
                payload.created_at,
            ],
        )
        .map_err(|_| "Unable to append an encrypted remote holding operation.".to_owned())?;
    append_incoming_audit(
        transaction,
        local_vault_id,
        verified,
        "holding_operation",
        &payload.operation_id,
    )?;
    inbox_state(
        transaction,
        &verified.envelope.event_id,
        "applied",
        Some(&payload.operation_id),
        None,
    )?;
    Ok(ApplyOutcome::Applied)
}

fn current_holding_operation_correction(
    transaction: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    payload: &HoldingOperationCorrectionSyncPayload,
) -> Result<Option<HoldingOperationCorrectionSyncPayload>, String> {
    transaction
        .query_row(
            "SELECT correction.id, correction.draft_id, draft.source_type,
                    correction.original_operation_id,
                    correction.compensating_operation_id,
                    correction.reason, correction.created_at
             FROM holding_operation_corrections correction
             JOIN draft_changes draft
               ON draft.id = correction.draft_id
              AND draft.vault_id = correction.vault_id
             WHERE correction.vault_id = ?1
               AND (
                 correction.id = ?2 OR correction.draft_id = ?3
                 OR correction.original_operation_id = ?4
                 OR correction.compensating_operation_id = ?5
               )
             LIMIT 1",
            params![
                local_vault_id,
                payload.correction_id,
                payload.draft_id,
                payload.original_operation_id,
                payload.compensating_operation_id
            ],
            |row| {
                Ok(HoldingOperationCorrectionSyncPayload {
                    schema_version: 1,
                    correction_id: row.get(0)?,
                    draft_id: row.get(1)?,
                    draft_source_type: row.get(2)?,
                    original_operation_id: row.get(3)?,
                    compensating_operation_id: row.get(4)?,
                    reason: row.get(5)?,
                    created_at: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(|_| "Unable to inspect synced holding correction idempotency.".to_owned())
}

fn apply_holding_operation_correction(
    transaction: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    verified: &VerifiedIncoming,
) -> Result<ApplyOutcome, String> {
    let payload: HoldingOperationCorrectionSyncPayload =
        serde_json::from_value(verified.payload.clone())
            .map_err(|_| "Encrypted holding operation correction is invalid.".to_owned())?;
    if payload.schema_version != 1
        || payload.correction_id.trim().is_empty()
        || payload.draft_id.trim().is_empty()
        || payload.draft_source_type.trim().is_empty()
        || payload.draft_source_type.chars().count() > 80
        || payload.original_operation_id.trim().is_empty()
        || payload.compensating_operation_id.trim().is_empty()
        || payload.original_operation_id == payload.compensating_operation_id
        || payload.reason.trim().is_empty()
        || payload.reason.trim().chars().count() > 240
        || payload.created_at.trim().is_empty()
    {
        return sync_conflict(
            transaction,
            local_vault_id,
            verified,
            &payload.correction_id,
            "invalid_payload",
        );
    }
    type CorrectionOperation = (String, String, String, i64, String, i64);
    let operation = |operation_id: &str| -> Result<Option<CorrectionOperation>, String> {
        transaction
            .query_row(
                "SELECT holding_id, draft_id, operation_kind, amount_minor,
                        currency, units_delta_micros
                 FROM holding_operations
                 WHERE vault_id = ?1 AND id = ?2",
                params![local_vault_id, operation_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| "Unable to validate synced holding correction operations.".to_owned())
    };
    let Some(original) = operation(&payload.original_operation_id)? else {
        return sync_conflict(
            transaction,
            local_vault_id,
            verified,
            &payload.correction_id,
            "missing_dependency",
        );
    };
    let Some(compensating) = operation(&payload.compensating_operation_id)? else {
        return sync_conflict(
            transaction,
            local_vault_id,
            verified,
            &payload.correction_id,
            "missing_dependency",
        );
    };
    let inverse_kind = match original.2.as_str() {
        "purchase" => "redeem",
        "redeem" => "purchase",
        "dividend" => "fee",
        "fee" => "dividend",
        _ => "",
    };
    if original.0 != compensating.0
        || compensating.1 != payload.draft_id
        || compensating.2 != inverse_kind
        || original.3 != compensating.3
        || original.4 != compensating.4
        || original.5.checked_neg() != Some(compensating.5)
    {
        return sync_conflict(
            transaction,
            local_vault_id,
            verified,
            &payload.correction_id,
            "invalid_payload",
        );
    }
    if let Some(existing) =
        current_holding_operation_correction(transaction, local_vault_id, &payload)?
    {
        if existing == payload {
            inbox_state(
                transaction,
                &verified.envelope.event_id,
                "duplicate",
                Some(&payload.correction_id),
                None,
            )?;
            return Ok(ApplyOutcome::Duplicate);
        }
        return sync_conflict(
            transaction,
            local_vault_id,
            verified,
            &payload.correction_id,
            "idempotency_collision",
        );
    }
    if !ensure_synced_draft(
        transaction,
        local_vault_id,
        &payload.draft_id,
        &payload.draft_source_type,
        &payload.created_at,
        "holding_operation_correction",
    )? {
        return sync_conflict(
            transaction,
            local_vault_id,
            verified,
            &payload.correction_id,
            "idempotency_collision",
        );
    }
    transaction
        .execute(
            "INSERT INTO holding_operation_corrections(
                id, vault_id, draft_id, original_operation_id,
                compensating_operation_id, reason, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                payload.correction_id,
                local_vault_id,
                payload.draft_id,
                payload.original_operation_id,
                payload.compensating_operation_id,
                payload.reason,
                payload.created_at,
            ],
        )
        .map_err(|_| "Unable to append an encrypted remote holding correction.".to_owned())?;
    append_incoming_audit(
        transaction,
        local_vault_id,
        verified,
        "holding_operation_correction",
        &payload.correction_id,
    )?;
    inbox_state(
        transaction,
        &verified.envelope.event_id,
        "applied",
        Some(&payload.correction_id),
        None,
    )?;
    Ok(ApplyOutcome::Applied)
}

fn reminder_occurrence_snapshots(
    connection: &rusqlite::Connection,
    local_vault_id: &str,
    reminder_id: &str,
) -> Result<Vec<ReminderOccurrenceSnapshotPayload>, String> {
    let mut statement = connection
        .prepare(
            "SELECT occurrence.id, occurrence.due_on, occurrence.completed_at,
                    occurrence.next_due_on, occurrence.confirmation_draft_id,
                    occurrence.created_at
             FROM reminder_occurrences occurrence
             JOIN reminders reminder ON reminder.id = occurrence.reminder_id
             WHERE reminder.vault_id = ?1 AND occurrence.reminder_id = ?2
             ORDER BY occurrence.due_on, occurrence.id",
        )
        .map_err(|_| "Unable to inspect recurring reminder history.".to_owned())?;
    let rows = statement
        .query_map(params![local_vault_id, reminder_id], |row| {
            Ok(ReminderOccurrenceSnapshotPayload {
                id: row.get(0)?,
                due_on: row.get(1)?,
                completed_at: row.get(2)?,
                next_due_on: row.get(3)?,
                confirmation_draft_id: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|_| "Unable to read recurring reminder history.".to_owned())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Unable to decode recurring reminder history.".to_owned())
}

fn inferred_recurrence_anchor(
    due_at: &str,
    recurrence_rule: Option<&str>,
) -> Result<(Option<i64>, Option<i64>), String> {
    if recurrence_rule.is_none() {
        return Ok((None, None));
    }
    let due = NaiveDate::parse_from_str(due_at, "%Y-%m-%d")
        .map_err(|_| "Encrypted reminder recurrence date is invalid.".to_owned())?;
    Ok((Some(i64::from(due.month())), Some(i64::from(due.day()))))
}

fn current_reminder_snapshot(
    transaction: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    reminder_id: &str,
) -> Result<Option<ReminderSnapshotPayload>, String> {
    let current = transaction
        .query_row(
            "SELECT id, linked_account_id, category, title, amount_minor, currency,
                    due_at, advance_seconds, recurrence_rule,
                    recurrence_anchor_month, recurrence_anchor_day, status, notes,
                    created_at, updated_at, archived_at
             FROM reminders WHERE vault_id = ?1 AND id = ?2",
            params![local_vault_id, reminder_id],
            |row| {
                Ok(ReminderSnapshotPayload {
                    schema_version: 1,
                    reminder_id: row.get(0)?,
                    linked_account_id: row.get(1)?,
                    category: row.get(2)?,
                    title: row.get(3)?,
                    amount_minor: row.get(4)?,
                    currency: row.get(5)?,
                    due_at: row.get(6)?,
                    advance_seconds: row.get(7)?,
                    recurrence_rule: row.get(8)?,
                    recurrence_anchor_month: row.get(9)?,
                    recurrence_anchor_day: row.get(10)?,
                    status: row.get(11)?,
                    notes: row.get(12)?,
                    created_at: row.get(13)?,
                    updated_at: row.get(14)?,
                    archived_at: row.get(15)?,
                    occurrences: Vec::new(),
                })
            },
        )
        .optional()
        .map_err(|_| "Unable to inspect the local reminder sync state.".to_owned())?;
    let Some(mut current) = current else {
        return Ok(None);
    };
    current.occurrences = reminder_occurrence_snapshots(transaction, local_vault_id, reminder_id)?;
    Ok(Some(current))
}

fn apply_reminder_snapshot(
    transaction: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    verified: &VerifiedIncoming,
) -> Result<ApplyOutcome, String> {
    let mut payload: ReminderSnapshotPayload = serde_json::from_value(verified.payload.clone())
        .map_err(|_| "Encrypted reminder snapshot is invalid.".to_owned())?;
    if payload.recurrence_rule.is_some()
        && (payload.recurrence_anchor_month.is_none() || payload.recurrence_anchor_day.is_none())
    {
        let (month, day) =
            inferred_recurrence_anchor(&payload.due_at, payload.recurrence_rule.as_deref())?;
        payload.recurrence_anchor_month = month;
        payload.recurrence_anchor_day = day;
    }
    if payload.schema_version != 1
        || payload.reminder_id.trim().is_empty()
        || payload.title.trim().is_empty()
        || payload.advance_seconds < 0
        || payload
            .recurrence_anchor_month
            .is_some_and(|month| !(1..=12).contains(&month))
        || payload
            .recurrence_anchor_day
            .is_some_and(|day| !(1..=31).contains(&day))
        || payload.occurrences.iter().any(|occurrence| {
            occurrence.id.trim().is_empty()
                || occurrence.due_on.trim().is_empty()
                || occurrence.completed_at.trim().is_empty()
                || occurrence.confirmation_draft_id.trim().is_empty()
                || occurrence.created_at.trim().is_empty()
        })
    {
        record_inbox_conflict(
            transaction,
            local_vault_id,
            verified,
            Some(&payload.reminder_id),
            "invalid_payload",
        )?;
        return Ok(ApplyOutcome::Conflict);
    }
    if let Some(account_id) = payload.linked_account_id.as_deref() {
        let exists: bool = transaction
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM accounts WHERE vault_id = ?1 AND id = ?2
                 )",
                params![local_vault_id, account_id],
                |row| row.get(0),
            )
            .map_err(|_| "Unable to validate a synced reminder account.".to_owned())?;
        if !exists {
            record_inbox_conflict(
                transaction,
                local_vault_id,
                verified,
                Some(&payload.reminder_id),
                "missing_dependency",
            )?;
            return Ok(ApplyOutcome::Conflict);
        }
    }
    let current = current_reminder_snapshot(transaction, local_vault_id, &payload.reminder_id)?;
    let current_json = current
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(|_| "Unable to compare reminder sync snapshots.".to_owned())?;
    let incoming_json = serde_json::to_value(&payload)
        .map_err(|_| "Unable to compare a reminder sync snapshot.".to_owned())?;
    if current_json.as_ref() == Some(&incoming_json) {
        save_entity_version(transaction, local_vault_id, verified, &payload.reminder_id)?;
        inbox_state(
            transaction,
            &verified.envelope.event_id,
            "duplicate",
            Some(&payload.reminder_id),
            None,
        )?;
        return Ok(ApplyOutcome::Duplicate);
    }
    if let Some((device_id, logical_clock, _)) = entity_version(
        transaction,
        local_vault_id,
        "reminder_snapshot",
        &payload.reminder_id,
    )? {
        if device_id != verified.envelope.device_id {
            record_inbox_conflict(
                transaction,
                local_vault_id,
                verified,
                Some(&payload.reminder_id),
                "concurrent_edit",
            )?;
            return Ok(ApplyOutcome::Conflict);
        }
        if verified.envelope.logical_clock <= logical_clock {
            inbox_state(
                transaction,
                &verified.envelope.event_id,
                "duplicate",
                Some(&payload.reminder_id),
                Some("stale_version"),
            )?;
            return Ok(ApplyOutcome::Duplicate);
        }
    } else if current.is_some() {
        record_inbox_conflict(
            transaction,
            local_vault_id,
            verified,
            Some(&payload.reminder_id),
            "concurrent_edit",
        )?;
        return Ok(ApplyOutcome::Conflict);
    }

    for occurrence in &payload.occurrences {
        let existing: Option<ReminderOccurrenceSnapshotPayload> = transaction
            .query_row(
                "SELECT id, due_on, completed_at, next_due_on,
                        confirmation_draft_id, created_at
                 FROM reminder_occurrences
                 WHERE (reminder_id = ?1 AND due_on = ?2) OR id = ?3
                 LIMIT 1",
                params![payload.reminder_id, occurrence.due_on, occurrence.id],
                |row| {
                    Ok(ReminderOccurrenceSnapshotPayload {
                        id: row.get(0)?,
                        due_on: row.get(1)?,
                        completed_at: row.get(2)?,
                        next_due_on: row.get(3)?,
                        confirmation_draft_id: row.get(4)?,
                        created_at: row.get(5)?,
                    })
                },
            )
            .optional()
            .map_err(|_| "Unable to validate synced reminder history.".to_owned())?;
        if existing.as_ref().is_some_and(|value| value != occurrence) {
            record_inbox_conflict(
                transaction,
                local_vault_id,
                verified,
                Some(&payload.reminder_id),
                "occurrence_history_mismatch",
            )?;
            return Ok(ApplyOutcome::Conflict);
        }
    }

    if current.is_some() {
        transaction
            .execute(
                "UPDATE reminders SET
                    linked_account_id = ?1, category = ?2, title = ?3,
                    amount_minor = ?4, currency = ?5, due_at = ?6,
                    advance_seconds = ?7, recurrence_rule = ?8,
                    recurrence_anchor_month = ?9, recurrence_anchor_day = ?10,
                    status = ?11, notes = ?12, created_at = ?13,
                    updated_at = ?14, archived_at = ?15
                 WHERE vault_id = ?16 AND id = ?17",
                params![
                    payload.linked_account_id,
                    payload.category,
                    payload.title,
                    payload.amount_minor,
                    payload.currency,
                    payload.due_at,
                    payload.advance_seconds,
                    payload.recurrence_rule,
                    payload.recurrence_anchor_month,
                    payload.recurrence_anchor_day,
                    payload.status,
                    payload.notes,
                    payload.created_at,
                    payload.updated_at,
                    payload.archived_at,
                    local_vault_id,
                    payload.reminder_id,
                ],
            )
            .map_err(|_| "Unable to apply the encrypted reminder snapshot.".to_owned())?;
    } else {
        transaction
            .execute(
                "INSERT INTO reminders(
                    id, vault_id, linked_account_id, category, title, amount_minor,
                    currency, due_at, advance_seconds, recurrence_rule,
                    recurrence_anchor_month, recurrence_anchor_day, status,
                    notes, created_at, updated_at, archived_at
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                    ?11, ?12, ?13, ?14, ?15, ?16, ?17
                 )",
                params![
                    payload.reminder_id,
                    local_vault_id,
                    payload.linked_account_id,
                    payload.category,
                    payload.title,
                    payload.amount_minor,
                    payload.currency,
                    payload.due_at,
                    payload.advance_seconds,
                    payload.recurrence_rule,
                    payload.recurrence_anchor_month,
                    payload.recurrence_anchor_day,
                    payload.status,
                    payload.notes,
                    payload.created_at,
                    payload.updated_at,
                    payload.archived_at,
                ],
            )
            .map_err(|_| "Unable to create a reminder from encrypted sync.".to_owned())?;
    }
    for occurrence in &payload.occurrences {
        transaction
            .execute(
                "INSERT OR IGNORE INTO reminder_occurrences(
                    id, reminder_id, due_on, completed_at, next_due_on,
                    confirmation_draft_id, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    occurrence.id,
                    payload.reminder_id,
                    occurrence.due_on,
                    occurrence.completed_at,
                    occurrence.next_due_on,
                    occurrence.confirmation_draft_id,
                    occurrence.created_at,
                ],
            )
            .map_err(|_| "Unable to apply synced reminder history.".to_owned())?;
    }
    save_entity_version(transaction, local_vault_id, verified, &payload.reminder_id)?;
    append_incoming_audit(
        transaction,
        local_vault_id,
        verified,
        "reminder",
        &payload.reminder_id,
    )?;
    inbox_state(
        transaction,
        &verified.envelope.event_id,
        "applied",
        Some(&payload.reminder_id),
        None,
    )?;
    Ok(ApplyOutcome::Applied)
}

fn apply_ledger_event(
    transaction: &rusqlite::Transaction<'_>,
    local_vault_id: &str,
    verified: &VerifiedIncoming,
) -> Result<ApplyOutcome, String> {
    let payload: LocalLedgerPayload = serde_json::from_value(verified.payload.clone())
        .map_err(|_| "Encrypted ledger event is invalid.".to_owned())?;
    if payload.schema_version != 1
        || payload.local_event_id.trim().is_empty()
        || payload.account_id.trim().is_empty()
        || payload.currency.len() != 3
        || !matches!(payload.status.as_str(), "confirmed" | "reconciled")
    {
        record_inbox_conflict(
            transaction,
            local_vault_id,
            verified,
            Some(&payload.local_event_id),
            "invalid_payload",
        )?;
        return Ok(ApplyOutcome::Conflict);
    }
    let account_exists: bool = transaction
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM accounts WHERE vault_id = ?1 AND id = ?2
             )",
            params![local_vault_id, payload.account_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to validate a synced ledger account.".to_owned())?;
    if !account_exists {
        record_inbox_conflict(
            transaction,
            local_vault_id,
            verified,
            Some(&payload.local_event_id),
            "missing_dependency",
        )?;
        return Ok(ApplyOutcome::Conflict);
    }
    let existing: Option<(
        String,
        String,
        i64,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        String,
    )> = transaction
        .query_row(
            "SELECT id, account_id, delta_minor, currency, occurred_at,
                        event_type, link_id, reverses_event_id, metadata_json
                 FROM ledger_events
                 WHERE vault_id = ?1 AND (id = ?2 OR idempotency_key = ?3)
                 LIMIT 1",
            params![
                local_vault_id,
                payload.local_event_id,
                payload.local_idempotency_key
            ],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                ))
            },
        )
        .optional()
        .map_err(|_| "Unable to inspect synced ledger idempotency.".to_owned())?;
    if let Some(existing) = existing {
        let existing_metadata: serde_json::Value =
            serde_json::from_str(&existing.8).unwrap_or(serde_json::Value::Null);
        if existing.0 == payload.local_event_id
            && existing.1 == payload.account_id
            && existing.2 == payload.delta_minor
            && existing.3 == payload.currency
            && existing.4 == payload.occurred_at
            && existing.5 == payload.event_type
            && existing.6 == payload.link_id
            && existing.7 == payload.reverses_event_id
            && existing_metadata == payload.metadata
        {
            inbox_state(
                transaction,
                &verified.envelope.event_id,
                "duplicate",
                Some(&payload.local_event_id),
                None,
            )?;
            return Ok(ApplyOutcome::Duplicate);
        }
        record_inbox_conflict(
            transaction,
            local_vault_id,
            verified,
            Some(&payload.local_event_id),
            "idempotency_collision",
        )?;
        return Ok(ApplyOutcome::Conflict);
    }
    if let Some(reverses_id) = payload.reverses_event_id.as_deref() {
        let exists: bool = transaction
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM ledger_events WHERE vault_id = ?1 AND id = ?2
                 )",
                params![local_vault_id, reverses_id],
                |row| row.get(0),
            )
            .map_err(|_| "Unable to validate a synced ledger reversal.".to_owned())?;
        if !exists {
            record_inbox_conflict(
                transaction,
                local_vault_id,
                verified,
                Some(&payload.local_event_id),
                "missing_dependency",
            )?;
            return Ok(ApplyOutcome::Conflict);
        }
    }
    transaction
        .execute(
            "INSERT INTO ledger_events(
                id, vault_id, account_id, draft_id, import_batch_id, event_type,
                delta_minor, currency, occurred_at, status, idempotency_key,
                link_id, reverses_event_id, metadata_json, created_at
             ) VALUES (
                ?1, ?2, ?3, NULL, NULL, ?4, ?5, ?6, ?7, ?8, ?9,
                ?10, ?11, ?12, ?13
             )",
            params![
                payload.local_event_id,
                local_vault_id,
                payload.account_id,
                payload.event_type,
                payload.delta_minor,
                payload.currency,
                payload.occurred_at,
                payload.status,
                payload.local_idempotency_key,
                payload.link_id,
                payload.reverses_event_id,
                payload.metadata.to_string(),
                payload.local_created_at,
            ],
        )
        .map_err(|_| "Unable to append an encrypted remote ledger event.".to_owned())?;
    append_incoming_audit(
        transaction,
        local_vault_id,
        verified,
        "ledger_event",
        &payload.local_event_id,
    )?;
    inbox_state(
        transaction,
        &verified.envelope.event_id,
        "applied",
        Some(&payload.local_event_id),
        None,
    )?;
    Ok(ApplyOutcome::Applied)
}

fn apply_incoming_at(
    connection: &mut rusqlite::Connection,
    local_vault_id: &str,
    request: ApplyIncomingRequest,
) -> Result<ApplyIncomingResponse, String> {
    if request.events.len() > MAX_OUTBOX_BATCH {
        return Err("Encrypted sync inbox batch cannot exceed 250 events.".to_owned());
    }
    if request.cursor_received_at.is_some() != request.cursor_event_id.is_some() {
        return Err("Encrypted sync cursor is incomplete.".to_owned());
    }
    if let Some(event_id) = request.cursor_event_id.as_deref() {
        validate_uuid(event_id, "cursorEventId")?;
    }
    let (cloud_vault_id, sync_key, enabled): (String, Vec<u8>, bool) = connection
        .query_row(
            "SELECT cloud_vault_id, sync_key, enabled
             FROM sync_config WHERE local_vault_id = ?1",
            [local_vault_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get::<_, i64>(2)? == 1)),
        )
        .optional()
        .map_err(|_| "Unable to read encrypted sync inbox configuration.".to_owned())?
        .ok_or_else(|| "Encrypted sync has not been configured.".to_owned())?;
    if !enabled || sync_key.len() != KEY_LENGTH {
        return Err("Encrypted sync is disabled or unavailable.".to_owned());
    }
    let mut key = Zeroizing::new([0_u8; KEY_LENGTH]);
    key.copy_from_slice(&sync_key);
    let mut verified = request
        .events
        .into_iter()
        .map(|event| verify_incoming(event, &cloud_vault_id, &key))
        .collect::<Result<Vec<_>, _>>()?;
    verified.sort_by(|left, right| {
        let priority = |kind: &str| match kind {
            "account_snapshot" => 0_u8,
            "holding_snapshot" => 1,
            "holding_valuation" => 2,
            "ledger_event" => 3,
            "holding_operation" => 4,
            "holding_operation_correction" => 5,
            "reminder_snapshot" => 6,
            _ => 7,
        };
        priority(&left.envelope.event_kind)
            .cmp(&priority(&right.envelope.event_kind))
            .then_with(|| left.envelope.device_id.cmp(&right.envelope.device_id))
            .then_with(|| {
                left.envelope
                    .logical_clock
                    .cmp(&right.envelope.logical_clock)
            })
            .then_with(|| left.envelope.received_at.cmp(&right.envelope.received_at))
            .then_with(|| left.envelope.event_id.cmp(&right.envelope.event_id))
    });
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "Unable to start encrypted inbox application.".to_owned())?;
    let mut new_events = Vec::new();
    let mut duplicate_count = 0_usize;
    for event in verified {
        let existing: Option<Vec<u8>> = transaction
            .query_row(
                "SELECT event_hash FROM sync_inbox_events WHERE cloud_event_id = ?1",
                [&event.envelope.event_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| "Unable to inspect encrypted inbox idempotency.".to_owned())?;
        if let Some(existing_hash) = existing {
            if existing_hash != event.event_hash {
                return Err("Encrypted sync event identifier collision detected.".to_owned());
            }
            duplicate_count += 1;
            continue;
        }
        transaction
            .execute(
                "INSERT INTO sync_inbox_events(
                    cloud_event_id, local_vault_id, event_kind, device_id,
                    logical_clock, idempotency_key, event_hash, previous_event_hash,
                    payload_nonce, payload_ciphertext, aad_version, occurred_at,
                    received_at, recorded_at
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 2, ?11, ?12,
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![
                    event.envelope.event_id,
                    local_vault_id,
                    event.envelope.event_kind,
                    event.envelope.device_id,
                    event.envelope.logical_clock,
                    event.envelope.idempotency_key,
                    event.event_hash,
                    event.previous_event_hash,
                    event.nonce,
                    event.ciphertext,
                    event.envelope.occurred_at,
                    event.envelope.received_at,
                ],
            )
            .map_err(|_| "Unable to append an immutable encrypted inbox event.".to_owned())?;
        inbox_state(
            &transaction,
            &event.envelope.event_id,
            "pending",
            None,
            None,
        )?;
        new_events.push(event);
    }
    let mut applied_count = 0_usize;
    let mut conflict_count = 0_usize;
    for event in &new_events {
        if !inbox_hash_chain_is_valid(&transaction, local_vault_id, event)? {
            record_inbox_conflict(&transaction, local_vault_id, event, None, "hash_gap")?;
            conflict_count += 1;
            continue;
        }
        let outcome = match event.envelope.event_kind.as_str() {
            "account_snapshot" => apply_account_snapshot(&transaction, local_vault_id, event)?,
            "holding_snapshot" => apply_holding_snapshot(&transaction, local_vault_id, event)?,
            "holding_valuation" => apply_holding_valuation(&transaction, local_vault_id, event)?,
            "ledger_event" => apply_ledger_event(&transaction, local_vault_id, event)?,
            "holding_operation" => apply_holding_operation(&transaction, local_vault_id, event)?,
            "holding_operation_correction" => {
                apply_holding_operation_correction(&transaction, local_vault_id, event)?
            }
            "reminder_snapshot" => apply_reminder_snapshot(&transaction, local_vault_id, event)?,
            _ => unreachable!(),
        };
        match outcome {
            ApplyOutcome::Applied => applied_count += 1,
            ApplyOutcome::Duplicate => duplicate_count += 1,
            ApplyOutcome::Conflict => conflict_count += 1,
        }
    }
    if let (Some(received_at), Some(event_id)) =
        (request.cursor_received_at, request.cursor_event_id)
    {
        transaction
            .execute(
                "UPDATE sync_config
                 SET last_inbound_received_at = ?1, last_inbound_event_id = ?2
                 WHERE local_vault_id = ?3",
                params![received_at, event_id, local_vault_id],
            )
            .map_err(|_| "Unable to advance the encrypted sync cursor.".to_owned())?;
    }
    transaction
        .commit()
        .map_err(|_| "Unable to commit encrypted inbox application.".to_owned())?;
    Ok(ApplyIncomingResponse {
        applied_count,
        duplicate_count,
        conflict_count,
        status: sync_status_at(connection, local_vault_id)?,
    })
}

fn conflict_details(details_json: &str) -> (Option<String>, Option<i64>) {
    let details: serde_json::Value = serde_json::from_str(details_json).unwrap_or_default();
    (
        details
            .get("remoteDeviceId")
            .and_then(serde_json::Value::as_str)
            .map(ToOwned::to_owned),
        details
            .get("logicalClock")
            .and_then(serde_json::Value::as_i64),
    )
}

fn list_sync_conflicts_at(
    connection: &rusqlite::Connection,
    local_vault_id: &str,
    include_resolved: bool,
) -> Result<Vec<SyncConflictSummary>, String> {
    let mut statement = connection
        .prepare(
            "SELECT conflict.id, conflict.cloud_event_id, conflict.event_kind,
                    conflict.source_id, conflict.reason_code, conflict.details_json,
                    conflict.occurred_at, resolution.resolution_action,
                    resolution.resolved_at
             FROM sync_inbox_conflicts conflict
             LEFT JOIN sync_inbox_conflict_resolutions resolution
               ON resolution.local_vault_id = conflict.local_vault_id
              AND resolution.conflict_id = conflict.id
             WHERE conflict.local_vault_id = ?1
               AND (?2 = 1 OR resolution.id IS NULL)
             ORDER BY conflict.occurred_at DESC, conflict.id DESC",
        )
        .map_err(|_| "Unable to prepare encrypted sync conflict review.".to_owned())?;
    let incoming = statement
        .query_map(
            params![local_vault_id, i64::from(include_resolved)],
            |row| {
                let details_json: String = row.get(5)?;
                let (remote_device_id, logical_clock) = conflict_details(&details_json);
                let resolution_action: Option<String> = row.get(7)?;
                Ok(SyncConflictSummary {
                    id: row.get(0)?,
                    direction: "incoming".to_owned(),
                    cloud_event_id: row.get(1)?,
                    event_kind: row.get(2)?,
                    source_id: row.get(3)?,
                    reason_code: row.get(4)?,
                    remote_device_id,
                    logical_clock,
                    occurred_at: row.get(6)?,
                    resolved_at: row.get(8)?,
                    can_inspect: true,
                    can_keep_local: resolution_action.is_none(),
                    resolution_action,
                })
            },
        )
        .map_err(|_| "Unable to read encrypted sync conflicts.".to_owned())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Unable to decode encrypted sync conflict metadata.".to_owned())?;

    let mut conflicts = incoming;
    let mut outgoing_statement = connection
        .prepare(
            "SELECT event.cloud_event_id, event.event_kind, event.source_id,
                    coalesce(state.last_error_code, 'needs_reconciliation'),
                    state.updated_at
             FROM sync_delivery_state state
             JOIN sync_outbox_events event
               ON event.cloud_event_id = state.cloud_event_id
             WHERE event.local_vault_id = ?1
               AND state.status = 'needs_reconciliation'
             ORDER BY state.updated_at DESC, event.cloud_event_id DESC",
        )
        .map_err(|_| "Unable to prepare outgoing sync reconciliation review.".to_owned())?;
    let outgoing = outgoing_statement
        .query_map([local_vault_id], |row| {
            let event_id: String = row.get(0)?;
            Ok(SyncConflictSummary {
                id: event_id.clone(),
                direction: "outgoing".to_owned(),
                cloud_event_id: event_id,
                event_kind: row.get(1)?,
                source_id: row.get(2)?,
                reason_code: row.get(3)?,
                remote_device_id: None,
                logical_clock: None,
                occurred_at: row.get(4)?,
                resolution_action: None,
                resolved_at: None,
                can_inspect: false,
                can_keep_local: false,
            })
        })
        .map_err(|_| "Unable to read outgoing sync reconciliation state.".to_owned())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Unable to decode outgoing sync reconciliation metadata.".to_owned())?;
    conflicts.extend(outgoing);
    conflicts.sort_by(|left, right| {
        right
            .occurred_at
            .cmp(&left.occurred_at)
            .then_with(|| right.id.cmp(&left.id))
    });
    Ok(conflicts)
}

fn inspect_sync_conflict_at(
    connection: &rusqlite::Connection,
    local_vault_id: &str,
    request: InspectSyncConflictRequest,
) -> Result<SyncConflictInspection, String> {
    let conflict_id = validate_conflict_id(&request.conflict_id)?;
    let (cloud_vault_id, sync_key): (String, Vec<u8>) = connection
        .query_row(
            "SELECT cloud_vault_id, sync_key
             FROM sync_config WHERE local_vault_id = ?1",
            [local_vault_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|_| "Unable to read encrypted sync review configuration.".to_owned())?
        .ok_or_else(|| "Encrypted sync has not been configured.".to_owned())?;
    if sync_key.len() != KEY_LENGTH {
        return Err("Encrypted sync review key is unavailable.".to_owned());
    }
    let stored: Option<(
        String,
        String,
        Option<String>,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        String,
        String,
        i64,
        String,
        Vec<u8>,
        Option<Vec<u8>>,
        Vec<u8>,
        Vec<u8>,
        i64,
        String,
        String,
    )> = connection
        .query_row(
            "SELECT conflict.cloud_event_id, conflict.event_kind, conflict.source_id,
                    conflict.reason_code, conflict.details_json, conflict.occurred_at,
                    resolution.resolution_action, resolution.resolved_at,
                    event.device_id, event.idempotency_key, event.logical_clock,
                    event.cloud_event_id, event.event_hash, event.previous_event_hash,
                    event.payload_nonce, event.payload_ciphertext, event.aad_version,
                    event.occurred_at, event.received_at
             FROM sync_inbox_conflicts conflict
             JOIN sync_inbox_events event
               ON event.cloud_event_id = conflict.cloud_event_id
              AND event.local_vault_id = conflict.local_vault_id
             LEFT JOIN sync_inbox_conflict_resolutions resolution
               ON resolution.local_vault_id = conflict.local_vault_id
              AND resolution.conflict_id = conflict.id
             WHERE conflict.local_vault_id = ?1 AND conflict.id = ?2",
            params![local_vault_id, conflict_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                    row.get(9)?,
                    row.get(10)?,
                    row.get(11)?,
                    row.get(12)?,
                    row.get(13)?,
                    row.get(14)?,
                    row.get(15)?,
                    row.get(16)?,
                    row.get(17)?,
                    row.get(18)?,
                ))
            },
        )
        .optional()
        .map_err(|_| "Unable to read the encrypted sync conflict.".to_owned())?;
    let Some(stored) = stored else {
        return Err("Encrypted sync conflict does not exist.".to_owned());
    };
    let (remote_device_id, logical_clock) = conflict_details(&stored.4);
    let envelope = SyncIncomingEnvelope {
        event_id: stored.11,
        vault_id: cloud_vault_id.clone(),
        device_id: stored.8,
        event_kind: stored.1.clone(),
        logical_clock: stored.10,
        idempotency_key: stored.9,
        event_hash: postgres_bytea(&stored.12),
        previous_event_hash: stored.13.as_deref().map(postgres_bytea),
        payload_nonce: postgres_bytea(&stored.14),
        payload_ciphertext: postgres_bytea(&stored.15),
        aad_version: stored.16,
        occurred_at: stored.17,
        received_at: stored.18,
    };
    let mut key = Zeroizing::new([0_u8; KEY_LENGTH]);
    key.copy_from_slice(&sync_key);
    let verified = verify_incoming(envelope, &cloud_vault_id, &key)?;
    Ok(SyncConflictInspection {
        conflict: SyncConflictSummary {
            id: conflict_id,
            direction: "incoming".to_owned(),
            cloud_event_id: stored.0,
            event_kind: stored.1,
            source_id: stored.2,
            reason_code: stored.3,
            remote_device_id,
            logical_clock,
            occurred_at: stored.5,
            can_inspect: true,
            can_keep_local: stored.6.is_none(),
            resolution_action: stored.6,
            resolved_at: stored.7,
        },
        incoming_payload: verified.payload,
    })
}

fn resolve_sync_conflict_keep_local_at(
    connection: &mut rusqlite::Connection,
    local_vault_id: &str,
    request: ResolveSyncConflictRequest,
) -> Result<ResolveSyncConflictResponse, String> {
    if !request.confirmed_by_user {
        return Err(
            "Resolving an encrypted sync conflict requires explicit confirmation.".to_owned(),
        );
    }
    let conflict_id = validate_conflict_id(&request.conflict_id)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "Unable to start encrypted sync conflict resolution.".to_owned())?;
    let conflict: Option<(String, String, String, Option<String>)> = transaction
        .query_row(
            "SELECT cloud_event_id, event_kind, reason_code, source_id
             FROM sync_inbox_conflicts
             WHERE local_vault_id = ?1 AND id = ?2",
            params![local_vault_id, conflict_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(|_| "Unable to inspect encrypted sync conflict resolution.".to_owned())?;
    let Some(conflict) = conflict else {
        return Err("Encrypted sync conflict does not exist.".to_owned());
    };
    let existing: Option<(String, String)> = transaction
        .query_row(
            "SELECT id, resolved_at
             FROM sync_inbox_conflict_resolutions
             WHERE local_vault_id = ?1 AND conflict_id = ?2",
            params![local_vault_id, conflict_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|_| "Unable to inspect existing sync conflict resolution.".to_owned())?;
    let (resolution_id, resolved_at) = if let Some(existing) = existing {
        existing
    } else {
        let resolution_id = random_id("sync_resolution")?;
        transaction
            .execute(
                "INSERT INTO sync_inbox_conflict_resolutions(
                    id, local_vault_id, conflict_id, resolution_action,
                    confirmed_by, resolved_at
                 ) VALUES (
                    ?1, ?2, ?3, 'keep_local', 'local_user',
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![resolution_id, local_vault_id, conflict_id],
            )
            .map_err(|_| "Unable to append encrypted sync conflict resolution.".to_owned())?;
        inbox_state(
            &transaction,
            &conflict.0,
            "rejected",
            conflict.3.as_deref(),
            Some("kept_local_by_user"),
        )?;
        transaction
            .execute(
                "INSERT INTO audit_events(
                    id, vault_id, category, action, actor_id, object_type,
                    object_id, metadata_json, occurred_at
                 ) VALUES (
                    ?1, ?2, 'sync', 'conflict_resolved', 'local_user',
                    'sync_conflict', ?3, ?4,
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![
                    random_id("audit")?,
                    local_vault_id,
                    conflict_id,
                    json!({
                        "resolutionAction": "keep_local",
                        "cloudEventId": conflict.0,
                        "eventKind": conflict.1,
                        "reasonCode": conflict.2
                    })
                    .to_string()
                ],
            )
            .map_err(|_| "Unable to audit encrypted sync conflict resolution.".to_owned())?;
        let resolved_at: String = transaction
            .query_row(
                "SELECT resolved_at FROM sync_inbox_conflict_resolutions
                 WHERE id = ?1",
                [&resolution_id],
                |row| row.get(0),
            )
            .map_err(|_| "Unable to read encrypted sync conflict resolution time.".to_owned())?;
        (resolution_id, resolved_at)
    };
    transaction
        .commit()
        .map_err(|_| "Unable to commit encrypted sync conflict resolution.".to_owned())?;
    Ok(ResolveSyncConflictResponse {
        resolution_id,
        conflict_id,
        resolution_action: "keep_local".to_owned(),
        resolved_at,
        status: sync_status_at(connection, local_vault_id)?,
    })
}

fn disable_sync_at(
    connection: &mut rusqlite::Connection,
    local_vault_id: &str,
    confirmed_by_user: bool,
) -> Result<SyncStatusResponse, String> {
    if !confirmed_by_user {
        return Err("Disabling cloud sync requires explicit confirmation.".to_owned());
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "Unable to start encrypted sync disable.".to_owned())?;
    transaction
        .execute(
            "UPDATE sync_config
             SET enabled = 0, disabled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE local_vault_id = ?1",
            [local_vault_id],
        )
        .map_err(|_| "Unable to disable encrypted sync.".to_owned())?;
    transaction
        .execute(
            "INSERT INTO audit_events(
                id, vault_id, category, action, actor_id, object_type,
                object_id, metadata_json, occurred_at
             ) VALUES (
                ?1, ?2, 'sync', 'disabled', 'local-user', 'vault', ?2, '{}',
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![random_id("audit")?, local_vault_id],
        )
        .map_err(|_| "Unable to audit encrypted sync disable.".to_owned())?;
    transaction
        .commit()
        .map_err(|_| "Unable to commit encrypted sync disable.".to_owned())?;
    sync_status_at(connection, local_vault_id)
}

#[tauri::command]
pub async fn sync_enable(
    runtime: tauri::State<'_, VaultRuntime>,
    request: EnableSyncRequest,
) -> Result<SyncBootstrapResponse, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        runtime.with_unlocked_connection(|vault_id, connection| {
            enable_sync_at(connection, vault_id, request)
        })
    })
    .await
    .map_err(|_| "Encrypted sync setup task failed.".to_owned())?
}

#[tauri::command]
pub async fn sync_status(
    runtime: tauri::State<'_, VaultRuntime>,
) -> Result<SyncStatusResponse, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        runtime
            .with_unlocked_connection(|vault_id, connection| sync_status_at(connection, vault_id))
    })
    .await
    .map_err(|_| "Encrypted sync status task failed.".to_owned())?
}

#[tauri::command]
pub async fn sync_prepare_outbox(
    runtime: tauri::State<'_, VaultRuntime>,
    request: PrepareOutboxRequest,
) -> Result<SyncStatusResponse, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        runtime.with_unlocked_connection(|vault_id, connection| {
            prepare_outbox_at(connection, vault_id, request)
        })
    })
    .await
    .map_err(|_| "Encrypted outbox preparation task failed.".to_owned())?
}

#[tauri::command]
pub async fn sync_outbox_list(
    runtime: tauri::State<'_, VaultRuntime>,
) -> Result<Vec<SyncOutboxEnvelope>, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        runtime
            .with_unlocked_connection(|vault_id, connection| list_outbox_at(connection, vault_id))
    })
    .await
    .map_err(|_| "Encrypted outbox read task failed.".to_owned())?
}

#[tauri::command]
pub async fn sync_record_delivery(
    runtime: tauri::State<'_, VaultRuntime>,
    request: RecordDeliveryRequest,
) -> Result<SyncStatusResponse, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        runtime.with_unlocked_connection(|vault_id, connection| {
            record_delivery_at(connection, vault_id, request)
        })
    })
    .await
    .map_err(|_| "Encrypted delivery recording task failed.".to_owned())?
}

#[tauri::command]
pub async fn sync_apply_incoming(
    runtime: tauri::State<'_, VaultRuntime>,
    request: ApplyIncomingRequest,
) -> Result<ApplyIncomingResponse, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        runtime.with_unlocked_connection(|vault_id, connection| {
            apply_incoming_at(connection, vault_id, request)
        })
    })
    .await
    .map_err(|_| "Encrypted inbox application task failed.".to_owned())?
}

#[tauri::command]
pub async fn sync_conflicts_list(
    runtime: tauri::State<'_, VaultRuntime>,
    request: ListSyncConflictsRequest,
) -> Result<Vec<SyncConflictSummary>, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        runtime.with_unlocked_connection(|vault_id, connection| {
            list_sync_conflicts_at(
                connection,
                vault_id,
                request.include_resolved.unwrap_or(false),
            )
        })
    })
    .await
    .map_err(|_| "Encrypted sync conflict listing task failed.".to_owned())?
}

#[tauri::command]
pub async fn sync_conflict_inspect(
    runtime: tauri::State<'_, VaultRuntime>,
    request: InspectSyncConflictRequest,
) -> Result<SyncConflictInspection, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        runtime.with_unlocked_connection(|vault_id, connection| {
            inspect_sync_conflict_at(connection, vault_id, request)
        })
    })
    .await
    .map_err(|_| "Encrypted sync conflict inspection task failed.".to_owned())?
}

#[tauri::command]
pub async fn sync_conflict_keep_local(
    runtime: tauri::State<'_, VaultRuntime>,
    request: ResolveSyncConflictRequest,
) -> Result<ResolveSyncConflictResponse, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        runtime.with_unlocked_connection(|vault_id, connection| {
            resolve_sync_conflict_keep_local_at(connection, vault_id, request)
        })
    })
    .await
    .map_err(|_| "Encrypted sync conflict resolution task failed.".to_owned())?
}

#[tauri::command]
pub async fn sync_disable(
    runtime: tauri::State<'_, VaultRuntime>,
    confirmed_by_user: bool,
) -> Result<SyncStatusResponse, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        runtime.with_unlocked_connection(|vault_id, connection| {
            disable_sync_at(connection, vault_id, confirmed_by_user)
        })
    })
    .await
    .map_err(|_| "Encrypted sync disable task failed.".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn fixture_connection() -> Connection {
        let connection = Connection::open_in_memory().expect("memory database should open");
        connection
            .execute_batch(include_str!("../../db/schema.sql"))
            .expect("schema should apply");
        connection
            .execute_batch(
                "
                INSERT INTO vaults(id, display_name, base_currency, created_at)
                VALUES ('vault-1', '测试私人保险库', 'CNY', '2026-07-26T00:00:00.000Z');
                INSERT INTO accounts(
                  id, vault_id, institution_name, display_name, account_type,
                  currency, created_at
                ) VALUES (
                  'account-1', 'vault-1', '测试银行', '工资账户', 'cash',
                  'CNY', '2026-07-26T00:00:00.000Z'
                );
                INSERT INTO ledger_events(
                  id, vault_id, account_id, event_type, delta_minor, currency,
                  occurred_at, status, idempotency_key, metadata_json, created_at
                ) VALUES (
                  'ledger-event-1', 'vault-1', 'account-1', 'opening_balance',
                  12850032, 'CNY', '2026-07-26T01:00:00.000Z', 'confirmed',
                  'manual-account:test-fixture-1',
                  '{\"note\":\"仅本机可见\"}', '2026-07-26T01:00:00.000Z'
                );
                ",
            )
            .expect("fixture should insert");
        connection
    }

    fn empty_fixture_connection() -> Connection {
        let connection = Connection::open_in_memory().expect("memory database should open");
        connection
            .execute_batch(include_str!("../../db/schema.sql"))
            .expect("schema should apply");
        connection
            .execute(
                "INSERT INTO vaults(id, display_name, base_currency, created_at)
                 VALUES ('vault-1', '接收端私人保险库', 'CNY', '2026-07-26T00:00:00.000Z')",
                [],
            )
            .expect("vault fixture should insert");
        connection
    }

    fn incoming(envelope: SyncOutboxEnvelope, received_at: &str) -> SyncIncomingEnvelope {
        SyncIncomingEnvelope {
            event_id: envelope.event_id,
            vault_id: envelope.vault_id,
            device_id: envelope.device_id,
            event_kind: envelope.event_kind,
            logical_clock: envelope.logical_clock,
            idempotency_key: envelope.idempotency_key,
            event_hash: envelope.event_hash,
            previous_event_hash: envelope.previous_event_hash,
            payload_nonce: envelope.payload_nonce,
            payload_ciphertext: envelope.payload_ciphertext,
            aad_version: envelope.aad_version,
            occurred_at: envelope.occurred_at,
            received_at: received_at.to_owned(),
        }
    }

    #[test]
    fn native_bootstrap_never_returns_private_or_symmetric_keys() {
        let mut connection = fixture_connection();
        let response = enable_sync_at(
            &mut connection,
            "vault-1",
            EnableSyncRequest {
                cloud_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".to_owned(),
                platform: "macos".to_owned(),
                confirmed_by_user: true,
            },
        )
        .expect("sync should enable");
        let serialized = serde_json::to_string(&response).expect("response should serialize");
        assert!(response.enabled);
        assert!(serialized.contains("devicePublicKey"));
        assert!(!serialized.contains("devicePrivateKey"));
        assert!(!serialized.contains("syncKey"));
        let stored_key_length: i64 = connection
            .query_row("SELECT length(sync_key) FROM sync_config", [], |row| {
                row.get(0)
            })
            .expect("sync key should be stored inside SQLCipher");
        assert_eq!(stored_key_length, 32);
    }

    #[test]
    fn local_domain_state_becomes_immutable_encrypted_outbox_envelopes() {
        let mut connection = fixture_connection();
        enable_sync_at(
            &mut connection,
            "vault-1",
            EnableSyncRequest {
                cloud_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".to_owned(),
                platform: "macos".to_owned(),
                confirmed_by_user: true,
            },
        )
        .expect("sync should enable");
        let status = prepare_outbox_at(
            &mut connection,
            "vault-1",
            PrepareOutboxRequest { limit: Some(10) },
        )
        .expect("outbox should prepare");
        assert_eq!(status.pending_count, 2);
        assert_eq!(status.last_logical_clock, 2);
        let envelopes = list_outbox_at(&connection, "vault-1").expect("outbox should list");
        assert_eq!(envelopes.len(), 2);
        assert_eq!(envelopes[0].event_kind, "account_snapshot");
        assert_eq!(envelopes[1].event_kind, "ledger_event");
        let serialized = serde_json::to_string(&envelopes).expect("outbox should serialize");
        assert!(!serialized.contains("测试银行"));
        assert!(!serialized.contains("工资账户"));
        assert!(!serialized.contains("12850032"));
        assert!(!serialized.contains("仅本机可见"));
        assert!(connection
            .execute(
                "UPDATE sync_outbox_events SET logical_clock = 2
                 WHERE source_id = 'ledger-event-1'",
                [],
            )
            .is_err());

        let second = prepare_outbox_at(
            &mut connection,
            "vault-1",
            PrepareOutboxRequest { limit: Some(10) },
        )
        .expect("repeat preparation should be idempotent");
        assert_eq!(second.pending_count, 2);
        assert_eq!(second.last_logical_clock, 2);
    }

    #[test]
    fn disabling_sync_preserves_local_ledger_and_pending_ciphertext() {
        let mut connection = fixture_connection();
        enable_sync_at(
            &mut connection,
            "vault-1",
            EnableSyncRequest {
                cloud_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".to_owned(),
                platform: "macos".to_owned(),
                confirmed_by_user: true,
            },
        )
        .expect("sync should enable");
        prepare_outbox_at(
            &mut connection,
            "vault-1",
            PrepareOutboxRequest { limit: None },
        )
        .expect("outbox should prepare");
        let status =
            disable_sync_at(&mut connection, "vault-1", true).expect("sync should disable");
        assert!(!status.enabled);
        let ledger_count: i64 = connection
            .query_row("SELECT count(*) FROM ledger_events", [], |row| row.get(0))
            .expect("ledger should remain");
        let outbox_count: i64 = connection
            .query_row("SELECT count(*) FROM sync_outbox_events", [], |row| {
                row.get(0)
            })
            .expect("encrypted outbox should remain for audit");
        assert_eq!(ledger_count, 1);
        assert_eq!(outbox_count, 2);
        assert!(prepare_outbox_at(
            &mut connection,
            "vault-1",
            PrepareOutboxRequest { limit: None }
        )
        .is_err());
    }

    #[test]
    fn verified_domain_events_rebuild_a_second_encrypted_vault_idempotently() {
        let mut source = fixture_connection();
        source
            .execute_batch(
                "INSERT INTO draft_changes(
                    id, vault_id, source_type, source_fingerprint, status,
                    proposed_events_json, evidence_json, created_at,
                    confirmed_at, confirmed_by
                 ) VALUES
                 (
                    'draft-holding', 'vault-1', 'manual_holding', 'draft-holding',
                    'confirmed', '{}', '[{\"source\":\"manual_holding\"}]',
                    '2026-07-26T02:00:00.000Z', '2026-07-26T02:00:00.000Z',
                    'local-user'
                 ),
                 (
                    'draft-operation-original', 'vault-1',
                    'manual_holding_operation', 'draft-operation-original',
                    'confirmed', '{}', '[{\"source\":\"manual_holding_operation\"}]',
                    '2026-07-26T03:00:00.000Z', '2026-07-26T03:00:00.000Z',
                    'local-user'
                 ),
                 (
                    'draft-operation-correction', 'vault-1',
                    'manual_holding_operation_correction',
                    'draft-operation-correction', 'confirmed', '{}',
                    '[{\"source\":\"manual_holding_operation_correction\"}]',
                    '2026-07-26T04:00:00.000Z', '2026-07-26T04:00:00.000Z',
                    'local-user'
                 );
                 INSERT INTO holdings(
                    id, vault_id, account_id, name, product_type, currency,
                    masked_identifier, notes, created_at
                 ) VALUES (
                    'holding-1', 'vault-1', 'account-1', '稳健基金',
                    'fund', 'CNY', 'FUND-01', '真实持仓仅在密文中同步',
                    '2026-07-26T02:00:00.000Z'
                 );
                 INSERT INTO holding_valuations(
                    id, vault_id, holding_id, draft_id, units_micros,
                    cost_basis_minor, market_value_minor, as_of_date,
                    source_type, created_at
                 ) VALUES (
                    'valuation-1', 'vault-1', 'holding-1', 'draft-holding',
                    125000000, 1000000, 1088000, '2026-07-26',
                    'manual', '2026-07-26T02:00:00.000Z'
                 );
                 INSERT INTO ledger_events(
                    id, vault_id, account_id, event_type, delta_minor, currency,
                    occurred_at, status, idempotency_key, metadata_json, created_at
                 ) VALUES (
                    'ledger-dividend-1', 'vault-1', 'account-1', 'income',
                    88000, 'CNY', '2026-07-26T03:00:00.000Z', 'confirmed',
                    'holding-operation:dividend-fixture-1',
                    '{\"holdingId\":\"holding-1\"}', '2026-07-26T03:00:00.000Z'
                 );
                 INSERT INTO ledger_events(
                    id, vault_id, account_id, event_type, delta_minor, currency,
                    occurred_at, status, idempotency_key, reverses_event_id,
                    metadata_json, created_at
                 ) VALUES (
                    'ledger-fee-reversal-1', 'vault-1', 'account-1', 'reversal',
                    -88000, 'CNY', '2026-07-26T04:00:00.000Z', 'confirmed',
                    'holding-operation:fee-reversal-fixture-1',
                    'ledger-dividend-1', '{\"holdingId\":\"holding-1\"}',
                    '2026-07-26T04:00:00.000Z'
                 );
                 INSERT INTO holding_operations(
                    id, vault_id, holding_id, draft_id, operation_kind,
                    amount_minor, currency, units_delta_micros,
                    before_valuation_id, settlement_account_id,
                    primary_ledger_event_id, occurred_on, description, notes,
                    created_at
                 ) VALUES (
                    'holding-operation-original', 'vault-1', 'holding-1',
                    'draft-operation-original', 'dividend', 88000, 'CNY', 0,
                    'valuation-1', 'account-1', 'ledger-dividend-1',
                    '2026-07-26', '基金分红', '随后通过补偿操作更正',
                    '2026-07-26T03:00:00.000Z'
                 );
                 INSERT INTO holding_operations(
                    id, vault_id, holding_id, draft_id, operation_kind,
                    amount_minor, currency, units_delta_micros,
                    before_valuation_id, settlement_account_id,
                    primary_ledger_event_id, occurred_on, description, notes,
                    created_at
                 ) VALUES (
                    'holding-operation-compensating', 'vault-1', 'holding-1',
                    'draft-operation-correction', 'fee', 88000, 'CNY', 0,
                    'valuation-1', 'account-1', 'ledger-fee-reversal-1',
                    '2026-07-26', '冲销：基金分红', '录入有误',
                    '2026-07-26T04:00:00.000Z'
                 );
                 INSERT INTO holding_operation_corrections(
                    id, vault_id, draft_id, original_operation_id,
                    compensating_operation_id, reason, created_at
                 ) VALUES (
                    'holding-correction-1', 'vault-1',
                    'draft-operation-correction', 'holding-operation-original',
                    'holding-operation-compensating', '录入有误',
                    '2026-07-26T04:00:00.000Z'
                 );
                 INSERT INTO reminders(
                    id, vault_id, linked_account_id, category, title,
                    amount_minor, currency, due_at, advance_seconds,
                    recurrence_rule, recurrence_anchor_month,
                    recurrence_anchor_day, status, notes, created_at, updated_at
                 ) VALUES (
                    'reminder-1', 'vault-1', 'account-1', 'insurance', '续保提醒',
                    880000, 'CNY', '2027-08-01', 86400,
                    'yearly', 8, 1, 'active', '仅在密文中同步',
                    '2026-07-26T02:00:00.000Z', '2026-07-26T02:00:00.000Z'
                 );
                 INSERT INTO reminder_occurrences(
                    id, reminder_id, due_on, completed_at, next_due_on,
                    confirmation_draft_id, created_at
                 ) VALUES (
                    'occurrence-1', 'reminder-1', '2026-08-01',
                    '2026-08-01T10:00:00.000Z', '2027-08-01',
                    'draft-1', '2026-08-01T10:00:00.000Z'
                 )",
            )
            .expect("reminder fixture should insert");
        enable_sync_at(
            &mut source,
            "vault-1",
            EnableSyncRequest {
                cloud_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".to_owned(),
                platform: "macos".to_owned(),
                confirmed_by_user: true,
            },
        )
        .expect("source sync should enable");
        prepare_outbox_at(
            &mut source,
            "vault-1",
            PrepareOutboxRequest { limit: Some(20) },
        )
        .expect("source domain events should encrypt");
        let envelopes = list_outbox_at(&source, "vault-1").expect("source outbox should list");
        assert_eq!(
            envelopes
                .iter()
                .map(|event| event.event_kind.as_str())
                .collect::<Vec<_>>(),
            vec![
                "account_snapshot",
                "holding_snapshot",
                "holding_valuation",
                "ledger_event",
                "ledger_event",
                "ledger_event",
                "holding_operation",
                "holding_operation",
                "holding_operation_correction",
                "reminder_snapshot",
            ]
        );
        let (cloud_vault_id, sync_key): (String, Vec<u8>) = source
            .query_row(
                "SELECT cloud_vault_id, sync_key FROM sync_config WHERE local_vault_id = 'vault-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("source sync config should exist");

        let mut target = empty_fixture_connection();
        enable_sync_at(
            &mut target,
            "vault-1",
            EnableSyncRequest {
                cloud_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".to_owned(),
                platform: "macos".to_owned(),
                confirmed_by_user: true,
            },
        )
        .expect("target sync should enable");
        target
            .execute(
                "UPDATE sync_config SET cloud_vault_id = ?1, sync_key = ?2
                 WHERE local_vault_id = 'vault-1'",
                params![cloud_vault_id, sync_key],
            )
            .expect("target should share only the test sync key");
        let make_request = || {
            let events = envelopes
                .iter()
                .cloned()
                .enumerate()
                .map(|(index, event)| incoming(event, &format!("2026-07-26T15:00:0{index}.000Z")))
                .collect::<Vec<_>>();
            let last = events.last().expect("incoming page should not be empty");
            ApplyIncomingRequest {
                cursor_received_at: Some(last.received_at.clone()),
                cursor_event_id: Some(last.event_id.clone()),
                events,
            }
        };
        let applied = apply_incoming_at(&mut target, "vault-1", make_request())
            .expect("authenticated events should apply atomically");
        assert_eq!(applied.applied_count, 10);
        assert_eq!(applied.duplicate_count, 0);
        assert_eq!(applied.conflict_count, 0);
        let account_name: String = target
            .query_row(
                "SELECT display_name FROM accounts WHERE id = 'account-1'",
                [],
                |row| row.get(0),
            )
            .expect("account snapshot should apply");
        let balance: i64 = target
            .query_row(
                "SELECT balance_minor FROM account_balances WHERE account_id = 'account-1'",
                [],
                |row| row.get(0),
            )
            .expect("ledger event should apply");
        let reminder_title: String = target
            .query_row(
                "SELECT title FROM reminders WHERE id = 'reminder-1'",
                [],
                |row| row.get(0),
            )
            .expect("reminder snapshot should apply");
        assert_eq!(account_name, "工资账户");
        assert_eq!(balance, 12_850_032);
        assert_eq!(reminder_title, "续保提醒");
        let holding_state: (String, i64, i64) = target
            .query_row(
                "SELECT holding.name, valuation.units_micros,
                        valuation.market_value_minor
                 FROM holdings holding
                 JOIN holding_valuations valuation
                   ON valuation.holding_id = holding.id
                 WHERE holding.id = 'holding-1'
                   AND valuation.id = 'valuation-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("holding profile and immutable valuation should apply");
        assert_eq!(
            holding_state,
            ("稳健基金".to_owned(), 125_000_000, 1_088_000)
        );
        let operation_count: i64 = target
            .query_row(
                "SELECT count(*) FROM holding_operations
                 WHERE holding_id = 'holding-1'",
                [],
                |row| row.get(0),
            )
            .expect("holding operation history should apply");
        assert_eq!(operation_count, 2);
        let correction: (String, String, String) = target
            .query_row(
                "SELECT original_operation_id, compensating_operation_id, reason
                 FROM holding_operation_corrections
                 WHERE id = 'holding-correction-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("compensating correction link should apply");
        assert_eq!(
            correction,
            (
                "holding-operation-original".to_owned(),
                "holding-operation-compensating".to_owned(),
                "录入有误".to_owned(),
            )
        );
        let restored_drafts: i64 = target
            .query_row(
                "SELECT count(*) FROM draft_changes
                 WHERE status = 'confirmed' AND confirmed_by = 'sync_remote'",
                [],
                |row| row.get(0),
            )
            .expect("origin-device confirmations should be restored");
        assert_eq!(restored_drafts, 3);
        let occurrence: (String, Option<String>) = target
            .query_row(
                "SELECT due_on, next_due_on FROM reminder_occurrences
                 WHERE reminder_id = 'reminder-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("immutable reminder occurrence should apply");
        assert_eq!(
            occurrence,
            ("2026-08-01".to_owned(), Some("2027-08-01".to_owned()))
        );

        let duplicate = apply_incoming_at(&mut target, "vault-1", make_request())
            .expect("the same remote page should be idempotent");
        assert_eq!(duplicate.applied_count, 0);
        assert_eq!(duplicate.duplicate_count, 10);
        assert_eq!(duplicate.conflict_count, 0);
        let no_echo = prepare_outbox_at(
            &mut target,
            "vault-1",
            PrepareOutboxRequest { limit: Some(20) },
        )
        .expect("received domain events must not echo back into the outbox");
        assert_eq!(no_echo.pending_count, 0);
        assert_eq!(no_echo.last_logical_clock, 0);

        target
            .execute_batch(
                "
                UPDATE accounts SET display_name = '本机确认改动' WHERE id = 'account-1';
                INSERT INTO audit_events(
                  id, vault_id, category, action, actor_id, object_type,
                  object_id, metadata_json, occurred_at
                ) VALUES (
                  'audit-target-account-update', 'vault-1', 'data', 'account_updated',
                  'local_user', 'account', 'account-1', '{}',
                  '2026-07-26T16:00:00.000Z'
                );
                ",
            )
            .expect("target local edit should be audited");
        prepare_outbox_at(
            &mut target,
            "vault-1",
            PrepareOutboxRequest { limit: Some(10) },
        )
        .expect("target edit should acquire a local entity version");
        source
            .execute_batch(
                "
                UPDATE accounts SET display_name = '另一设备确认改动' WHERE id = 'account-1';
                INSERT INTO audit_events(
                  id, vault_id, category, action, actor_id, object_type,
                  object_id, metadata_json, occurred_at
                ) VALUES (
                  'audit-source-account-update', 'vault-1', 'data', 'account_updated',
                  'local_user', 'account', 'account-1', '{}',
                  '2026-07-26T16:01:00.000Z'
                );
                ",
            )
            .expect("source local edit should be audited");
        prepare_outbox_at(
            &mut source,
            "vault-1",
            PrepareOutboxRequest { limit: Some(10) },
        )
        .expect("source edit should produce a new immutable snapshot");
        let remote_update = list_outbox_at(&source, "vault-1")
            .expect("source outbox should list")
            .into_iter()
            .filter(|event| event.event_kind == "account_snapshot")
            .max_by_key(|event| event.logical_clock)
            .expect("updated account snapshot should exist");
        let conflict_event = incoming(remote_update, "2026-07-26T16:02:00.000Z");
        let conflict_event_id = conflict_event.event_id.clone();
        let conflict = apply_incoming_at(
            &mut target,
            "vault-1",
            ApplyIncomingRequest {
                events: vec![conflict_event],
                cursor_received_at: Some("2026-07-26T16:02:00.000Z".to_owned()),
                cursor_event_id: Some(conflict_event_id),
            },
        )
        .expect("different-device edits should be isolated, not overwrite");
        assert_eq!(conflict.applied_count, 0);
        assert_eq!(conflict.conflict_count, 1);
        let preserved_name: String = target
            .query_row(
                "SELECT display_name FROM accounts WHERE id = 'account-1'",
                [],
                |row| row.get(0),
            )
            .expect("local account should remain");
        assert_eq!(preserved_name, "本机确认改动");
        let unresolved = list_sync_conflicts_at(&target, "vault-1", false)
            .expect("unresolved conflicts should list");
        assert_eq!(unresolved.len(), 1);
        assert_eq!(unresolved[0].reason_code, "concurrent_edit");
        assert!(unresolved[0].can_inspect);
        assert!(unresolved[0].can_keep_local);
        let conflict_id = unresolved[0].id.clone();
        let inspection = inspect_sync_conflict_at(
            &target,
            "vault-1",
            InspectSyncConflictRequest {
                conflict_id: conflict_id.clone(),
            },
        )
        .expect("conflict payload should be reverified and decrypted");
        assert_eq!(
            inspection
                .incoming_payload
                .get("displayName")
                .and_then(serde_json::Value::as_str),
            Some("另一设备确认改动")
        );
        assert!(resolve_sync_conflict_keep_local_at(
            &mut target,
            "vault-1",
            ResolveSyncConflictRequest {
                conflict_id: conflict_id.clone(),
                confirmed_by_user: false,
            }
        )
        .is_err());
        let resolution = resolve_sync_conflict_keep_local_at(
            &mut target,
            "vault-1",
            ResolveSyncConflictRequest {
                conflict_id: conflict_id.clone(),
                confirmed_by_user: true,
            },
        )
        .expect("explicit keep-local resolution should append");
        assert_eq!(resolution.resolution_action, "keep_local");
        assert_eq!(resolution.status.inbound_conflict_count, 0);
        assert!(list_sync_conflicts_at(&target, "vault-1", false)
            .expect("resolved conflict should leave the pending list")
            .is_empty());
        let history = list_sync_conflicts_at(&target, "vault-1", true)
            .expect("resolved conflict should remain in immutable history");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].resolution_action.as_deref(), Some("keep_local"));
        assert!(!history[0].can_keep_local);
        let inbox_state_after: (String, String) = target
            .query_row(
                "SELECT status, error_code FROM sync_inbox_state
                 WHERE cloud_event_id = ?1",
                [&history[0].cloud_event_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("resolved inbox state should remain queryable");
        assert_eq!(
            inbox_state_after,
            ("rejected".to_owned(), "kept_local_by_user".to_owned())
        );
        let repeated = resolve_sync_conflict_keep_local_at(
            &mut target,
            "vault-1",
            ResolveSyncConflictRequest {
                conflict_id,
                confirmed_by_user: true,
            },
        )
        .expect("resolution retry should be idempotent");
        assert_eq!(repeated.resolution_id, resolution.resolution_id);
        let resolution_audit_count: i64 = target
            .query_row(
                "SELECT count(*) FROM audit_events
                 WHERE category = 'sync' AND action = 'conflict_resolved'",
                [],
                |row| row.get(0),
            )
            .expect("resolution audit should be queryable");
        assert_eq!(resolution_audit_count, 1);
        let still_preserved_name: String = target
            .query_row(
                "SELECT display_name FROM accounts WHERE id = 'account-1'",
                [],
                |row| row.get(0),
            )
            .expect("local account should remain after resolution");
        assert_eq!(still_preserved_name, "本机确认改动");

        let mut tampered = make_request();
        tampered.events[0].event_hash = format!("\\x{}", "00".repeat(32));
        assert!(apply_incoming_at(&mut target, "vault-1", tampered).is_err());
    }

    #[test]
    fn holding_operation_with_missing_dependencies_is_quarantined_without_partial_writes() {
        let mut target = empty_fixture_connection();
        target
            .execute(
                "INSERT INTO sync_inbox_events(
                    cloud_event_id, local_vault_id, event_kind, device_id,
                    logical_clock, idempotency_key, event_hash,
                    payload_nonce, payload_ciphertext, aad_version,
                    occurred_at, received_at, recorded_at
                 ) VALUES (
                    'event-missing-holding', 'vault-1', 'holding_operation',
                    'device-remote', 1, 'missing-holding-operation-fixture',
                    zeroblob(32), zeroblob(24), zeroblob(17), 2,
                    '2026-07-27T00:00:00.000Z',
                    '2026-07-27T00:00:01.000Z',
                    '2026-07-27T00:00:01.000Z'
                 )",
                [],
            )
            .expect("inbox envelope fixture should insert");
        let verified = VerifiedIncoming {
            envelope: SyncIncomingEnvelope {
                event_id: "event-missing-holding".to_owned(),
                vault_id: "vault-cloud".to_owned(),
                device_id: "device-remote".to_owned(),
                event_kind: "holding_operation".to_owned(),
                logical_clock: 1,
                idempotency_key: "missing-holding-operation-fixture".to_owned(),
                event_hash: format!("\\x{}", "00".repeat(32)),
                previous_event_hash: None,
                payload_nonce: format!("\\x{}", "00".repeat(24)),
                payload_ciphertext: format!("\\x{}", "00".repeat(17)),
                aad_version: 2,
                occurred_at: "2026-07-27T00:00:00.000Z".to_owned(),
                received_at: "2026-07-27T00:00:01.000Z".to_owned(),
            },
            event_hash: vec![0; 32],
            previous_event_hash: None,
            nonce: vec![0; 24],
            ciphertext: vec![0; 17],
            payload: serde_json::to_value(HoldingOperationSyncPayload {
                schema_version: 1,
                operation_id: "operation-missing-holding".to_owned(),
                holding_id: "holding-missing".to_owned(),
                draft_id: "draft-missing-holding".to_owned(),
                draft_source_type: "manual_holding_operation".to_owned(),
                operation_kind: "purchase".to_owned(),
                amount_minor: 10_000,
                currency: "CNY".to_owned(),
                units_delta_micros: 1_000_000,
                before_valuation_id: "valuation-before-missing".to_owned(),
                after_valuation_id: Some("valuation-after-missing".to_owned()),
                settlement_account_id: None,
                ledger_link_id: None,
                primary_ledger_event_id: None,
                secondary_ledger_event_id: None,
                occurred_on: "2026-07-27".to_owned(),
                description: "缺少依赖的申购".to_owned(),
                notes: None,
                created_at: "2026-07-27T00:00:00.000Z".to_owned(),
            })
            .expect("operation payload should serialize"),
        };
        let transaction = target
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .expect("test transaction should start");
        assert!(matches!(
            apply_holding_operation(&transaction, "vault-1", &verified)
                .expect("missing dependency should be isolated"),
            ApplyOutcome::Conflict
        ));
        transaction.commit().expect("conflict should commit");
        let state: (String, String) = target
            .query_row(
                "SELECT status, error_code FROM sync_inbox_state
                 WHERE cloud_event_id = 'event-missing-holding'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("quarantine state should exist");
        assert_eq!(
            state,
            ("conflict".to_owned(), "missing_dependency".to_owned())
        );
        let partial_writes: (i64, i64) = target
            .query_row(
                "SELECT
                   (SELECT count(*) FROM draft_changes),
                   (SELECT count(*) FROM holding_operations)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("partial-write counts should be queryable");
        assert_eq!(partial_writes, (0, 0));
    }
}
