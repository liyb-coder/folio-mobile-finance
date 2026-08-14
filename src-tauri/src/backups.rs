use crate::{
    crypto::{
        create_password_wrapped_dek, decrypt_password_payload, encrypt_password_payload,
        PasswordEnvelope,
    },
    database::{cipher_integrity_check, ensure_schema, open_encrypted},
    vault::{
        cleanup_new_database, database_path, metadata_path, prepare_private_directory,
        validate_display_name, validate_vault_id, vault_root, verify_vault_password_at,
        write_restored_metadata_at, VaultRuntime,
    },
};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri_plugin_dialog::DialogExt;
use zeroize::Zeroizing;

const BACKUP_MAGIC: &str = "FOLIO_ENCRYPTED_BACKUP";
const BACKUP_KIND: &str = "folio-backup";
const BACKUP_VERSION: u8 = 1;
const INNER_MAGIC: &[u8; 8] = b"FOLIOB01";
const MAX_CONTAINER_BYTES: u64 = 128 * 1024 * 1024;
const MAX_DATABASE_BYTES: usize = 96 * 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 64 * 1024;

#[derive(Clone, Default)]
pub struct BackupRuntime {
    pending: Arc<Mutex<Option<PendingBackupRestore>>>,
}

#[derive(Clone)]
struct PendingBackupRestore {
    token: String,
    path: PathBuf,
    fingerprint: String,
    inspected_source_vault_id: Option<String>,
}

impl BackupRuntime {
    fn select(&self, path: PathBuf, fingerprint: String) -> Result<String, String> {
        let token = random_token("restore")?;
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "Backup restore state is unavailable.".to_owned())?;
        *pending = Some(PendingBackupRestore {
            token: token.clone(),
            path,
            fingerprint,
            inspected_source_vault_id: None,
        });
        Ok(token)
    }

    fn pending(&self, token: &str) -> Result<PendingBackupRestore, String> {
        let pending = self
            .pending
            .lock()
            .map_err(|_| "Backup restore state is unavailable.".to_owned())?;
        pending
            .as_ref()
            .filter(|pending| pending.token == token)
            .cloned()
            .ok_or_else(|| "Backup restore selection has expired.".to_owned())
    }

    fn mark_inspected(&self, token: &str, source_vault_id: &str) -> Result<(), String> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "Backup restore state is unavailable.".to_owned())?;
        let selected = pending
            .as_mut()
            .filter(|pending| pending.token == token)
            .ok_or_else(|| "Backup restore selection has expired.".to_owned())?;
        selected.inspected_source_vault_id = Some(source_vault_id.to_owned());
        Ok(())
    }

    fn clear(&self, token: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            if pending
                .as_ref()
                .is_some_and(|pending| pending.token == token)
            {
                *pending = None;
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBackupRequest {
    current_password: String,
    backup_password: String,
    confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectBackupRequest {
    selection_token: String,
    backup_password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmBackupRestoreRequest {
    restore_token: String,
    backup_password: String,
    target_vault_id: String,
    target_display_name: String,
    new_password: String,
    confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardBackupSelectionRequest {
    selection_token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBackupResponse {
    status: &'static str,
    file_name: Option<String>,
    byte_count: Option<usize>,
    created_at: Option<String>,
    fingerprint: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSelectionResponse {
    status: &'static str,
    selection_token: Option<String>,
    file_name: Option<String>,
    byte_count: Option<u64>,
    fingerprint: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInspectionResponse {
    restore_token: String,
    source_vault_id: String,
    display_name: String,
    base_currency: String,
    created_at: String,
    schema_version: i64,
    account_count: i64,
    holding_count: i64,
    holding_valuation_count: i64,
    holding_operation_count: i64,
    ledger_event_count: i64,
    reminder_count: i64,
    database_bytes: usize,
    fingerprint: String,
    suggested_vault_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRestoreResponse {
    vault_id: String,
    session_id: String,
    display_name: String,
    base_currency: String,
    account_count: i64,
    holding_count: i64,
    holding_valuation_count: i64,
    holding_operation_count: i64,
    ledger_event_count: i64,
    reminder_count: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    version: u8,
    created_at: String,
    source_vault_id: String,
    display_name: String,
    base_currency: String,
    schema_version: i64,
    account_count: i64,
    #[serde(default)]
    holding_count: i64,
    #[serde(default)]
    holding_valuation_count: i64,
    #[serde(default)]
    holding_operation_count: i64,
    ledger_event_count: i64,
    reminder_count: i64,
    database_sha256: String,
    database_bytes: usize,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupContainer {
    magic: String,
    version: u8,
    envelope: PasswordEnvelope,
}

struct BackupPayload {
    manifest: BackupManifest,
    database_key: Zeroizing<[u8; 32]>,
    database_bytes: Zeroizing<Vec<u8>>,
}

struct BackupArtifact {
    bytes: Vec<u8>,
    manifest: BackupManifest,
    fingerprint: String,
}

fn random_token(prefix: &str) -> Result<String, String> {
    let mut bytes = [0_u8; 24];
    getrandom::fill(&mut bytes).map_err(|_| "Unable to create secure backup state.".to_owned())?;
    Ok(format!("{prefix}_{}", STANDARD_NO_PAD.encode(bytes)))
}

fn random_database_key() -> Result<Zeroizing<[u8; 32]>, String> {
    let mut bytes = Zeroizing::new([0_u8; 32]);
    getrandom::fill(bytes.as_mut())
        .map_err(|_| "Unable to create a secure backup database key.".to_owned())?;
    Ok(bytes)
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn validate_backup_password(password: &str) -> Result<(), String> {
    if password.chars().count() < 12 || password.len() > 1024 {
        return Err("Backup password must contain 12 to 1,024 characters.".to_owned());
    }
    Ok(())
}

fn private_temp_path(root: &Path, purpose: &str) -> Result<PathBuf, String> {
    let mut bytes = [0_u8; 12];
    getrandom::fill(&mut bytes)
        .map_err(|_| "Unable to create a secure temporary path.".to_owned())?;
    Ok(root.join(format!(".{purpose}-{}.sqlite3", hex::encode(bytes))))
}

fn write_private_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|_| "Unable to create the encrypted backup file.".to_owned())?;
    file.write_all(bytes)
        .map_err(|_| "Unable to write the encrypted backup file.".to_owned())?;
    file.sync_all()
        .map_err(|_| "Unable to persist the encrypted backup file.".to_owned())
}

fn write_backup_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Backup destination is invalid.".to_owned())?;
    if !parent.is_dir() {
        return Err("Backup destination folder is unavailable.".to_owned());
    }
    let mut random = [0_u8; 8];
    getrandom::fill(&mut random)
        .map_err(|_| "Unable to create an atomic backup file.".to_owned())?;
    let temporary = parent.join(format!(".folio-backup-{}.tmp", hex::encode(random)));
    let result = (|| {
        write_private_file(&temporary, bytes)?;
        fs::rename(&temporary, path)
            .map_err(|_| "Unable to commit the encrypted backup file.".to_owned())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn read_backup_file(path: &Path) -> Result<Vec<u8>, String> {
    let metadata =
        fs::metadata(path).map_err(|_| "Selected backup file is unavailable.".to_owned())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_CONTAINER_BYTES {
        return Err("Backup file must be between 1 byte and 128 MB.".to_owned());
    }
    fs::read(path).map_err(|_| "Unable to read the selected backup file.".to_owned())
}

fn parse_container(bytes: &[u8]) -> Result<BackupContainer, String> {
    let container: BackupContainer =
        serde_json::from_slice(bytes).map_err(|_| "Backup container is malformed.".to_owned())?;
    if container.magic != BACKUP_MAGIC || container.version != BACKUP_VERSION {
        return Err("This is not a supported Folio encrypted backup.".to_owned());
    }
    Ok(container)
}

fn pack_payload(
    manifest: &BackupManifest,
    database_key: &[u8; 32],
    database_bytes: &[u8],
) -> Result<Vec<u8>, String> {
    let manifest_bytes = serde_json::to_vec(manifest)
        .map_err(|_| "Unable to serialize backup manifest.".to_owned())?;
    if manifest_bytes.len() > MAX_MANIFEST_BYTES || database_bytes.len() > MAX_DATABASE_BYTES {
        return Err("Encrypted vault is too large for this backup format.".to_owned());
    }
    let manifest_length = u32::try_from(manifest_bytes.len())
        .map_err(|_| "Backup manifest is too large.".to_owned())?;
    let mut payload = Vec::with_capacity(
        INNER_MAGIC.len() + 4 + manifest_bytes.len() + database_key.len() + database_bytes.len(),
    );
    payload.extend_from_slice(INNER_MAGIC);
    payload.extend_from_slice(&manifest_length.to_be_bytes());
    payload.extend_from_slice(&manifest_bytes);
    payload.extend_from_slice(database_key);
    payload.extend_from_slice(database_bytes);
    Ok(payload)
}

fn unpack_payload(bytes: &[u8]) -> Result<BackupPayload, String> {
    if bytes.len() < INNER_MAGIC.len() + 4 + 32 + 1 || &bytes[..INNER_MAGIC.len()] != INNER_MAGIC {
        return Err("Decrypted backup payload is malformed.".to_owned());
    }
    let length_offset = INNER_MAGIC.len();
    let manifest_length = u32::from_be_bytes(
        bytes[length_offset..length_offset + 4]
            .try_into()
            .map_err(|_| "Decrypted backup payload is malformed.".to_owned())?,
    ) as usize;
    if manifest_length == 0 || manifest_length > MAX_MANIFEST_BYTES {
        return Err("Backup manifest has an invalid size.".to_owned());
    }
    let manifest_start = length_offset + 4;
    let manifest_end = manifest_start
        .checked_add(manifest_length)
        .ok_or_else(|| "Backup manifest size is invalid.".to_owned())?;
    let key_end = manifest_end
        .checked_add(32)
        .ok_or_else(|| "Backup database key size is invalid.".to_owned())?;
    if key_end >= bytes.len() {
        return Err("Decrypted backup payload is incomplete.".to_owned());
    }
    let manifest: BackupManifest = serde_json::from_slice(&bytes[manifest_start..manifest_end])
        .map_err(|_| "Backup manifest is malformed.".to_owned())?;
    if manifest.version != BACKUP_VERSION {
        return Err("Backup manifest version is unsupported.".to_owned());
    }
    let mut database_key = Zeroizing::new([0_u8; 32]);
    database_key.copy_from_slice(&bytes[manifest_end..key_end]);
    let database_bytes = Zeroizing::new(bytes[key_end..].to_vec());
    if database_bytes.len() > MAX_DATABASE_BYTES
        || database_bytes.len() != manifest.database_bytes
        || sha256_hex(database_bytes.as_slice()) != manifest.database_sha256
    {
        return Err("Backup database content does not match its manifest.".to_owned());
    }
    Ok(BackupPayload {
        manifest,
        database_key,
        database_bytes,
    })
}

fn decrypt_container(bytes: &[u8], backup_password: &str) -> Result<BackupPayload, String> {
    validate_backup_password(backup_password)?;
    let container = parse_container(bytes)?;
    let plaintext = decrypt_password_payload(BACKUP_KIND, backup_password, &container.envelope)
        .map_err(|_| "Backup password is invalid or the file was modified.".to_owned())?;
    unpack_payload(plaintext.as_slice())
}

fn current_timestamp(connection: &Connection) -> Result<String, String> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get(0)
        })
        .map_err(|_| "Unable to create a backup timestamp.".to_owned())
}

fn database_manifest(
    connection: &Connection,
    vault_id: &str,
    created_at: String,
    database_bytes: &[u8],
) -> Result<BackupManifest, String> {
    let (stored_id, display_name, base_currency): (String, String, String) = connection
        .query_row(
            "SELECT id, display_name, base_currency FROM vaults WHERE id = ?1",
            [vault_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| "Unable to read vault identity for backup.".to_owned())?;
    if stored_id != vault_id {
        return Err("Vault identity changed before backup.".to_owned());
    }
    let schema_version = connection
        .query_row(
            "SELECT coalesce(max(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to read vault schema version.".to_owned())?;
    let account_count = connection
        .query_row(
            "SELECT count(*) FROM accounts WHERE vault_id = ?1",
            [vault_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to count backup accounts.".to_owned())?;
    let ledger_event_count = connection
        .query_row(
            "SELECT count(*) FROM ledger_events WHERE vault_id = ?1",
            [vault_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to count backup ledger events.".to_owned())?;
    let holding_count = connection
        .query_row(
            "SELECT count(*) FROM holdings WHERE vault_id = ?1",
            [vault_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to count backup holdings.".to_owned())?;
    let holding_valuation_count = connection
        .query_row(
            "SELECT count(*) FROM holding_valuations WHERE vault_id = ?1",
            [vault_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to count backup holding valuations.".to_owned())?;
    let holding_operation_count = connection
        .query_row(
            "SELECT count(*) FROM holding_operations WHERE vault_id = ?1",
            [vault_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to count backup holding operations.".to_owned())?;
    let reminder_count = connection
        .query_row(
            "SELECT count(*)
             FROM reminders
             WHERE linked_account_id IS NULL
                OR linked_account_id IN (
                  SELECT id FROM accounts WHERE vault_id = ?1
                )",
            [vault_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to count backup reminders.".to_owned())?;
    Ok(BackupManifest {
        version: BACKUP_VERSION,
        created_at,
        source_vault_id: stored_id,
        display_name,
        base_currency,
        schema_version,
        account_count,
        holding_count,
        holding_valuation_count,
        holding_operation_count,
        ledger_event_count,
        reminder_count,
        database_sha256: sha256_hex(database_bytes),
        database_bytes: database_bytes.len(),
    })
}

fn export_sqlcipher_snapshot(
    connection: &mut Connection,
    destination: &Path,
    database_key: &[u8; 32],
) -> Result<(), String> {
    cleanup_new_database(destination);
    connection
        .execute_batch("PRAGMA wal_checkpoint(PASSIVE);")
        .map_err(|_| "Unable to checkpoint the encrypted vault before backup.".to_owned())?;
    let mut destination_connection = open_encrypted(destination, database_key)?;
    {
        let backup = rusqlite::backup::Backup::new(connection, &mut destination_connection)
            .map_err(|_| "Unable to create the encrypted backup snapshot.".to_owned())?;
        backup
            .run_to_completion(64, Duration::from_millis(5), None)
            .map_err(|_| "Unable to export the encrypted vault snapshot.".to_owned())?;
    }
    cipher_integrity_check(&destination_connection)?;
    destination_connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;")
        .map_err(|_| "Unable to finalize the encrypted backup snapshot.".to_owned())
}

fn verify_payload_database(root: &Path, payload: &BackupPayload) -> Result<(), String> {
    let path = private_temp_path(root, "backup-verify")?;
    let result = (|| {
        write_private_file(&path, payload.database_bytes.as_slice())?;
        let connection = open_encrypted(&path, &payload.database_key)?;
        cipher_integrity_check(&connection)?;
        let manifest = database_manifest(
            &connection,
            &payload.manifest.source_vault_id,
            payload.manifest.created_at.clone(),
            payload.database_bytes.as_slice(),
        )?;
        if manifest.source_vault_id != payload.manifest.source_vault_id
            || manifest.display_name != payload.manifest.display_name
            || manifest.base_currency != payload.manifest.base_currency
            || manifest.account_count != payload.manifest.account_count
            || manifest.holding_count != payload.manifest.holding_count
            || manifest.holding_valuation_count != payload.manifest.holding_valuation_count
            || manifest.holding_operation_count != payload.manifest.holding_operation_count
            || manifest.ledger_event_count != payload.manifest.ledger_event_count
            || manifest.reminder_count != payload.manifest.reminder_count
        {
            return Err("Backup manifest does not match the encrypted database.".to_owned());
        }
        let foreign_key_issue: Option<String> = connection
            .query_row("PRAGMA foreign_key_check", [], |row| row.get(0))
            .optional()
            .map_err(|_| "Unable to validate backup relationships.".to_owned())?;
        if foreign_key_issue.is_some() {
            return Err("Backup database contains invalid relationships.".to_owned());
        }
        Ok(())
    })();
    cleanup_new_database(&path);
    result
}

fn append_backup_audit(
    connection: &Connection,
    vault_id: &str,
    action: &str,
    fingerprint: &str,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO audit_events(
                id, vault_id, category, action, actor_id, object_type,
                object_id, metadata_json, occurred_at
             ) VALUES (
                ?1, ?2, 'backup', ?3, 'local-user', 'vault', ?2, ?4,
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![
                random_token("audit")?,
                vault_id,
                action,
                json!({ "fingerprint": fingerprint }).to_string()
            ],
        )
        .map_err(|_| "Unable to record encrypted backup audit.".to_owned())?;
    Ok(())
}

fn create_backup_bytes_at(
    runtime: &VaultRuntime,
    root: &Path,
    request: CreateBackupRequest,
) -> Result<BackupArtifact, String> {
    if !request.confirmed_by_user {
        return Err("Backup export requires explicit confirmation.".to_owned());
    }
    validate_backup_password(&request.backup_password)?;
    prepare_private_directory(root)?;
    let current_password = Zeroizing::new(request.current_password);
    let backup_password = Zeroizing::new(request.backup_password);
    runtime.with_unlocked_connection(|vault_id, connection| {
        verify_vault_password_at(root, vault_id, current_password.as_str())?;
        cipher_integrity_check(connection)?;
        let backup_database_key = random_database_key()?;
        let snapshot_path = private_temp_path(root, "backup-export")?;
        let result = (|| {
            export_sqlcipher_snapshot(connection, &snapshot_path, &backup_database_key)?;
            let database_bytes = Zeroizing::new(
                fs::read(&snapshot_path)
                    .map_err(|_| "Unable to read the encrypted backup snapshot.".to_owned())?,
            );
            if database_bytes.is_empty() || database_bytes.len() > MAX_DATABASE_BYTES {
                return Err("Encrypted vault is too large for backup.".to_owned());
            }
            let manifest = database_manifest(
                connection,
                vault_id,
                current_timestamp(connection)?,
                database_bytes.as_slice(),
            )?;
            let payload = Zeroizing::new(pack_payload(
                &manifest,
                &backup_database_key,
                database_bytes.as_slice(),
            )?);
            let envelope = encrypt_password_payload(
                BACKUP_KIND,
                backup_password.as_str(),
                payload.as_slice(),
            )?;
            let bytes = serde_json::to_vec(&BackupContainer {
                magic: BACKUP_MAGIC.to_owned(),
                version: BACKUP_VERSION,
                envelope,
            })
            .map_err(|_| "Unable to serialize encrypted backup container.".to_owned())?;
            if bytes.len() as u64 > MAX_CONTAINER_BYTES {
                return Err("Encrypted backup container exceeds 128 MB.".to_owned());
            }
            let fingerprint = sha256_hex(&bytes);
            append_backup_audit(connection, vault_id, "exported", &fingerprint)?;
            Ok(BackupArtifact {
                bytes,
                manifest,
                fingerprint,
            })
        })();
        cleanup_new_database(&snapshot_path);
        result
    })
}

fn inspect_backup_path_at(
    root: &Path,
    path: &Path,
    backup_password: &str,
) -> Result<(BackupPayload, String), String> {
    prepare_private_directory(root)?;
    let bytes = read_backup_file(path)?;
    let fingerprint = sha256_hex(&bytes);
    let payload = decrypt_container(&bytes, backup_password)?;
    verify_payload_database(root, &payload)?;
    Ok((payload, fingerprint))
}

fn suggested_restore_vault_id(source_vault_id: &str) -> String {
    let base = format!("{}-restored", source_vault_id.trim());
    if base.len() <= 64 {
        base
    } else {
        "restored-vault".to_owned()
    }
}

fn rewrite_restored_identity(
    connection: &mut Connection,
    source_vault_id: &str,
    target_vault_id: &str,
    target_display_name: &str,
) -> Result<(), String> {
    connection
        .execute_batch(
            "
            PRAGMA foreign_keys = OFF;
            DROP TRIGGER IF EXISTS ledger_events_no_update;
            DROP TRIGGER IF EXISTS ledger_events_no_delete;
            DROP TRIGGER IF EXISTS audit_events_no_update;
            DROP TRIGGER IF EXISTS audit_events_no_delete;
            DROP TRIGGER IF EXISTS ai_proposals_no_update;
            DROP TRIGGER IF EXISTS ai_proposals_no_delete;
            DROP TRIGGER IF EXISTS planning_events_no_update;
            DROP TRIGGER IF EXISTS planning_events_no_delete;
            DROP TRIGGER IF EXISTS holding_valuations_no_update;
            DROP TRIGGER IF EXISTS holding_valuations_no_delete;
            DROP TRIGGER IF EXISTS holding_operations_no_update;
            DROP TRIGGER IF EXISTS holding_operations_no_delete;
            DROP TRIGGER IF EXISTS holding_operation_corrections_no_update;
            DROP TRIGGER IF EXISTS holding_operation_corrections_no_delete;
            DROP TRIGGER IF EXISTS sync_outbox_no_update;
            DROP TRIGGER IF EXISTS sync_outbox_no_delete;
            DROP TRIGGER IF EXISTS sync_delivery_attempts_no_update;
            DROP TRIGGER IF EXISTS sync_delivery_attempts_no_delete;
            DROP TRIGGER IF EXISTS sync_inbox_no_update;
            DROP TRIGGER IF EXISTS sync_inbox_no_delete;
            DROP TRIGGER IF EXISTS sync_inbox_conflicts_no_update;
            DROP TRIGGER IF EXISTS sync_inbox_conflicts_no_delete;
            BEGIN IMMEDIATE;
            ",
        )
        .map_err(|_| "Unable to prepare the restored vault identity.".to_owned())?;
    let result = (|| {
        connection
            .execute_batch(
                "
                DELETE FROM sync_delivery_attempts;
                DELETE FROM sync_delivery_state;
                DELETE FROM sync_outbox_events;
                DELETE FROM sync_inbox_conflicts;
                DELETE FROM sync_inbox_state;
                DELETE FROM sync_inbox_events;
                DELETE FROM sync_entity_versions;
                DELETE FROM sync_config;
                ",
            )
            .map_err(|_| "Unable to disconnect restored sync identity.".to_owned())?;
        for table in [
            "accounts",
            "holdings",
            "holding_valuations",
            "holding_operations",
            "holding_operation_corrections",
            "import_batches",
            "draft_changes",
            "ai_proposals",
            "planning_profiles",
            "planning_events",
            "ledger_events",
            "audit_events",
        ] {
            connection
                .execute(
                    &format!("UPDATE {table} SET vault_id = ?1 WHERE vault_id = ?2"),
                    params![target_vault_id, source_vault_id],
                )
                .map_err(|_| "Unable to rewrite restored vault ownership.".to_owned())?;
        }
        let updated = connection
            .execute(
                "UPDATE vaults SET id = ?1, display_name = ?2 WHERE id = ?3",
                params![target_vault_id, target_display_name, source_vault_id],
            )
            .map_err(|_| "Unable to rewrite restored vault identity.".to_owned())?;
        if updated != 1 {
            return Err("Restored vault identity is missing.".to_owned());
        }
        connection
            .execute(
                "INSERT INTO audit_events(
                    id, vault_id, category, action, actor_id, object_type,
                    object_id, metadata_json, occurred_at
                 ) VALUES (
                    ?1, ?2, 'backup', 'restored', 'local-user', 'vault', ?2, ?3,
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![
                    random_token("audit")?,
                    target_vault_id,
                    json!({
                        "sourceVaultId": source_vault_id,
                        "syncDisconnected": true
                    })
                    .to_string()
                ],
            )
            .map_err(|_| "Unable to record restored vault audit.".to_owned())?;
        connection
            .execute_batch("COMMIT; PRAGMA foreign_keys = ON;")
            .map_err(|_| "Unable to commit restored vault identity.".to_owned())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = connection.execute_batch("ROLLBACK; PRAGMA foreign_keys = ON;");
        return result;
    }
    let issue: Option<String> = connection
        .query_row("PRAGMA foreign_key_check", [], |row| row.get(0))
        .optional()
        .map_err(|_| "Unable to validate restored vault relationships.".to_owned())?;
    if issue.is_some() {
        return Err("Restored vault relationships are invalid.".to_owned());
    }
    ensure_schema(connection)?;
    Ok(())
}

fn rekey_database(connection: &Connection, key: &[u8; 32]) -> Result<(), String> {
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;")
        .map_err(|_| "Unable to consolidate the restored encrypted database.".to_owned())?;
    let raw_key = Zeroizing::new(hex::encode_upper(key));
    let statement = Zeroizing::new(format!("PRAGMA rekey = \"x'{}'\";", raw_key.as_str()));
    connection
        .execute_batch(statement.as_str())
        .map_err(|_| "Unable to rotate the restored vault encryption key.".to_owned())?;
    cipher_integrity_check(connection)
}

fn restore_payload_at(
    runtime: &VaultRuntime,
    root: &Path,
    payload: BackupPayload,
    request: &ConfirmBackupRestoreRequest,
    new_password: &str,
) -> Result<BackupRestoreResponse, String> {
    if !request.confirmed_by_user {
        return Err("Backup restore requires explicit confirmation.".to_owned());
    }
    let target_vault_id = validate_vault_id(&request.target_vault_id)?;
    let target_display_name = validate_display_name(&request.target_display_name)?;
    validate_backup_password(new_password)?;
    prepare_private_directory(root)?;
    let final_database = database_path(root, &target_vault_id);
    let final_metadata = metadata_path(root, &target_vault_id);
    if final_database.exists() || final_metadata.exists() {
        return Err("A vault with this identifier already exists.".to_owned());
    }

    verify_payload_database(root, &payload)?;
    let (new_database_key, wrapped_key) =
        create_password_wrapped_dek(&target_vault_id, new_password)?;
    let temporary = private_temp_path(root, "restore-install")?;
    let result = (|| {
        write_private_file(&temporary, payload.database_bytes.as_slice())?;
        let mut connection = open_encrypted(&temporary, &payload.database_key)?;
        rewrite_restored_identity(
            &mut connection,
            &payload.manifest.source_vault_id,
            &target_vault_id,
            &target_display_name,
        )?;
        rekey_database(&connection, &new_database_key)?;
        drop(connection);
        fs::rename(&temporary, &final_database)
            .map_err(|_| "Unable to install the restored encrypted database.".to_owned())?;
        if let Err(error) = write_restored_metadata_at(
            root,
            &target_vault_id,
            &target_display_name,
            &payload.manifest.base_currency,
            wrapped_key,
        ) {
            cleanup_new_database(&final_database);
            return Err(error);
        }
        let connection = match open_encrypted(&final_database, &new_database_key) {
            Ok(connection) => connection,
            Err(error) => {
                let _ = fs::remove_file(&final_metadata);
                cleanup_new_database(&final_database);
                return Err(error);
            }
        };
        let stored: (String, String, String) = connection
            .query_row(
                "SELECT id, display_name, base_currency FROM vaults WHERE id = ?1",
                [&target_vault_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|_| "Unable to verify restored vault identity.".to_owned())?;
        if stored.0 != target_vault_id
            || stored.1 != target_display_name
            || stored.2 != payload.manifest.base_currency
        {
            return Err("Restored vault identity verification failed.".to_owned());
        }
        cipher_integrity_check(&connection)?;
        let session_id =
            runtime.install_restored_connection(target_vault_id.clone(), connection)?;
        Ok(BackupRestoreResponse {
            vault_id: target_vault_id,
            session_id,
            display_name: target_display_name,
            base_currency: payload.manifest.base_currency,
            account_count: payload.manifest.account_count,
            holding_count: payload.manifest.holding_count,
            holding_valuation_count: payload.manifest.holding_valuation_count,
            holding_operation_count: payload.manifest.holding_operation_count,
            ledger_event_count: payload.manifest.ledger_event_count,
            reminder_count: payload.manifest.reminder_count,
        })
    })();
    if result.is_err() {
        cleanup_new_database(&temporary);
        let _ = fs::remove_file(&final_metadata);
        cleanup_new_database(&final_database);
    }
    result
}

fn ensure_backup_extension(mut path: PathBuf) -> PathBuf {
    if path.extension().and_then(|value| value.to_str()) != Some("folio-backup") {
        path.set_extension("folio-backup");
    }
    path
}

#[tauri::command]
pub async fn vault_backup_create(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, VaultRuntime>,
    request: CreateBackupRequest,
) -> Result<CreateBackupResponse, String> {
    if !request.confirmed_by_user {
        return Err("Backup export requires explicit confirmation.".to_owned());
    }
    validate_backup_password(&request.backup_password)?;
    let selected = app
        .dialog()
        .file()
        .add_filter("Folio encrypted backup", &["folio-backup"])
        .set_file_name("Folio-encrypted-backup.folio-backup")
        .blocking_save_file();
    let Some(selected) = selected else {
        return Ok(CreateBackupResponse {
            status: "cancelled",
            file_name: None,
            byte_count: None,
            created_at: None,
            fingerprint: None,
        });
    };
    let path = ensure_backup_extension(
        selected
            .into_path()
            .map_err(|_| "Selected backup destination is not a local file path.".to_owned())?,
    );
    let root = vault_root(&app)?;
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let artifact = create_backup_bytes_at(&runtime, &root, request)?;
        write_backup_atomically(&path, &artifact.bytes)?;
        Ok(CreateBackupResponse {
            status: "exported",
            file_name: path
                .file_name()
                .and_then(|value| value.to_str())
                .map(str::to_owned),
            byte_count: Some(artifact.bytes.len()),
            created_at: Some(artifact.manifest.created_at),
            fingerprint: Some(artifact.fingerprint),
        })
    })
    .await
    .map_err(|_| "Encrypted backup export task failed.".to_owned())?
}

#[tauri::command]
pub async fn vault_backup_select(
    app: tauri::AppHandle,
    backup_runtime: tauri::State<'_, BackupRuntime>,
) -> Result<BackupSelectionResponse, String> {
    let selected = app
        .dialog()
        .file()
        .add_filter("Folio encrypted backup", &["folio-backup"])
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(BackupSelectionResponse {
            status: "cancelled",
            selection_token: None,
            file_name: None,
            byte_count: None,
            fingerprint: None,
        });
    };
    let path = selected
        .into_path()
        .map_err(|_| "Selected backup source is not a local file path.".to_owned())?;
    let bytes = read_backup_file(&path)?;
    parse_container(&bytes)?;
    let fingerprint = sha256_hex(&bytes);
    let token = backup_runtime.select(path.clone(), fingerprint.clone())?;
    Ok(BackupSelectionResponse {
        status: "selected",
        selection_token: Some(token),
        file_name: path
            .file_name()
            .and_then(|value| value.to_str())
            .map(str::to_owned),
        byte_count: Some(bytes.len() as u64),
        fingerprint: Some(fingerprint),
    })
}

#[tauri::command]
pub async fn vault_backup_inspect(
    app: tauri::AppHandle,
    backup_runtime: tauri::State<'_, BackupRuntime>,
    request: InspectBackupRequest,
) -> Result<BackupInspectionResponse, String> {
    let pending = backup_runtime.pending(&request.selection_token)?;
    let root = vault_root(&app)?;
    let password = Zeroizing::new(request.backup_password);
    let (payload, fingerprint) = tauri::async_runtime::spawn_blocking(move || {
        inspect_backup_path_at(&root, &pending.path, password.as_str())
    })
    .await
    .map_err(|_| "Encrypted backup inspection task failed.".to_owned())??;
    if fingerprint != pending.fingerprint {
        return Err("Selected backup changed after it was chosen.".to_owned());
    }
    backup_runtime.mark_inspected(&request.selection_token, &payload.manifest.source_vault_id)?;
    let manifest = payload.manifest;
    Ok(BackupInspectionResponse {
        restore_token: request.selection_token,
        source_vault_id: manifest.source_vault_id.clone(),
        display_name: manifest.display_name,
        base_currency: manifest.base_currency,
        created_at: manifest.created_at,
        schema_version: manifest.schema_version,
        account_count: manifest.account_count,
        holding_count: manifest.holding_count,
        holding_valuation_count: manifest.holding_valuation_count,
        holding_operation_count: manifest.holding_operation_count,
        ledger_event_count: manifest.ledger_event_count,
        reminder_count: manifest.reminder_count,
        database_bytes: manifest.database_bytes,
        fingerprint,
        suggested_vault_id: suggested_restore_vault_id(&manifest.source_vault_id),
    })
}

#[tauri::command]
pub async fn vault_backup_confirm_restore(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, VaultRuntime>,
    backup_runtime: tauri::State<'_, BackupRuntime>,
    mut request: ConfirmBackupRestoreRequest,
) -> Result<BackupRestoreResponse, String> {
    let pending = backup_runtime.pending(&request.restore_token)?;
    let inspected_source = pending
        .inspected_source_vault_id
        .clone()
        .ok_or_else(|| "Backup must be inspected before restore.".to_owned())?;
    let root = vault_root(&app)?;
    let runtime = runtime.inner().clone();
    let password = Zeroizing::new(std::mem::take(&mut request.backup_password));
    let new_password = Zeroizing::new(std::mem::take(&mut request.new_password));
    let result = tauri::async_runtime::spawn_blocking(move || {
        let bytes = read_backup_file(&pending.path)?;
        let fingerprint = sha256_hex(&bytes);
        if fingerprint != pending.fingerprint {
            return Err("Selected backup changed after inspection.".to_owned());
        }
        let payload = decrypt_container(&bytes, password.as_str())?;
        if payload.manifest.source_vault_id != inspected_source {
            return Err("Backup identity changed after inspection.".to_owned());
        }
        restore_payload_at(&runtime, &root, payload, &request, new_password.as_str())
    })
    .await
    .map_err(|_| "Encrypted backup restore task failed.".to_owned())??;
    backup_runtime.clear(&pending.token);
    Ok(result)
}

#[tauri::command]
pub fn vault_backup_discard(
    backup_runtime: tauri::State<'_, BackupRuntime>,
    request: DiscardBackupSelectionRequest,
) -> Result<(), String> {
    backup_runtime.clear(&request.selection_token);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::create_password_wrapped_dek;
    use tempfile::TempDir;

    const APP_PASSWORD: &str = "correct horse battery staple";
    const BACKUP_PASSWORD: &str = "independent backup password";
    const RESTORED_PASSWORD: &str = "new restored vault password";

    fn setup_vault() -> (TempDir, VaultRuntime) {
        let directory = tempfile::tempdir().expect("temporary vault directory");
        prepare_private_directory(directory.path()).expect("private directory should prepare");
        let runtime = VaultRuntime::default();
        let (database_key, wrapped) =
            create_password_wrapped_dek("vault-1", APP_PASSWORD).expect("key should wrap");
        let connection = open_encrypted(&database_path(directory.path(), "vault-1"), &database_key)
            .expect("database should open");
        connection
            .execute(
                "INSERT INTO vaults(id, display_name, base_currency, created_at)
                 VALUES ('vault-1', 'Private finances', 'CNY',
                         '2026-07-26T00:00:00.000Z')",
                [],
            )
            .expect("vault should insert");
        connection
            .execute(
                "INSERT INTO accounts(
                    id, vault_id, institution_name, display_name,
                    account_type, currency, created_at
                 ) VALUES (
                    'account-1', 'vault-1', '虚构银行', '备份验收账户',
                    'cash', 'CNY', '2026-07-26T00:00:00.000Z'
                 )",
                [],
            )
            .expect("account should insert");
        connection
            .execute(
                "INSERT INTO ledger_events(
                    id, vault_id, account_id, event_type, delta_minor,
                    currency, occurred_at, status, idempotency_key,
                    metadata_json, created_at
                 ) VALUES (
                    'event-1', 'vault-1', 'account-1', 'opening_balance', 1280050,
                    'CNY', '2026-07-26', 'confirmed', 'opening:test',
                    '{\"description\":\"虚构备份余额\"}',
                    '2026-07-26T00:00:00.000Z'
                 )",
                [],
            )
            .expect("ledger event should insert");
        connection
            .execute_batch(
                "
                INSERT INTO draft_changes(
                  id, vault_id, source_type, status, proposed_events_json,
                  evidence_json, created_at, confirmed_at, confirmed_by
                ) VALUES (
                  'draft-holding', 'vault-1', 'manual_holding', 'confirmed',
                  '{\"kind\":\"holding.create\"}', '[]',
                  '2026-07-26T00:00:00.000Z',
                  '2026-07-26T00:00:00.000Z', 'local_user'
                );
                INSERT INTO holdings(
                  id, vault_id, account_id, name, product_type, currency, created_at
                ) VALUES (
                  'holding-1', 'vault-1', 'account-1', '虚构备份基金',
                  'fund', 'CNY', '2026-07-26T00:00:00.000Z'
                );
                INSERT INTO holding_valuations(
                  id, vault_id, holding_id, draft_id, units_micros,
                  cost_basis_minor, market_value_minor, as_of_date,
                  source_type, created_at
                ) VALUES (
                  'valuation-1', 'vault-1', 'holding-1', 'draft-holding',
                  1000000, 10000, 10200, '2026-07-26',
                  'manual', '2026-07-26T00:00:00.000Z'
                );
                INSERT INTO holding_operations(
                  id, vault_id, holding_id, draft_id, operation_kind,
                  amount_minor, currency, units_delta_micros,
                  before_valuation_id, primary_ledger_event_id,
                  occurred_on, description, created_at
                ) VALUES (
                  'holding-operation-1', 'vault-1', 'holding-1', 'draft-holding',
                  'dividend', 500, 'CNY', 0, 'valuation-1', 'event-1',
                  '2026-07-26', '虚构备份分红', '2026-07-26T00:00:00.000Z'
                );
                ",
            )
            .expect("holding backup fixtures should insert");
        write_restored_metadata_at(
            directory.path(),
            "vault-1",
            "Private finances",
            "CNY",
            wrapped,
        )
        .expect("metadata should write");
        runtime.install_test_session("vault-1", connection);
        (directory, runtime)
    }

    fn create_request() -> CreateBackupRequest {
        CreateBackupRequest {
            current_password: APP_PASSWORD.to_owned(),
            backup_password: BACKUP_PASSWORD.to_owned(),
            confirmed_by_user: true,
        }
    }

    #[test]
    fn encrypted_backup_round_trips_into_a_new_vault() {
        let (directory, runtime) = setup_vault();
        let artifact = create_backup_bytes_at(&runtime, directory.path(), create_request())
            .expect("backup should create");
        assert!(!artifact.bytes.starts_with(b"SQLite format 3"));
        assert!(!artifact
            .bytes
            .windows("Private finances".len())
            .any(|window| window == b"Private finances"));
        assert!(!artifact
            .bytes
            .windows("虚构备份余额".len())
            .any(|window| window == "虚构备份余额".as_bytes()));

        let backup_path = directory.path().join("portable.folio-backup");
        write_private_file(&backup_path, &artifact.bytes).expect("backup fixture should write");
        let (payload, fingerprint) =
            inspect_backup_path_at(directory.path(), &backup_path, BACKUP_PASSWORD)
                .expect("backup should inspect");
        assert_eq!(fingerprint, artifact.fingerprint);
        assert_eq!(payload.manifest.account_count, 1);
        assert_eq!(payload.manifest.holding_count, 1);
        assert_eq!(payload.manifest.holding_valuation_count, 1);
        assert_eq!(payload.manifest.holding_operation_count, 1);
        assert_eq!(payload.manifest.ledger_event_count, 1);

        let restored = restore_payload_at(
            &runtime,
            directory.path(),
            payload,
            &ConfirmBackupRestoreRequest {
                restore_token: "test-token".to_owned(),
                backup_password: BACKUP_PASSWORD.to_owned(),
                target_vault_id: "vault-restored".to_owned(),
                target_display_name: "恢复验收保险库".to_owned(),
                new_password: RESTORED_PASSWORD.to_owned(),
                confirmed_by_user: true,
            },
            RESTORED_PASSWORD,
        )
        .expect("backup should restore");
        assert_eq!(restored.vault_id, "vault-restored");
        assert_eq!(restored.account_count, 1);
        assert_eq!(restored.holding_count, 1);
        assert_eq!(restored.holding_valuation_count, 1);
        assert_eq!(restored.holding_operation_count, 1);
        runtime
            .with_unlocked_connection(|vault_id, connection| {
                assert_eq!(vault_id, "vault-restored");
                let balance: i64 = connection
                    .query_row(
                        "SELECT sum(delta_minor) FROM ledger_events
                         WHERE vault_id = 'vault-restored'",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(balance, 1_280_050);
                let old_owner_count: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM ledger_events WHERE vault_id = 'vault-1'",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(old_owner_count, 0);
                let restored_holding_count: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM holdings
                         WHERE vault_id = 'vault-restored'",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(restored_holding_count, 1);
                let restored_operation_count: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM holding_operations
                         WHERE vault_id = 'vault-restored'",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(restored_operation_count, 1);
                assert!(connection
                    .execute(
                        "UPDATE ledger_events SET delta_minor = 1 WHERE id = 'event-1'",
                        [],
                    )
                    .is_err());
                assert!(connection
                    .execute(
                        "UPDATE holding_valuations SET market_value_minor = 1
                         WHERE id = 'valuation-1'",
                        [],
                    )
                    .is_err());
                assert!(connection
                    .execute(
                        "UPDATE holding_operations SET amount_minor = 1
                         WHERE id = 'holding-operation-1'",
                        [],
                    )
                    .is_err());
                Ok(())
            })
            .unwrap();
        assert!(database_path(directory.path(), "vault-1").exists());
        assert!(database_path(directory.path(), "vault-restored").exists());
        verify_vault_password_at(directory.path(), "vault-restored", RESTORED_PASSWORD)
            .expect("new app password should unwrap restored key");
    }

    #[test]
    fn wrong_password_tampering_and_existing_target_fail_closed() {
        let (directory, runtime) = setup_vault();
        let reauthentication = create_backup_bytes_at(
            &runtime,
            directory.path(),
            CreateBackupRequest {
                current_password: "incorrect application password".to_owned(),
                ..create_request()
            },
        );
        assert!(matches!(
            reauthentication,
            Err(ref error) if error == "Vault password is invalid."
        ));
        let artifact = create_backup_bytes_at(&runtime, directory.path(), create_request())
            .expect("backup should create");
        assert!(decrypt_container(&artifact.bytes, "incorrect backup password").is_err());

        let mut tampered = artifact.bytes.clone();
        let index = tampered.len() / 2;
        tampered[index] = if tampered[index] == b'A' { b'B' } else { b'A' };
        assert!(decrypt_container(&tampered, BACKUP_PASSWORD).is_err());

        let payload =
            decrypt_container(&artifact.bytes, BACKUP_PASSWORD).expect("backup should decrypt");
        let result = restore_payload_at(
            &runtime,
            directory.path(),
            payload,
            &ConfirmBackupRestoreRequest {
                restore_token: "test-token".to_owned(),
                backup_password: BACKUP_PASSWORD.to_owned(),
                target_vault_id: "vault-1".to_owned(),
                target_display_name: "不能覆盖".to_owned(),
                new_password: RESTORED_PASSWORD.to_owned(),
                confirmed_by_user: true,
            },
            RESTORED_PASSWORD,
        );
        assert!(matches!(
            result,
            Err(ref error) if error == "A vault with this identifier already exists."
        ));

        let payload =
            decrypt_container(&artifact.bytes, BACKUP_PASSWORD).expect("backup should decrypt");
        let unconfirmed = restore_payload_at(
            &runtime,
            directory.path(),
            payload,
            &ConfirmBackupRestoreRequest {
                restore_token: "test-token".to_owned(),
                backup_password: BACKUP_PASSWORD.to_owned(),
                target_vault_id: "unconfirmed-restore".to_owned(),
                target_display_name: "未确认恢复".to_owned(),
                new_password: RESTORED_PASSWORD.to_owned(),
                confirmed_by_user: false,
            },
            RESTORED_PASSWORD,
        );
        assert!(matches!(
            unconfirmed,
            Err(ref error) if error == "Backup restore requires explicit confirmation."
        ));
        assert!(!database_path(directory.path(), "unconfirmed-restore").exists());
    }

    #[test]
    fn discarded_selection_releases_the_native_file_reference() {
        let runtime = BackupRuntime::default();
        let token = runtime
            .select(
                PathBuf::from("/private/example/backup.folio-backup"),
                "fingerprint".to_owned(),
            )
            .expect("selection should install");
        assert!(runtime.pending(&token).is_ok());
        runtime.clear(&token);
        assert!(matches!(
            runtime.pending(&token),
            Err(ref error) if error == "Backup restore selection has expired."
        ));
    }
}
