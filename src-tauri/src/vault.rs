use crate::{
    accounts::account_snapshot,
    crypto::{create_password_wrapped_dek, unwrap_password_dek, wrap_existing_dek, WrappedDek},
    database::{cipher_integrity_check, open_encrypted},
    holding_operations::holding_operation_snapshot,
    holdings::holding_snapshot,
    imports::import_snapshot,
    keychain,
    planning::planning_snapshot,
    reminders::reminder_snapshot,
    transactions::transaction_snapshot,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::Manager;
use zeroize::Zeroizing;

const METADATA_VERSION: u8 = 1;
const MAX_METADATA_BYTES: u64 = 64 * 1024;
const MAX_FAILED_ATTEMPTS: u32 = 5;
const UNLOCK_COOLDOWN: Duration = Duration::from_secs(30);

#[derive(Clone, Default)]
pub struct VaultRuntime {
    state: Arc<Mutex<VaultState>>,
}

impl VaultRuntime {
    pub(crate) fn with_unlocked_connection<T>(
        &self,
        operation: impl FnOnce(&str, &mut Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Vault state is unavailable.".to_owned())?;
        let session = state
            .session
            .as_mut()
            .ok_or_else(|| "Vault is locked.".to_owned())?;
        let vault_id = session.vault_id.clone();
        operation(&vault_id, &mut session.connection)
    }

    pub(crate) fn install_restored_connection(
        &self,
        vault_id: String,
        connection: Connection,
    ) -> Result<String, String> {
        install_session(self, vault_id, connection)
    }

    #[cfg(test)]
    pub(crate) fn install_test_session(&self, vault_id: &str, connection: Connection) {
        let mut state = self.state.lock().expect("test vault state should lock");
        state.session = Some(VaultSession {
            vault_id: vault_id.to_owned(),
            session_id: "test-session".to_owned(),
            connection,
        });
    }
}

#[derive(Default)]
struct VaultState {
    session: Option<VaultSession>,
    failed_attempts: u32,
    blocked_until: Option<Instant>,
}

struct VaultSession {
    vault_id: String,
    session_id: String,
    connection: Connection,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VaultMetadata {
    version: u8,
    vault_id: String,
    display_name: String,
    base_currency: String,
    password_wrapped_dek: WrappedDek,
    #[serde(default)]
    biometric_enabled: bool,
    #[serde(default)]
    password_changed_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVaultRequest {
    vault_id: String,
    display_name: String,
    base_currency: String,
    password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockRequest {
    vault_id: String,
    method: UnlockMethod,
    password: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnableBiometricRequest {
    vault_id: String,
    password: String,
    confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisableBiometricRequest {
    vault_id: String,
    password: String,
    confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePasswordRequest {
    vault_id: String,
    current_password: String,
    new_password: String,
    confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearVaultDataRequest {
    vault_id: String,
    current_password: String,
    confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum UnlockMethod {
    Biometric,
    Password,
    Passkey,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatusResponse {
    status: &'static str,
    vault_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockResponse {
    session_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVaultResponse {
    vault_id: String,
    session_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiometricStatusResponse {
    available: bool,
    enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePasswordResponse {
    status: &'static str,
    biometric_enabled: bool,
    changed_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearVaultDataResponse {
    status: &'static str,
    vault_id: String,
    deleted_email_source_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSummaryResponse {
    vault_id: String,
    display_name: String,
    base_currency: String,
    biometric_enabled: bool,
}

pub(crate) fn vault_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("vaults"))
        .map_err(|_| "Unable to locate the private application data directory.".to_owned())
}

pub(crate) fn validate_vault_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("vaultId must contain only letters, numbers, '-' or '_'.".to_owned());
    }
    Ok(value.to_owned())
}

pub(crate) fn validate_display_name(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 80 {
        return Err("Vault display name must contain 1 to 80 characters.".to_owned());
    }
    Ok(value.to_owned())
}

fn validate_currency(value: &str) -> Result<String, String> {
    let value = value.trim().to_ascii_uppercase();
    if value.len() != 3 || !value.bytes().all(|byte| byte.is_ascii_uppercase()) {
        return Err("Base currency must be a three-letter ISO currency code.".to_owned());
    }
    Ok(value)
}

fn validate_password(password: String) -> Result<Zeroizing<String>, String> {
    let password = Zeroizing::new(password);
    if password.chars().count() < 12 || password.len() > 1024 {
        return Err("Vault password must contain at least 12 characters.".to_owned());
    }
    Ok(password)
}

pub(crate) fn metadata_path(root: &Path, vault_id: &str) -> PathBuf {
    root.join(format!("{vault_id}.vault.json"))
}

pub(crate) fn database_path(root: &Path, vault_id: &str) -> PathBuf {
    root.join(format!("{vault_id}.vault.sqlite3"))
}

pub(crate) fn cleanup_new_database(path: &Path) {
    let _ = fs::remove_file(path);
    for suffix in ["-wal", "-shm"] {
        let mut sidecar = path.as_os_str().to_os_string();
        sidecar.push(suffix);
        let _ = fs::remove_file(PathBuf::from(sidecar));
    }
}

pub(crate) fn prepare_private_directory(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root)
        .map_err(|_| "Unable to create the private vault directory.".to_owned())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Unable to secure the private vault directory.".to_owned())?;
    }
    Ok(())
}

fn random_session_id() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|_| "Unable to create a secure vault session.".to_owned())?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn write_metadata_atomically(path: &Path, metadata: &VaultMetadata) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(metadata)
        .map_err(|_| "Unable to serialize vault metadata.".to_owned())?;
    let mut random = [0_u8; 8];
    getrandom::fill(&mut random)
        .map_err(|_| "Unable to create a secure metadata file.".to_owned())?;
    let temporary = path.with_extension(format!("tmp-{}", hex::encode(random)));

    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options
            .open(&temporary)
            .map_err(|_| "Unable to create vault metadata.".to_owned())?;
        file.write_all(&bytes)
            .map_err(|_| "Unable to write vault metadata.".to_owned())?;
        file.sync_all()
            .map_err(|_| "Unable to persist vault metadata.".to_owned())?;
        fs::rename(&temporary, path).map_err(|_| "Unable to commit vault metadata.".to_owned())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

pub(crate) fn verify_vault_password_at(
    root: &Path,
    vault_id: &str,
    password: &str,
) -> Result<(), String> {
    let vault_id = validate_vault_id(vault_id)?;
    if password.chars().count() < 12 || password.len() > 1024 {
        return Err("Vault password is invalid.".to_owned());
    }
    let metadata = load_metadata(&metadata_path(root, &vault_id))?;
    if metadata.vault_id != vault_id {
        return Err("Vault metadata is invalid.".to_owned());
    }
    unwrap_password_dek(&vault_id, password, &metadata.password_wrapped_dek)
        .map(|_| ())
        .map_err(|_| "Vault password is invalid.".to_owned())
}

pub(crate) fn write_restored_metadata_at(
    root: &Path,
    vault_id: &str,
    display_name: &str,
    base_currency: &str,
    password_wrapped_dek: WrappedDek,
) -> Result<(), String> {
    let vault_id = validate_vault_id(vault_id)?;
    let display_name = validate_display_name(display_name)?;
    let base_currency = validate_currency(base_currency)?;
    let path = metadata_path(root, &vault_id);
    if path.exists() {
        return Err("A vault with this identifier already exists.".to_owned());
    }
    write_metadata_atomically(
        &path,
        &VaultMetadata {
            version: METADATA_VERSION,
            vault_id,
            display_name,
            base_currency,
            password_wrapped_dek,
            biometric_enabled: false,
            password_changed_at: None,
        },
    )
}

fn load_metadata(path: &Path) -> Result<VaultMetadata, String> {
    let file_metadata =
        fs::metadata(path).map_err(|_| "The requested vault does not exist.".to_owned())?;
    if !file_metadata.is_file() || file_metadata.len() > MAX_METADATA_BYTES {
        return Err("Vault metadata is invalid.".to_owned());
    }
    let bytes = fs::read(path).map_err(|_| "Unable to read vault metadata.".to_owned())?;
    let metadata: VaultMetadata =
        serde_json::from_slice(&bytes).map_err(|_| "Vault metadata is invalid.".to_owned())?;
    if metadata.version != METADATA_VERSION {
        return Err("This vault format is not supported by this app version.".to_owned());
    }
    Ok(metadata)
}

fn list_at(root: &Path) -> Result<Vec<VaultSummaryResponse>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut vaults = Vec::new();
    let entries =
        fs::read_dir(root).map_err(|_| "Unable to read the private vault directory.".to_owned())?;
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.ends_with(".vault.json") {
            continue;
        }
        let Ok(metadata) = load_metadata(&path) else {
            continue;
        };
        vaults.push(VaultSummaryResponse {
            vault_id: metadata.vault_id,
            display_name: metadata.display_name,
            base_currency: metadata.base_currency,
            biometric_enabled: metadata.biometric_enabled,
        });
    }
    vaults.sort_by(|left, right| left.display_name.cmp(&right.display_name));
    Ok(vaults)
}

fn ensure_can_attempt_unlock(runtime: &VaultRuntime) -> Result<(), String> {
    let mut state = runtime
        .state
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_owned())?;
    if let Some(blocked_until) = state.blocked_until {
        if Instant::now() < blocked_until {
            return Err("Too many failed attempts. Try again later.".to_owned());
        }
        state.failed_attempts = 0;
        state.blocked_until = None;
    }
    Ok(())
}

fn record_unlock_failure(runtime: &VaultRuntime) {
    if let Ok(mut state) = runtime.state.lock() {
        state.failed_attempts = state.failed_attempts.saturating_add(1);
        if state.failed_attempts >= MAX_FAILED_ATTEMPTS {
            state.blocked_until = Some(Instant::now() + UNLOCK_COOLDOWN);
        }
    }
}

fn install_session(
    runtime: &VaultRuntime,
    vault_id: String,
    connection: Connection,
) -> Result<String, String> {
    let session_id = random_session_id()?;
    let mut state = runtime
        .state
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_owned())?;
    state.session = Some(VaultSession {
        vault_id,
        session_id: session_id.clone(),
        connection,
    });
    state.failed_attempts = 0;
    state.blocked_until = None;
    Ok(session_id)
}

fn create_at(
    runtime: &VaultRuntime,
    root: &Path,
    request: CreateVaultRequest,
) -> Result<CreateVaultResponse, String> {
    let vault_id = validate_vault_id(&request.vault_id)?;
    let display_name = validate_display_name(&request.display_name)?;
    let base_currency = validate_currency(&request.base_currency)?;
    let password = validate_password(request.password)?;
    prepare_private_directory(root)?;

    let metadata_file = metadata_path(root, &vault_id);
    let database_file = database_path(root, &vault_id);
    if metadata_file.exists() || database_file.exists() {
        return Err("A vault with this identifier already exists.".to_owned());
    }

    let (dek, wrapped_dek) = create_password_wrapped_dek(&vault_id, password.as_str())?;
    let connection = open_encrypted(&database_file, &dek)?;
    let insert_result = connection.execute(
        "INSERT INTO vaults(id, display_name, base_currency, created_at)
         VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        (&vault_id, &display_name, &base_currency),
    );
    if insert_result.is_err() || cipher_integrity_check(&connection).is_err() {
        drop(connection);
        cleanup_new_database(&database_file);
        return Err("Unable to initialize the encrypted vault.".to_owned());
    }

    let metadata = VaultMetadata {
        version: METADATA_VERSION,
        vault_id: vault_id.clone(),
        display_name,
        base_currency,
        password_wrapped_dek: wrapped_dek,
        biometric_enabled: false,
        password_changed_at: None,
    };
    if let Err(error) = write_metadata_atomically(&metadata_file, &metadata) {
        drop(connection);
        cleanup_new_database(&database_file);
        return Err(error);
    }

    let session_id = install_session(runtime, vault_id.clone(), connection)?;
    Ok(CreateVaultResponse {
        vault_id,
        session_id,
    })
}

fn unlock_at(
    runtime: &VaultRuntime,
    root: &Path,
    mut request: UnlockRequest,
) -> Result<UnlockResponse, String> {
    ensure_can_attempt_unlock(runtime)?;
    let vault_id = validate_vault_id(&request.vault_id)?;
    let metadata = load_metadata(&metadata_path(root, &vault_id))?;
    if metadata.vault_id != vault_id {
        return Err("Vault metadata is invalid.".to_owned());
    }

    match request.method {
        UnlockMethod::Password => {
            let password = request
                .password
                .take()
                .ok_or_else(|| "Password unlock requires a password.".to_owned())
                .and_then(validate_password)?;
            let result =
                unwrap_password_dek(&vault_id, password.as_str(), &metadata.password_wrapped_dek)
                    .and_then(|dek| open_session_with_dek(runtime, root, vault_id, &dek));
            if result.is_err() {
                record_unlock_failure(runtime);
                return Err("Vault password or encrypted data is invalid.".to_owned());
            }
            result
        }
        UnlockMethod::Biometric => {
            if !metadata.biometric_enabled {
                return Err("Touch ID unlock is not configured for this vault.".to_owned());
            }
            let bytes = keychain::load_biometric_dek(&vault_id)?;
            if bytes.len() != 32 {
                return Err("The Keychain vault key is invalid.".to_owned());
            }
            let mut dek = Zeroizing::new([0_u8; 32]);
            dek.copy_from_slice(&bytes);
            open_session_with_dek(runtime, root, vault_id, &dek)
        }
        UnlockMethod::Passkey => Err("Passkey unlock is not available in this build.".to_owned()),
    }
}

fn open_session_with_dek(
    runtime: &VaultRuntime,
    root: &Path,
    vault_id: String,
    dek: &[u8; 32],
) -> Result<UnlockResponse, String> {
    let connection = open_encrypted(&database_path(root, &vault_id), dek)?;
    let stored_id: String = connection
        .query_row("SELECT id FROM vaults WHERE id = ?1", [&vault_id], |row| {
            row.get(0)
        })
        .map_err(|_| "Vault credentials or encrypted data are invalid.".to_owned())?;
    if stored_id != vault_id {
        return Err("Vault credentials or encrypted data are invalid.".to_owned());
    }
    cipher_integrity_check(&connection)?;
    install_session(runtime, vault_id, connection).map(|session_id| UnlockResponse { session_id })
}

fn require_unlocked_vault(runtime: &VaultRuntime, vault_id: &str) -> Result<(), String> {
    let state = runtime
        .state
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_owned())?;
    match state.session.as_ref() {
        Some(session) if session.vault_id == vault_id => Ok(()),
        _ => {
            Err("The selected vault must be unlocked before changing security settings.".to_owned())
        }
    }
}

fn reset_authentication_failures(runtime: &VaultRuntime) {
    if let Ok(mut state) = runtime.state.lock() {
        state.failed_attempts = 0;
        state.blocked_until = None;
    }
}

fn change_password_at(
    runtime: &VaultRuntime,
    root: &Path,
    request: ChangePasswordRequest,
) -> Result<ChangePasswordResponse, String> {
    if !request.confirmed_by_user {
        return Err(
            "Explicit confirmation is required before changing the vault password.".to_owned(),
        );
    }
    ensure_can_attempt_unlock(runtime)?;
    let vault_id = validate_vault_id(&request.vault_id)?;
    require_unlocked_vault(runtime, &vault_id)?;
    let current_password = validate_password(request.current_password)?;
    let new_password = validate_password(request.new_password)?;
    if current_password.as_str() == new_password.as_str() {
        return Err(
            "The new vault password must be different from the current password.".to_owned(),
        );
    }
    let path = metadata_path(root, &vault_id);
    let original_metadata = load_metadata(&path)?;
    if original_metadata.vault_id != vault_id {
        return Err("Vault metadata is invalid.".to_owned());
    }
    let dek = match unwrap_password_dek(
        &vault_id,
        current_password.as_str(),
        &original_metadata.password_wrapped_dek,
    ) {
        Ok(dek) => dek,
        Err(_) => {
            record_unlock_failure(runtime);
            return Err("Vault password is invalid.".to_owned());
        }
    };
    let next_wrapped_dek = wrap_existing_dek(&vault_id, new_password.as_str(), dek.as_ref())?;

    runtime
        .with_unlocked_connection(|session_vault_id, connection| {
            if session_vault_id != vault_id {
                return Err(
                    "The selected vault must be unlocked before changing security settings."
                        .to_owned(),
                );
            }
            cipher_integrity_check(connection)?;
            let changed_at: String = connection
                .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
                    row.get(0)
                })
                .map_err(|_| "Unable to create the password change timestamp.".to_owned())?;
            let mut next_metadata = original_metadata.clone();
            next_metadata.password_wrapped_dek = next_wrapped_dek;
            next_metadata.password_changed_at = Some(changed_at.clone());
            write_metadata_atomically(&path, &next_metadata)?;

            let audit_result = connection.execute(
                "INSERT INTO audit_events(
                id, vault_id, category, action, actor_id,
                object_type, object_id, metadata_json, occurred_at
             ) VALUES (
                ?1, ?2, 'security', 'vault_password_changed', 'local_user',
                'vault', ?2, ?3, ?4
             )",
                rusqlite::params![
                    format!("audit_{}", random_session_id()?),
                    vault_id,
                    serde_json::json!({
                        "keyRewrapped": true,
                        "databaseRekeyed": false,
                        "biometricPreserved": next_metadata.biometric_enabled
                    })
                    .to_string(),
                    changed_at,
                ],
            );
            if audit_result.is_err() {
                write_metadata_atomically(&path, &original_metadata).map_err(|_| {
                    "Unable to commit or safely roll back the password change.".to_owned()
                })?;
                return Err("Unable to append the password change audit event.".to_owned());
            }
            Ok(ChangePasswordResponse {
                status: "changed",
                biometric_enabled: next_metadata.biometric_enabled,
                changed_at,
            })
        })
        .inspect(|_| reset_authentication_failures(runtime))
}

fn clear_vault_data_with(
    runtime: &VaultRuntime,
    root: &Path,
    request: ClearVaultDataRequest,
    delete_biometric: impl FnOnce(&str),
    mut delete_email_secret: impl FnMut(&str, &str),
) -> Result<ClearVaultDataResponse, String> {
    if !request.confirmed_by_user {
        return Err(
            "Explicit confirmation is required before clearing all vault data.".to_owned(),
        );
    }
    ensure_can_attempt_unlock(runtime)?;
    let vault_id = validate_vault_id(&request.vault_id)?;
    require_unlocked_vault(runtime, &vault_id)?;
    let password = validate_password(request.current_password)?;
    let original_metadata = load_metadata(&metadata_path(root, &vault_id))?;
    let dek = match unwrap_password_dek(
        &vault_id,
        password.as_str(),
        &original_metadata.password_wrapped_dek,
    ) {
        Ok(dek) => dek,
        Err(_) => {
            record_unlock_failure(runtime);
            return Err("Vault password is invalid.".to_owned());
        }
    };

    let email_source_ids = runtime.with_unlocked_connection(|session_vault_id, connection| {
        if session_vault_id != vault_id {
            return Err(
                "The selected vault must be unlocked before clearing its data.".to_owned(),
            );
        }
        cipher_integrity_check(connection)?;
        let mut statement = connection
            .prepare("SELECT id FROM email_sources WHERE vault_id = ?1 ORDER BY id")
            .map_err(|_| "Unable to inspect encrypted data before clearing it.".to_owned())?;
        let rows = statement
            .query_map([&vault_id], |row| row.get::<_, String>(0))
            .map_err(|_| "Unable to inspect encrypted data before clearing it.".to_owned())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|_| "Unable to inspect encrypted data before clearing it.".to_owned())
    })?;

    let metadata_file = metadata_path(root, &vault_id);
    let database_file = database_path(root, &vault_id);
    if !metadata_file.exists() || !database_file.exists() {
        return Err("The encrypted vault files are incomplete; nothing was cleared.".to_owned());
    }
    // Drop the live SQLCipher connection before removing its files. The metadata
    // file is renamed last: until that point a failure can still roll back safely.
    lock(runtime, None)?;
    let suffix = random_session_id()?.replace(['/', '+'], "_");
    let retired_database = root.join(format!(".{vault_id}.{suffix}.cleared.sqlite3"));
    let retired_metadata = root.join(format!(".{vault_id}.{suffix}.cleared.json"));

    if fs::rename(&database_file, &retired_database).is_err() {
        let _ = open_session_with_dek(runtime, root, vault_id.clone(), &dek);
        return Err("Unable to retire the encrypted vault database.".to_owned());
    }
    if fs::rename(&metadata_file, &retired_metadata).is_err() {
        let _ = fs::rename(&retired_database, &database_file);
        let _ = open_session_with_dek(runtime, root, vault_id.clone(), &dek);
        return Err("Unable to retire the vault key metadata; no data was cleared.".to_owned());
    }

    delete_biometric(&vault_id);
    for source_id in &email_source_ids {
        delete_email_secret(&vault_id, source_id);
    }

    // Destroy the small wrapped-key metadata before best-effort removal of the
    // already-encrypted database. Without metadata or Keychain material, any
    // filesystem residue is cryptographically inaccessible.
    if let Ok(size) = fs::metadata(&retired_metadata).map(|item| item.len() as usize) {
        let zeros = vec![0_u8; size.min(MAX_METADATA_BYTES as usize)];
        if let Ok(mut file) = OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(&retired_metadata)
        {
            let _ = file.write_all(&zeros);
            let _ = file.sync_all();
        }
    }
    let _ = fs::remove_file(&retired_metadata);
    cleanup_new_database(&retired_database);
    cleanup_new_database(&database_file);
    reset_authentication_failures(runtime);

    Ok(ClearVaultDataResponse {
        status: "cleared",
        vault_id,
        deleted_email_source_count: email_source_ids.len(),
    })
}

fn clear_vault_data_at(
    runtime: &VaultRuntime,
    root: &Path,
    request: ClearVaultDataRequest,
) -> Result<ClearVaultDataResponse, String> {
    clear_vault_data_with(
        runtime,
        root,
        request,
        keychain::delete_biometric_dek,
        keychain::delete_email_secret,
    )
}

fn enable_biometric_with(
    runtime: &VaultRuntime,
    root: &Path,
    request: EnableBiometricRequest,
    store: impl FnOnce(&str, &[u8; 32]) -> Result<(), String>,
    delete: impl FnOnce(&str),
) -> Result<BiometricStatusResponse, String> {
    if !request.confirmed_by_user {
        return Err("Explicit confirmation is required before enabling Touch ID.".to_owned());
    }
    let vault_id = validate_vault_id(&request.vault_id)?;
    require_unlocked_vault(runtime, &vault_id)?;
    let password = validate_password(request.password)?;
    let path = metadata_path(root, &vault_id);
    let mut metadata = load_metadata(&path)?;
    if metadata.vault_id != vault_id {
        return Err("Vault metadata is invalid.".to_owned());
    }
    let dek = unwrap_password_dek(&vault_id, password.as_str(), &metadata.password_wrapped_dek)
        .map_err(|_| "Vault password is invalid.".to_owned())?;
    store(&vault_id, &dek)?;
    metadata.biometric_enabled = true;
    if let Err(error) = write_metadata_atomically(&path, &metadata) {
        delete(&vault_id);
        return Err(error);
    }
    Ok(BiometricStatusResponse {
        available: true,
        enabled: true,
    })
}

fn enable_biometric_at(
    runtime: &VaultRuntime,
    root: &Path,
    request: EnableBiometricRequest,
) -> Result<BiometricStatusResponse, String> {
    enable_biometric_with(
        runtime,
        root,
        request,
        keychain::store_biometric_dek,
        keychain::delete_biometric_dek,
    )
}

fn disable_biometric_with(
    runtime: &VaultRuntime,
    root: &Path,
    request: DisableBiometricRequest,
    delete: impl FnOnce(&str),
) -> Result<BiometricStatusResponse, String> {
    if !request.confirmed_by_user {
        return Err("Explicit confirmation is required before disabling Touch ID.".to_owned());
    }
    let vault_id = validate_vault_id(&request.vault_id)?;
    require_unlocked_vault(runtime, &vault_id)?;
    let password = validate_password(request.password)?;
    let path = metadata_path(root, &vault_id);
    let mut metadata = load_metadata(&path)?;
    if metadata.vault_id != vault_id {
        return Err("Vault metadata is invalid.".to_owned());
    }
    unwrap_password_dek(&vault_id, password.as_str(), &metadata.password_wrapped_dek)
        .map_err(|_| "Vault password is invalid.".to_owned())?;
    metadata.biometric_enabled = false;
    write_metadata_atomically(&path, &metadata)?;
    delete(&vault_id);
    Ok(BiometricStatusResponse {
        available: keychain::biometry_available(),
        enabled: false,
    })
}

fn disable_biometric_at(
    runtime: &VaultRuntime,
    root: &Path,
    request: DisableBiometricRequest,
) -> Result<BiometricStatusResponse, String> {
    disable_biometric_with(runtime, root, request, keychain::delete_biometric_dek)
}

fn status(runtime: &VaultRuntime) -> Result<VaultStatusResponse, String> {
    let state = runtime
        .state
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_owned())?;
    Ok(VaultStatusResponse {
        status: if state.session.is_some() {
            "unlocked"
        } else {
            "locked"
        },
        vault_id: state
            .session
            .as_ref()
            .map(|session| session.vault_id.clone()),
    })
}

fn lock(runtime: &VaultRuntime, session_id: Option<&str>) -> Result<(), String> {
    let mut state = runtime
        .state
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_owned())?;
    if let (Some(session), Some(provided)) = (state.session.as_ref(), session_id) {
        if session.session_id != provided {
            return Err("Vault session is invalid.".to_owned());
        }
    }
    state.session = None;
    Ok(())
}

#[tauri::command]
pub async fn vault_create(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, VaultRuntime>,
    request: CreateVaultRequest,
) -> Result<CreateVaultResponse, String> {
    let root = vault_root(&app)?;
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || create_at(&runtime, &root, request))
        .await
        .map_err(|_| "Vault creation task failed.".to_owned())?
}

#[tauri::command]
pub fn vault_list(app: tauri::AppHandle) -> Result<Vec<VaultSummaryResponse>, String> {
    list_at(&vault_root(&app)?)
}

#[tauri::command]
pub fn vault_biometric_status(
    app: tauri::AppHandle,
    vault_id: Option<String>,
) -> Result<BiometricStatusResponse, String> {
    let enabled = if let Some(vault_id) = vault_id {
        let vault_id = validate_vault_id(&vault_id)?;
        load_metadata(&metadata_path(&vault_root(&app)?, &vault_id))
            .map(|metadata| metadata.biometric_enabled)
            .unwrap_or(false)
    } else {
        false
    };
    Ok(BiometricStatusResponse {
        available: keychain::biometry_available(),
        enabled,
    })
}

#[tauri::command]
pub async fn vault_enable_biometric(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, VaultRuntime>,
    request: EnableBiometricRequest,
) -> Result<BiometricStatusResponse, String> {
    let root = vault_root(&app)?;
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || enable_biometric_at(&runtime, &root, request))
        .await
        .map_err(|_| "Touch ID enrollment task failed.".to_owned())?
}

#[tauri::command]
pub async fn vault_disable_biometric(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, VaultRuntime>,
    request: DisableBiometricRequest,
) -> Result<BiometricStatusResponse, String> {
    let root = vault_root(&app)?;
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || disable_biometric_at(&runtime, &root, request))
        .await
        .map_err(|_| "Touch ID removal task failed.".to_owned())?
}

#[tauri::command]
pub async fn vault_change_password(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, VaultRuntime>,
    request: ChangePasswordRequest,
) -> Result<ChangePasswordResponse, String> {
    let root = vault_root(&app)?;
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || change_password_at(&runtime, &root, request))
        .await
        .map_err(|_| "Vault password change task failed.".to_owned())?
}

#[tauri::command]
pub async fn vault_clear_all_data(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, VaultRuntime>,
    request: ClearVaultDataRequest,
) -> Result<ClearVaultDataResponse, String> {
    let root = vault_root(&app)?;
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || clear_vault_data_at(&runtime, &root, request))
        .await
        .map_err(|_| "Vault data clearing task failed.".to_owned())?
}

#[tauri::command]
pub fn vault_status(
    runtime: tauri::State<'_, VaultRuntime>,
) -> Result<VaultStatusResponse, String> {
    status(&runtime)
}

#[tauri::command]
pub async fn vault_unlock(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, VaultRuntime>,
    request: UnlockRequest,
) -> Result<UnlockResponse, String> {
    let root = vault_root(&app)?;
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || unlock_at(&runtime, &root, request))
        .await
        .map_err(|_| "Vault unlock task failed.".to_owned())?
}

#[tauri::command]
pub fn vault_lock(
    runtime: tauri::State<'_, VaultRuntime>,
    session_id: Option<String>,
) -> Result<(), String> {
    lock(&runtime, session_id.as_deref())
}

#[tauri::command]
pub fn vault_get_snapshot(
    runtime: tauri::State<'_, VaultRuntime>,
) -> Result<serde_json::Value, String> {
    runtime.with_unlocked_connection(|vault_id, connection| {
        let vault = connection
            .query_row(
                "SELECT id, display_name, base_currency, created_at FROM vaults WHERE id = ?1",
                [vault_id],
                |row| {
                    Ok(serde_json::json!({
                        "id": row.get::<_, String>(0)?,
                        "displayName": row.get::<_, String>(1)?,
                        "baseCurrency": row.get::<_, String>(2)?,
                        "createdAt": row.get::<_, String>(3)?,
                    }))
                },
            )
            .map_err(|_| "Unable to read the encrypted vault.".to_owned())?;
        let (accounts, balances) = account_snapshot(connection, vault_id)?;
        let transactions = transaction_snapshot(connection, vault_id)?;
        let reminders = reminder_snapshot(connection, vault_id)?;
        let imports = import_snapshot(connection, vault_id)?;
        let holdings = holding_snapshot(connection, vault_id)?;
        let holding_operations = holding_operation_snapshot(connection, vault_id)?;
        let planning = planning_snapshot(connection, vault_id)?;
        Ok(serde_json::json!({
            "vault": vault,
            "accounts": accounts,
            "balances": balances,
            "transactions": transactions,
            "reminders": reminders,
            "imports": imports,
            "holdings": holdings,
            "holdingOperations": holding_operations,
            "planning": planning,
        }))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_request(password: &str) -> CreateVaultRequest {
        CreateVaultRequest {
            vault_id: "vault-1".to_owned(),
            display_name: "Private finances".to_owned(),
            base_currency: "cny".to_owned(),
            password: password.to_owned(),
        }
    }

    fn password_unlock(password: &str) -> UnlockRequest {
        UnlockRequest {
            vault_id: "vault-1".to_owned(),
            method: UnlockMethod::Password,
            password: Some(password.to_owned()),
        }
    }

    fn biometric_unlock() -> UnlockRequest {
        UnlockRequest {
            vault_id: "vault-1".to_owned(),
            method: UnlockMethod::Biometric,
            password: None,
        }
    }

    fn enable_biometric_request(password: &str, confirmed_by_user: bool) -> EnableBiometricRequest {
        EnableBiometricRequest {
            vault_id: "vault-1".to_owned(),
            password: password.to_owned(),
            confirmed_by_user,
        }
    }

    fn disable_biometric_request(
        password: &str,
        confirmed_by_user: bool,
    ) -> DisableBiometricRequest {
        DisableBiometricRequest {
            vault_id: "vault-1".to_owned(),
            password: password.to_owned(),
            confirmed_by_user,
        }
    }

    fn change_password_request(
        current_password: &str,
        new_password: &str,
        confirmed_by_user: bool,
    ) -> ChangePasswordRequest {
        ChangePasswordRequest {
            vault_id: "vault-1".to_owned(),
            current_password: current_password.to_owned(),
            new_password: new_password.to_owned(),
            confirmed_by_user,
        }
    }

    fn clear_data_request(password: &str, confirmed_by_user: bool) -> ClearVaultDataRequest {
        ClearVaultDataRequest {
            vault_id: "vault-1".to_owned(),
            current_password: password.to_owned(),
            confirmed_by_user,
        }
    }

    #[test]
    fn runtime_starts_locked() {
        let runtime = VaultRuntime::default();
        let current = status(&runtime).expect("status should be readable");
        assert_eq!(current.status, "locked");
        assert!(current.vault_id.is_none());
    }

    #[test]
    fn creates_locks_and_reopens_an_encrypted_vault() {
        let directory = tempfile::tempdir().expect("temporary directory should exist");
        let runtime = VaultRuntime::default();
        let password = "correct horse battery staple";

        let created = create_at(&runtime, directory.path(), create_request(password))
            .expect("vault should be created");
        assert_eq!(created.vault_id, "vault-1");
        let listed = list_at(directory.path()).expect("vault list should be readable");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].vault_id, "vault-1");
        assert_eq!(listed[0].display_name, "Private finances");
        assert_eq!(listed[0].base_currency, "CNY");
        assert!(!listed[0].biometric_enabled);
        let metadata =
            fs::read_to_string(metadata_path(directory.path(), "vault-1")).expect("metadata");
        assert!(!metadata.contains(password));
        assert!(metadata.contains("passwordWrappedDek"));
        let database =
            fs::read(database_path(directory.path(), "vault-1")).expect("encrypted database");
        assert!(!database.starts_with(b"SQLite format 3"));
        assert!(!database
            .windows("Private finances".len())
            .any(|window| window == b"Private finances"));
        assert_eq!(
            status(&runtime).expect("status should be readable").status,
            "unlocked"
        );
        lock(&runtime, Some(&created.session_id)).expect("vault should lock");
        assert_eq!(
            status(&runtime).expect("status should be readable").status,
            "locked"
        );

        let unlocked = unlock_at(&runtime, directory.path(), password_unlock(password))
            .expect("correct password should unlock");
        assert!(!unlocked.session_id.is_empty());
        assert_eq!(
            status(&runtime).expect("status should be readable").status,
            "unlocked"
        );
    }

    #[test]
    fn wrong_password_fails_closed_and_does_not_replace_session() {
        let directory = tempfile::tempdir().expect("temporary directory should exist");
        let runtime = VaultRuntime::default();
        create_at(
            &runtime,
            directory.path(),
            create_request("correct horse battery staple"),
        )
        .expect("vault should be created");
        lock(&runtime, None).expect("vault should lock");

        let result = unlock_at(
            &runtime,
            directory.path(),
            password_unlock("incorrect password value"),
        );
        assert!(result.is_err());
        assert_eq!(
            status(&runtime).expect("status should be readable").status,
            "locked"
        );
    }

    #[test]
    fn clearing_all_data_requires_password_confirmation_and_destroys_the_vault() {
        use std::cell::{Cell, RefCell};

        let directory = tempfile::tempdir().expect("temporary directory should exist");
        let runtime = VaultRuntime::default();
        let password = "correct horse battery staple";
        create_at(&runtime, directory.path(), create_request(password))
            .expect("vault should be created");
        runtime
            .with_unlocked_connection(|vault_id, connection| {
                connection
                    .execute(
                        "INSERT INTO accounts(
                           id, vault_id, institution_name, display_name,
                           account_type, currency, created_at
                         ) VALUES (
                           'account-1', ?1, '演示银行', '信用卡',
                           'credit_card', 'CNY', '2026-07-31T00:00:00.000Z'
                         )",
                        [vault_id],
                    )
                    .map_err(|_| "fixture account should insert".to_owned())?;
                connection
                    .execute(
                        "INSERT INTO email_sources(
                           id, vault_id, provider, email_address, host, port,
                           mailbox, account_id, allowed_senders_json,
                           subject_keywords_json, created_at, updated_at
                         ) VALUES (
                           'email-1', ?1, 'qq_imap', 'demo@qq.com',
                           'imap.qq.com', 993, 'INBOX', 'account-1',
                           '[\"bank.example\"]', '[\"消费提醒\"]',
                           '2026-07-31T00:00:00.000Z',
                           '2026-07-31T00:00:00.000Z'
                         )",
                        [vault_id],
                    )
                    .map_err(|_| "fixture email source should insert".to_owned())?;
                Ok(())
            })
            .expect("fixture data should be installed");

        let rejected = clear_vault_data_with(
            &runtime,
            directory.path(),
            clear_data_request(password, false),
            |_| {},
            |_, _| {},
        );
        assert!(matches!(
            rejected,
            Err(ref error) if error.contains("Explicit confirmation")
        ));
        assert!(metadata_path(directory.path(), "vault-1").exists());
        assert!(database_path(directory.path(), "vault-1").exists());

        let wrong_password = clear_vault_data_with(
            &runtime,
            directory.path(),
            clear_data_request("incorrect password value", true),
            |_| {},
            |_, _| {},
        );
        assert!(matches!(
            wrong_password,
            Err(ref error) if error == "Vault password is invalid."
        ));
        assert!(metadata_path(directory.path(), "vault-1").exists());
        assert!(database_path(directory.path(), "vault-1").exists());

        let biometric_deleted = Cell::new(false);
        let email_secrets = RefCell::new(Vec::new());
        let cleared = clear_vault_data_with(
            &runtime,
            directory.path(),
            clear_data_request(password, true),
            |_| biometric_deleted.set(true),
            |vault_id, source_id| {
                email_secrets
                    .borrow_mut()
                    .push((vault_id.to_owned(), source_id.to_owned()));
            },
        )
        .expect("confirmed clearing should destroy the current vault");
        assert_eq!(cleared.status, "cleared");
        assert_eq!(cleared.deleted_email_source_count, 1);
        assert!(biometric_deleted.get());
        assert_eq!(
            email_secrets.into_inner(),
            vec![("vault-1".to_owned(), "email-1".to_owned())]
        );
        assert_eq!(status(&runtime).expect("status").status, "locked");
        assert!(!metadata_path(directory.path(), "vault-1").exists());
        assert!(!database_path(directory.path(), "vault-1").exists());
        assert!(list_at(directory.path()).expect("list").is_empty());
    }

    #[test]
    fn biometric_unlock_fails_closed_until_keychain_is_configured() {
        let directory = tempfile::tempdir().expect("temporary directory should exist");
        let runtime = VaultRuntime::default();
        create_at(
            &runtime,
            directory.path(),
            create_request("correct horse battery staple"),
        )
        .expect("vault should be created");
        lock(&runtime, None).expect("vault should lock");

        let result = unlock_at(&runtime, directory.path(), biometric_unlock());
        assert!(matches!(
            result,
            Err(ref error) if error == "Touch ID unlock is not configured for this vault."
        ));
        assert_eq!(
            status(&runtime).expect("status should be readable").status,
            "locked"
        );
    }

    #[test]
    fn biometric_settings_require_unlock_password_and_explicit_confirmation() {
        use std::cell::Cell;

        let directory = tempfile::tempdir().expect("temporary directory should exist");
        let runtime = VaultRuntime::default();
        let password = "correct horse battery staple";
        create_at(&runtime, directory.path(), create_request(password))
            .expect("vault should be created");

        let stored = Cell::new(false);
        let rejected = enable_biometric_with(
            &runtime,
            directory.path(),
            enable_biometric_request(password, false),
            |_, _| {
                stored.set(true);
                Ok(())
            },
            |_| {},
        );
        assert!(matches!(
            rejected,
            Err(ref error) if error.contains("Explicit confirmation")
        ));
        assert!(!stored.get());

        let wrong_password = enable_biometric_with(
            &runtime,
            directory.path(),
            enable_biometric_request("incorrect password value", true),
            |_, _| {
                stored.set(true);
                Ok(())
            },
            |_| {},
        );
        assert!(matches!(
            wrong_password,
            Err(ref error) if error == "Vault password is invalid."
        ));
        assert!(!stored.get());

        lock(&runtime, None).expect("vault should lock");
        let locked = enable_biometric_with(
            &runtime,
            directory.path(),
            enable_biometric_request(password, true),
            |_, _| {
                stored.set(true);
                Ok(())
            },
            |_| {},
        );
        assert!(matches!(
            locked,
            Err(ref error) if error.contains("must be unlocked")
        ));
        assert!(!stored.get());
    }

    #[test]
    fn biometric_setting_can_be_enabled_and_removed_without_exposing_the_dek() {
        use std::cell::Cell;

        let directory = tempfile::tempdir().expect("temporary directory should exist");
        let runtime = VaultRuntime::default();
        let password = "correct horse battery staple";
        create_at(&runtime, directory.path(), create_request(password))
            .expect("vault should be created");

        let stored_key_length = Cell::new(0_usize);
        let enabled = enable_biometric_with(
            &runtime,
            directory.path(),
            enable_biometric_request(password, true),
            |vault_id, key| {
                assert_eq!(vault_id, "vault-1");
                stored_key_length.set(key.len());
                Ok(())
            },
            |_| {},
        )
        .expect("Touch ID setting should enable");
        assert!(enabled.enabled);
        assert_eq!(stored_key_length.get(), 32);
        assert!(
            load_metadata(&metadata_path(directory.path(), "vault-1"))
                .expect("metadata should load")
                .biometric_enabled
        );

        let deleted = Cell::new(false);
        let wrong_password = disable_biometric_with(
            &runtime,
            directory.path(),
            disable_biometric_request("incorrect password value", true),
            |_| deleted.set(true),
        );
        assert!(matches!(
            wrong_password,
            Err(ref error) if error == "Vault password is invalid."
        ));
        assert!(!deleted.get());

        let disabled = disable_biometric_with(
            &runtime,
            directory.path(),
            disable_biometric_request(password, true),
            |vault_id| {
                assert_eq!(vault_id, "vault-1");
                deleted.set(true);
            },
        )
        .expect("Touch ID setting should disable");
        assert!(!disabled.enabled);
        assert!(deleted.get());
        assert!(
            !load_metadata(&metadata_path(directory.path(), "vault-1"))
                .expect("metadata should load")
                .biometric_enabled
        );
    }

    #[test]
    fn password_change_rewraps_the_same_dek_and_preserves_biometric_unlock() {
        let directory = tempfile::tempdir().expect("temporary directory should exist");
        let runtime = VaultRuntime::default();
        let current_password = "correct horse battery staple";
        let new_password = "new private password for folio";
        create_at(&runtime, directory.path(), create_request(current_password))
            .expect("vault should be created");
        runtime
            .with_unlocked_connection(|_, connection| {
                connection
                    .execute_batch(
                        "
                        INSERT INTO accounts(
                          id, vault_id, institution_name, display_name,
                          account_type, currency, created_at
                        ) VALUES (
                          'account-password-test', 'vault-1', 'Test Bank',
                          'Private Account', 'cash', 'CNY',
                          '2026-07-27T00:00:00.000Z'
                        );
                        INSERT INTO ledger_events(
                          id, vault_id, account_id, event_type, delta_minor,
                          currency, occurred_at, status, idempotency_key, created_at
                        ) VALUES (
                          'event-password-test', 'vault-1', 'account-password-test',
                          'opening_balance', 1280050, 'CNY',
                          '2026-07-27T00:00:00.000Z', 'confirmed',
                          'password-change:test',
                          '2026-07-27T00:00:00.000Z'
                        );
                        ",
                    )
                    .expect("financial fixture should insert");
                Ok(())
            })
            .expect("vault should be unlocked");

        let original_metadata =
            load_metadata(&metadata_path(directory.path(), "vault-1")).expect("metadata");
        let original_dek = unwrap_password_dek(
            "vault-1",
            current_password,
            &original_metadata.password_wrapped_dek,
        )
        .expect("current password should unwrap");
        enable_biometric_with(
            &runtime,
            directory.path(),
            enable_biometric_request(current_password, true),
            |_, key| {
                assert_eq!(key, original_dek.as_ref());
                Ok(())
            },
            |_| {},
        )
        .expect("biometric should enable");

        let changed = change_password_at(
            &runtime,
            directory.path(),
            change_password_request(current_password, new_password, true),
        )
        .expect("password should change");
        assert_eq!(changed.status, "changed");
        assert!(changed.biometric_enabled);

        let next_metadata =
            load_metadata(&metadata_path(directory.path(), "vault-1")).expect("metadata");
        assert!(next_metadata.biometric_enabled);
        assert!(next_metadata.password_changed_at.is_some());
        assert!(unwrap_password_dek(
            "vault-1",
            current_password,
            &next_metadata.password_wrapped_dek
        )
        .is_err());
        assert_eq!(
            unwrap_password_dek("vault-1", new_password, &next_metadata.password_wrapped_dek)
                .expect("new password should unwrap")
                .as_ref(),
            original_dek.as_ref()
        );
        runtime
            .with_unlocked_connection(|_, connection| {
                let count: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM audit_events
                         WHERE action = 'vault_password_changed'",
                        [],
                        |row| row.get(0),
                    )
                    .expect("audit should exist");
                assert_eq!(count, 1);
                Ok(())
            })
            .expect("vault should remain unlocked");

        lock(&runtime, None).expect("vault should lock");
        assert!(unlock_at(
            &runtime,
            directory.path(),
            password_unlock(current_password)
        )
        .is_err());
        unlock_at(&runtime, directory.path(), password_unlock(new_password))
            .expect("new password should unlock the existing database");
        runtime
            .with_unlocked_connection(|_, connection| {
                let balance: i64 = connection
                    .query_row(
                        "SELECT balance_minor FROM account_balances
                         WHERE account_id = 'account-password-test'",
                        [],
                        |row| row.get(0),
                    )
                    .expect("existing financial data should remain readable");
                assert_eq!(balance, 1_280_050);
                Ok(())
            })
            .expect("rotated password should preserve financial data");
    }

    #[test]
    fn password_change_requires_confirmation_and_correct_current_password() {
        let directory = tempfile::tempdir().expect("temporary directory should exist");
        let runtime = VaultRuntime::default();
        let current_password = "correct horse battery staple";
        let new_password = "new private password for folio";
        create_at(&runtime, directory.path(), create_request(current_password))
            .expect("vault should be created");
        let path = metadata_path(directory.path(), "vault-1");
        let before = fs::read(&path).expect("metadata should read");

        assert!(change_password_at(
            &runtime,
            directory.path(),
            change_password_request(current_password, new_password, false),
        )
        .is_err());
        assert_eq!(fs::read(&path).expect("metadata should read"), before);

        assert!(change_password_at(
            &runtime,
            directory.path(),
            change_password_request("incorrect password value", new_password, true),
        )
        .is_err());
        assert_eq!(fs::read(&path).expect("metadata should read"), before);

        assert!(change_password_at(
            &runtime,
            directory.path(),
            change_password_request(current_password, current_password, true),
        )
        .is_err());
        assert_eq!(fs::read(&path).expect("metadata should read"), before);
    }

    #[test]
    fn rejects_unsafe_identifiers_and_short_passwords() {
        assert!(validate_vault_id("../escape").is_err());
        assert!(validate_vault_id("vault/escape").is_err());
        assert!(validate_password("too-short".to_owned()).is_err());
    }

    #[test]
    fn repeated_failures_activate_unlock_cooldown() {
        let directory = tempfile::tempdir().expect("temporary directory should exist");
        let runtime = VaultRuntime::default();
        create_at(
            &runtime,
            directory.path(),
            create_request("correct horse battery staple"),
        )
        .expect("vault should be created");
        lock(&runtime, None).expect("vault should lock");

        for _ in 0..MAX_FAILED_ATTEMPTS {
            assert!(unlock_at(
                &runtime,
                directory.path(),
                password_unlock("incorrect password value")
            )
            .is_err());
        }
        assert_eq!(
            ensure_can_attempt_unlock(&runtime).unwrap_err(),
            "Too many failed attempts. Try again later."
        );
    }
}
