use crate::vault::VaultRuntime;
use getrandom::fill;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::json;

const MAX_SAFE_MINOR: i128 = 9_000_000_000_000_000;
const ACCOUNT_TYPES: [&str; 8] = [
    "cash",
    "savings",
    "investment",
    "fund",
    "insurance",
    "property",
    "liability",
    "other",
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAccountDraftRequest {
    institution_name: String,
    display_name: String,
    account_type: String,
    currency: String,
    masked_identifier: Option<String>,
    opening_balance: String,
    balance_date: String,
    notes: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAccountDraftRequest {
    account_id: String,
    institution_name: String,
    display_name: String,
    account_type: String,
    masked_identifier: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveAccountDraftRequest {
    account_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmAccountDraftRequest {
    draft_id: String,
    confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectAccountDraftRequest {
    draft_id: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountCreateDraftPayload {
    kind: String,
    account_id: String,
    opening_event_id: String,
    institution_name: String,
    display_name: String,
    account_type: String,
    currency: String,
    masked_identifier: Option<String>,
    opening_balance_minor: i64,
    balance_date: String,
    notes: Option<String>,
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountProfile {
    institution_name: String,
    display_name: String,
    account_type: String,
    currency: String,
    masked_identifier: Option<String>,
    notes: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountUpdateDraftPayload {
    kind: String,
    account_id: String,
    before: AccountProfile,
    after: AccountProfile,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountArchiveDraftPayload {
    kind: String,
    account_id: String,
    profile: AccountProfile,
    balance_minor_at_review: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountDraftHeader {
    kind: String,
    account_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountDraftResponse {
    draft_id: String,
    action: &'static str,
    account_id: String,
    institution_name: String,
    display_name: String,
    account_type: String,
    currency: String,
    masked_identifier: Option<String>,
    opening_balance_minor: Option<i64>,
    balance_date: Option<String>,
    notes: Option<String>,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountConfirmationResponse {
    draft_id: String,
    account_id: String,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRejectionResponse {
    draft_id: String,
    status: &'static str,
}

fn random_id(prefix: &str) -> Result<String, String> {
    let mut bytes = [0_u8; 16];
    fill(&mut bytes).map_err(|_| "Unable to create a secure record identifier.".to_owned())?;
    Ok(format!("{prefix}_{}", hex::encode(bytes)))
}

fn required_text(value: String, field: &str, maximum: usize) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() || normalized.chars().count() > maximum {
        return Err(format!("{field} must contain 1 to {maximum} characters."));
    }
    Ok(normalized.to_owned())
}

fn optional_text(
    value: Option<String>,
    field: &str,
    maximum: usize,
) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let normalized = value.trim();
    if normalized.is_empty() {
        return Ok(None);
    }
    if normalized.chars().count() > maximum {
        return Err(format!("{field} must not exceed {maximum} characters."));
    }
    Ok(Some(normalized.to_owned()))
}

fn normalize_currency(value: String) -> Result<String, String> {
    let currency = value.trim().to_ascii_uppercase();
    if currency.len() != 3 || !currency.bytes().all(|byte| byte.is_ascii_uppercase()) {
        return Err("Currency must be a three-letter ISO code.".to_owned());
    }
    Ok(currency)
}

fn normalize_account_type(value: String) -> Result<String, String> {
    let account_type = value.trim().to_ascii_lowercase();
    if !ACCOUNT_TYPES.contains(&account_type.as_str()) {
        return Err("Account type is not supported.".to_owned());
    }
    Ok(account_type)
}

fn normalize_masked_identifier(value: Option<String>) -> Result<Option<String>, String> {
    let value = optional_text(value, "Account identifier", 8)?;
    if let Some(identifier) = value.as_ref() {
        if !identifier
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            return Err("Account identifier may contain only letters, numbers, or '-'.".to_owned());
        }
    }
    Ok(value)
}

fn parse_minor(value: &str) -> Result<i64, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("Opening balance is required.".to_owned());
    }
    let (negative, unsigned) = match value.strip_prefix('-') {
        Some(unsigned) => (true, unsigned),
        None => (false, value),
    };
    let mut parts = unsigned.split('.');
    let major = parts.next().unwrap_or_default();
    let fraction = parts.next();
    if parts.next().is_some()
        || major.is_empty()
        || !major.bytes().all(|byte| byte.is_ascii_digit())
        || fraction
            .is_some_and(|part| part.len() > 2 || !part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err("Opening balance must be a number with at most two decimal places.".to_owned());
    }
    let major: i128 = major
        .parse()
        .map_err(|_| "Opening balance is outside the supported range.".to_owned())?;
    let fraction = match fraction.unwrap_or_default() {
        "" => 0_i128,
        value if value.len() == 1 => value
            .parse::<i128>()
            .map(|number| number * 10)
            .map_err(|_| "Opening balance is invalid.".to_owned())?,
        value => value
            .parse::<i128>()
            .map_err(|_| "Opening balance is invalid.".to_owned())?,
    };
    let unsigned_minor = major
        .checked_mul(100)
        .and_then(|number| number.checked_add(fraction))
        .ok_or_else(|| "Opening balance is outside the supported range.".to_owned())?;
    let minor = if negative {
        -unsigned_minor
    } else {
        unsigned_minor
    };
    if minor.abs() > MAX_SAFE_MINOR {
        return Err("Opening balance is outside the supported range.".to_owned());
    }
    i64::try_from(minor).map_err(|_| "Opening balance is outside the supported range.".to_owned())
}

fn validate_date(connection: &Connection, value: String) -> Result<String, String> {
    let value = value.trim().to_owned();
    let valid: bool = connection
        .query_row("SELECT COALESCE(date(?1) = ?1, 0)", [&value], |row| {
            row.get(0)
        })
        .map_err(|_| "Unable to validate the balance date.".to_owned())?;
    if !valid {
        return Err("Balance date must be a valid YYYY-MM-DD date.".to_owned());
    }
    Ok(value)
}

fn create_draft_response(
    draft_id: String,
    payload: AccountCreateDraftPayload,
) -> AccountDraftResponse {
    AccountDraftResponse {
        draft_id,
        action: "create",
        account_id: payload.account_id,
        institution_name: payload.institution_name,
        display_name: payload.display_name,
        account_type: payload.account_type,
        currency: payload.currency,
        masked_identifier: payload.masked_identifier,
        opening_balance_minor: Some(payload.opening_balance_minor),
        balance_date: Some(payload.balance_date),
        notes: payload.notes,
        status: "needs_review",
    }
}

fn update_draft_response(
    draft_id: String,
    payload: AccountUpdateDraftPayload,
) -> AccountDraftResponse {
    AccountDraftResponse {
        draft_id,
        action: "update",
        account_id: payload.account_id,
        institution_name: payload.after.institution_name,
        display_name: payload.after.display_name,
        account_type: payload.after.account_type,
        currency: payload.after.currency,
        masked_identifier: payload.after.masked_identifier,
        opening_balance_minor: None,
        balance_date: None,
        notes: payload.after.notes,
        status: "needs_review",
    }
}

fn archive_draft_response(
    draft_id: String,
    payload: AccountArchiveDraftPayload,
) -> AccountDraftResponse {
    AccountDraftResponse {
        draft_id,
        action: "archive",
        account_id: payload.account_id,
        institution_name: payload.profile.institution_name,
        display_name: payload.profile.display_name,
        account_type: payload.profile.account_type,
        currency: payload.profile.currency,
        masked_identifier: payload.profile.masked_identifier,
        opening_balance_minor: Some(payload.balance_minor_at_review),
        balance_date: None,
        notes: payload.profile.notes,
        status: "needs_review",
    }
}

fn account_profile(
    connection: &Connection,
    vault_id: &str,
    account_id: &str,
) -> Result<AccountProfile, String> {
    connection
        .query_row(
            "SELECT institution_name, display_name, account_type, currency,
                    masked_identifier, notes
             FROM accounts
             WHERE id = ?1 AND vault_id = ?2 AND archived_at IS NULL",
            params![account_id, vault_id],
            |row| {
                Ok(AccountProfile {
                    institution_name: row.get(0)?,
                    display_name: row.get(1)?,
                    account_type: row.get(2)?,
                    currency: row.get(3)?,
                    masked_identifier: row.get(4)?,
                    notes: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(|_| "Unable to read the account.".to_owned())?
        .ok_or_else(|| "The account does not exist or is already archived.".to_owned())
}

fn account_sync_snapshot(
    connection: &Connection,
    vault_id: &str,
    account_id: &str,
) -> Result<serde_json::Value, String> {
    connection
        .query_row(
            "SELECT id, institution_name, display_name, account_type, currency,
                    masked_identifier, notes, created_at, archived_at
             FROM accounts WHERE id = ?1 AND vault_id = ?2",
            params![account_id, vault_id],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "institutionName": row.get::<_, String>(1)?,
                    "displayName": row.get::<_, String>(2)?,
                    "accountType": row.get::<_, String>(3)?,
                    "currency": row.get::<_, String>(4)?,
                    "maskedIdentifier": row.get::<_, Option<String>>(5)?,
                    "notes": row.get::<_, Option<String>>(6)?,
                    "createdAt": row.get::<_, String>(7)?,
                    "archivedAt": row.get::<_, Option<String>>(8)?,
                }))
            },
        )
        .optional()
        .map_err(|_| "Unable to read the account sync snapshot.".to_owned())?
        .ok_or_else(|| "The account sync snapshot does not exist.".to_owned())
}

fn account_balance(
    connection: &Connection,
    vault_id: &str,
    account_id: &str,
) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT COALESCE(SUM(balance_minor), 0)
             FROM account_balances
             WHERE vault_id = ?1 AND account_id = ?2",
            params![vault_id, account_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to read the account balance.".to_owned())
}

fn active_holding_count(
    connection: &Connection,
    vault_id: &str,
    account_id: &str,
) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT count(*) FROM holdings
             WHERE vault_id = ?1 AND account_id = ?2 AND archived_at IS NULL",
            params![vault_id, account_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to read the account holding status.".to_owned())
}

fn account_name_exists(
    connection: &Connection,
    vault_id: &str,
    institution_name: &str,
    display_name: &str,
    excluded_account_id: Option<&str>,
) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM accounts
                WHERE vault_id = ?1
                  AND institution_name = ?2
                  AND display_name = ?3
                  AND (?4 IS NULL OR id <> ?4)
            )",
            params![
                vault_id,
                institution_name,
                display_name,
                excluded_account_id
            ],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to check existing accounts.".to_owned())
}

fn insert_account_draft(
    connection: &Connection,
    vault_id: &str,
    draft_id: &str,
    proposed: &str,
    action: &str,
) -> Result<(), String> {
    let evidence = json!([{
        "source": "manual_entry",
        "action": action,
        "reviewRequired": true
    }])
    .to_string();
    connection
        .execute(
            "INSERT INTO draft_changes(
                id, vault_id, source_type, source_fingerprint, status,
                proposed_events_json, evidence_json, created_at
             ) VALUES (
                ?1, ?2, 'manual_account', ?1, 'needs_review',
                ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![draft_id, vault_id, proposed, evidence],
        )
        .map_err(|_| "Unable to save the account review draft.".to_owned())?;
    Ok(())
}

pub(crate) fn create_account_draft_at(
    runtime: &VaultRuntime,
    request: CreateAccountDraftRequest,
) -> Result<AccountDraftResponse, String> {
    runtime.with_unlocked_connection(|vault_id, connection| {
        let institution_name = required_text(request.institution_name, "Institution name", 80)?;
        let display_name = required_text(request.display_name, "Account name", 80)?;
        let account_type = normalize_account_type(request.account_type)?;
        let currency = normalize_currency(request.currency)?;
        let masked_identifier = normalize_masked_identifier(request.masked_identifier)?;
        let opening_balance_minor = parse_minor(&request.opening_balance)?;
        let balance_date = validate_date(connection, request.balance_date)?;
        let notes = optional_text(request.notes, "Notes", 1000)?;

        let duplicate =
            account_name_exists(connection, vault_id, &institution_name, &display_name, None)?;
        if duplicate {
            return Err("An account with this institution and name already exists.".to_owned());
        }

        let draft_id = random_id("draft")?;
        let payload = AccountCreateDraftPayload {
            kind: "account.create".to_owned(),
            account_id: random_id("account")?,
            opening_event_id: random_id("event")?,
            institution_name,
            display_name,
            account_type,
            currency,
            masked_identifier,
            opening_balance_minor,
            balance_date,
            notes,
        };
        let proposed = serde_json::to_string(&payload)
            .map_err(|_| "Unable to serialize the account draft.".to_owned())?;
        insert_account_draft(connection, vault_id, &draft_id, &proposed, "create")?;

        Ok(create_draft_response(draft_id, payload))
    })
}

fn update_account_draft_at(
    runtime: &VaultRuntime,
    request: UpdateAccountDraftRequest,
) -> Result<AccountDraftResponse, String> {
    let account_id = required_text(request.account_id, "Account identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let before = account_profile(connection, vault_id, &account_id)?;
        let after = AccountProfile {
            institution_name: required_text(request.institution_name, "Institution name", 80)?,
            display_name: required_text(request.display_name, "Account name", 80)?,
            account_type: normalize_account_type(request.account_type)?,
            currency: before.currency.clone(),
            masked_identifier: normalize_masked_identifier(request.masked_identifier)?,
            notes: optional_text(request.notes, "Notes", 1000)?,
        };
        if before == after {
            return Err("No account changes were provided.".to_owned());
        }
        if account_name_exists(
            connection,
            vault_id,
            &after.institution_name,
            &after.display_name,
            Some(&account_id),
        )? {
            return Err("An account with this institution and name already exists.".to_owned());
        }

        let draft_id = random_id("draft")?;
        let payload = AccountUpdateDraftPayload {
            kind: "account.update".to_owned(),
            account_id,
            before,
            after,
        };
        let proposed = serde_json::to_string(&payload)
            .map_err(|_| "Unable to serialize the account update draft.".to_owned())?;
        insert_account_draft(connection, vault_id, &draft_id, &proposed, "update")?;
        Ok(update_draft_response(draft_id, payload))
    })
}

fn archive_account_draft_at(
    runtime: &VaultRuntime,
    request: ArchiveAccountDraftRequest,
) -> Result<AccountDraftResponse, String> {
    let account_id = required_text(request.account_id, "Account identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let profile = account_profile(connection, vault_id, &account_id)?;
        let balance_minor = account_balance(connection, vault_id, &account_id)?;
        if balance_minor != 0 {
            return Err(
                "A non-zero account cannot be archived. Reconcile or transfer its balance first."
                    .to_owned(),
            );
        }
        if active_holding_count(connection, vault_id, &account_id)? != 0 {
            return Err(
                "An account with active holdings cannot be archived. Archive its holdings first."
                    .to_owned(),
            );
        }
        let draft_id = random_id("draft")?;
        let payload = AccountArchiveDraftPayload {
            kind: "account.archive".to_owned(),
            account_id,
            profile,
            balance_minor_at_review: balance_minor,
        };
        let proposed = serde_json::to_string(&payload)
            .map_err(|_| "Unable to serialize the account archive draft.".to_owned())?;
        insert_account_draft(connection, vault_id, &draft_id, &proposed, "archive")?;
        Ok(archive_draft_response(draft_id, payload))
    })
}

fn append_account_audit(
    connection: &Connection,
    vault_id: &str,
    action: &str,
    account_id: &str,
    metadata: serde_json::Value,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO audit_events(
                id, vault_id, category, action, actor_id,
                object_type, object_id, metadata_json, occurred_at
             ) VALUES (
                ?1, ?2, 'data', ?3, 'local_user',
                'account', ?4, ?5,
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![
                random_id("audit")?,
                vault_id,
                action,
                account_id,
                metadata.to_string()
            ],
        )
        .map_err(|_| "Unable to append the account audit event.".to_owned())?;
    Ok(())
}

fn confirm_account_create(
    connection: &Connection,
    vault_id: &str,
    draft_id: &str,
    payload: &AccountCreateDraftPayload,
) -> Result<(), String> {
    if account_name_exists(
        connection,
        vault_id,
        &payload.institution_name,
        &payload.display_name,
        None,
    )? {
        return Err("An account with this institution and name already exists.".to_owned());
    }
    connection
        .execute(
            "INSERT INTO accounts(
                id, vault_id, institution_name, display_name, account_type,
                currency, masked_identifier, notes, created_at
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![
                payload.account_id,
                vault_id,
                payload.institution_name,
                payload.display_name,
                payload.account_type,
                payload.currency,
                payload.masked_identifier,
                payload.notes
            ],
        )
        .map_err(|_| "Unable to create the encrypted account.".to_owned())?;

    let occurred_at = format!("{}T00:00:00.000Z", payload.balance_date);
    let event_metadata = json!({
        "source": "manual_account",
        "balanceDate": payload.balance_date
    })
    .to_string();
    connection
        .execute(
            "INSERT INTO ledger_events(
                id, vault_id, account_id, draft_id, event_type, delta_minor,
                currency, occurred_at, status, idempotency_key,
                metadata_json, created_at
             ) VALUES (
                ?1, ?2, ?3, ?4, 'opening_balance', ?5, ?6, ?7,
                'confirmed', ?8, ?9,
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![
                payload.opening_event_id,
                vault_id,
                payload.account_id,
                draft_id,
                payload.opening_balance_minor,
                payload.currency,
                occurred_at,
                format!("manual-account:{draft_id}:opening"),
                event_metadata
            ],
        )
        .map_err(|_| "Unable to append the opening balance event.".to_owned())?;
    let after = account_sync_snapshot(connection, vault_id, &payload.account_id)?;
    append_account_audit(
        connection,
        vault_id,
        "account_created",
        &payload.account_id,
        json!({
            "source": "manual_entry",
            "before": null,
            "after": after
        }),
    )
}

fn confirm_account_update(
    connection: &Connection,
    vault_id: &str,
    payload: &AccountUpdateDraftPayload,
) -> Result<(), String> {
    let current = account_profile(connection, vault_id, &payload.account_id)?;
    let before_snapshot = account_sync_snapshot(connection, vault_id, &payload.account_id)?;
    if current != payload.before {
        return Err(
            "The account changed after review. Create a new review draft before confirming."
                .to_owned(),
        );
    }
    if account_name_exists(
        connection,
        vault_id,
        &payload.after.institution_name,
        &payload.after.display_name,
        Some(&payload.account_id),
    )? {
        return Err("An account with this institution and name already exists.".to_owned());
    }
    connection
        .execute(
            "UPDATE accounts
             SET institution_name = ?1,
                 display_name = ?2,
                 account_type = ?3,
                 masked_identifier = ?4,
                 notes = ?5
             WHERE id = ?6 AND vault_id = ?7 AND archived_at IS NULL",
            params![
                payload.after.institution_name,
                payload.after.display_name,
                payload.after.account_type,
                payload.after.masked_identifier,
                payload.after.notes,
                payload.account_id,
                vault_id
            ],
        )
        .map_err(|_| "Unable to update the encrypted account.".to_owned())?;
    let after_snapshot = account_sync_snapshot(connection, vault_id, &payload.account_id)?;
    append_account_audit(
        connection,
        vault_id,
        "account_updated",
        &payload.account_id,
        json!({
            "source": "manual_entry",
            "before": before_snapshot,
            "after": after_snapshot
        }),
    )
}

fn confirm_account_archive(
    connection: &Connection,
    vault_id: &str,
    payload: &AccountArchiveDraftPayload,
) -> Result<(), String> {
    let current = account_profile(connection, vault_id, &payload.account_id)?;
    let before_snapshot = account_sync_snapshot(connection, vault_id, &payload.account_id)?;
    if current != payload.profile {
        return Err(
            "The account changed after review. Create a new archive draft before confirming."
                .to_owned(),
        );
    }
    if account_balance(connection, vault_id, &payload.account_id)? != 0 {
        return Err(
            "A non-zero account cannot be archived. Reconcile or transfer its balance first."
                .to_owned(),
        );
    }
    if active_holding_count(connection, vault_id, &payload.account_id)? != 0 {
        return Err(
            "An account with active holdings cannot be archived. Archive its holdings first."
                .to_owned(),
        );
    }
    let updated = connection
        .execute(
            "UPDATE accounts
             SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1 AND vault_id = ?2 AND archived_at IS NULL",
            params![payload.account_id, vault_id],
        )
        .map_err(|_| "Unable to archive the encrypted account.".to_owned())?;
    if updated != 1 {
        return Err("The account is no longer available for archiving.".to_owned());
    }
    let after_snapshot = account_sync_snapshot(connection, vault_id, &payload.account_id)?;
    append_account_audit(
        connection,
        vault_id,
        "account_archived",
        &payload.account_id,
        json!({
            "source": "manual_entry",
            "before": before_snapshot,
            "after": after_snapshot,
            "balanceMinorAtReview": payload.balance_minor_at_review
        }),
    )
}

pub(crate) fn confirm_account_draft_at(
    runtime: &VaultRuntime,
    request: ConfirmAccountDraftRequest,
) -> Result<AccountConfirmationResponse, String> {
    if !request.confirmed_by_user {
        return Err("Explicit user confirmation is required.".to_owned());
    }
    let draft_id = required_text(request.draft_id, "Draft identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let row: Option<(String, String)> = connection
            .query_row(
                "SELECT status, proposed_events_json
                 FROM draft_changes
                 WHERE id = ?1 AND vault_id = ?2 AND source_type = 'manual_account'",
                params![draft_id, vault_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| "Unable to read the account draft.".to_owned())?;
        let Some((status, proposed)) = row else {
            return Err("The account draft does not exist.".to_owned());
        };
        let header: AccountDraftHeader = serde_json::from_str(&proposed)
            .map_err(|_| "The account draft is invalid.".to_owned())?;
        if status == "confirmed" {
            return Ok(AccountConfirmationResponse {
                draft_id,
                account_id: header.account_id,
                status: "confirmed",
            });
        }
        if status != "needs_review" {
            return Err("The account draft is no longer available for confirmation.".to_owned());
        }

        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "Unable to start the account confirmation transaction.".to_owned())?;
        match header.kind.as_str() {
            "account.create" => {
                let payload: AccountCreateDraftPayload = serde_json::from_str(&proposed)
                    .map_err(|_| "The account creation draft is invalid.".to_owned())?;
                confirm_account_create(&transaction, vault_id, &draft_id, &payload)?;
            }
            "account.update" => {
                let payload: AccountUpdateDraftPayload = serde_json::from_str(&proposed)
                    .map_err(|_| "The account update draft is invalid.".to_owned())?;
                confirm_account_update(&transaction, vault_id, &payload)?;
            }
            "account.archive" => {
                let payload: AccountArchiveDraftPayload = serde_json::from_str(&proposed)
                    .map_err(|_| "The account archive draft is invalid.".to_owned())?;
                confirm_account_archive(&transaction, vault_id, &payload)?;
            }
            _ => return Err("The account draft type is invalid.".to_owned()),
        }

        let updated = transaction
            .execute(
                "UPDATE draft_changes
                 SET status = 'confirmed',
                     confirmed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                     confirmed_by = 'local_user'
                 WHERE id = ?1 AND vault_id = ?2 AND status = 'needs_review'",
                params![draft_id, vault_id],
            )
            .map_err(|_| "Unable to confirm the account draft.".to_owned())?;
        if updated != 1 {
            return Err("The account draft changed before confirmation.".to_owned());
        }
        transaction
            .commit()
            .map_err(|_| "Unable to commit the account confirmation.".to_owned())?;
        Ok(AccountConfirmationResponse {
            draft_id,
            account_id: header.account_id,
            status: "confirmed",
        })
    })
}

fn reject_account_draft_at(
    runtime: &VaultRuntime,
    request: RejectAccountDraftRequest,
) -> Result<AccountRejectionResponse, String> {
    let draft_id = required_text(request.draft_id, "Draft identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let status: Option<String> = connection
            .query_row(
                "SELECT status FROM draft_changes
                 WHERE id = ?1 AND vault_id = ?2 AND source_type = 'manual_account'",
                params![draft_id, vault_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| "Unable to read the account draft.".to_owned())?;
        match status.as_deref() {
            None => return Err("The account draft does not exist.".to_owned()),
            Some("confirmed") => {
                return Err("A confirmed account draft cannot be rejected.".to_owned())
            }
            Some("rejected") => {
                return Ok(AccountRejectionResponse {
                    draft_id,
                    status: "rejected",
                })
            }
            Some("needs_review") => {}
            _ => return Err("The account draft state is invalid.".to_owned()),
        }

        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "Unable to start the draft rejection transaction.".to_owned())?;
        transaction
            .execute(
                "UPDATE draft_changes
                 SET status = 'rejected',
                     rejected_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                     rejection_reason = 'user_cancelled'
                 WHERE id = ?1 AND vault_id = ?2 AND status = 'needs_review'",
                params![draft_id, vault_id],
            )
            .map_err(|_| "Unable to reject the account draft.".to_owned())?;
        transaction
            .execute(
                "INSERT INTO audit_events(
                    id, vault_id, category, action, actor_id,
                    object_type, object_id, metadata_json, occurred_at
                 ) VALUES (
                    ?1, ?2, 'data', 'account_draft_rejected', 'local_user',
                    'draft_change', ?3, '{}',
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![random_id("audit")?, vault_id, draft_id],
            )
            .map_err(|_| "Unable to append the draft rejection audit event.".to_owned())?;
        transaction
            .commit()
            .map_err(|_| "Unable to commit the draft rejection.".to_owned())?;

        Ok(AccountRejectionResponse {
            draft_id,
            status: "rejected",
        })
    })
}

pub(crate) fn account_snapshot(
    connection: &Connection,
    vault_id: &str,
) -> Result<(Vec<serde_json::Value>, Vec<serde_json::Value>), String> {
    let mut statement = connection
        .prepare(
            "SELECT
                a.id, a.institution_name, a.display_name, a.account_type,
                a.currency, a.masked_identifier, a.notes, a.created_at,
                COALESCE(b.balance_minor, 0), b.last_event_at,
                (SELECT count(*) FROM holdings h
                 WHERE h.vault_id = a.vault_id
                   AND h.account_id = a.id
                   AND h.archived_at IS NULL)
             FROM accounts a
             LEFT JOIN account_balances b
               ON b.vault_id = a.vault_id
              AND b.account_id = a.id
              AND b.currency = a.currency
             WHERE a.vault_id = ?1 AND a.archived_at IS NULL
             ORDER BY a.created_at, a.id",
        )
        .map_err(|_| "Unable to prepare the encrypted account snapshot.".to_owned())?;
    let rows = statement
        .query_map([vault_id], |row| {
            let id: String = row.get(0)?;
            let currency: String = row.get(4)?;
            let balance_minor: i64 = row.get(8)?;
            let last_event_at: Option<String> = row.get(9)?;
            let active_holding_count: i64 = row.get(10)?;
            Ok((
                json!({
                    "id": id,
                    "institutionName": row.get::<_, String>(1)?,
                    "displayName": row.get::<_, String>(2)?,
                    "accountType": row.get::<_, String>(3)?,
                    "currency": currency,
                    "maskedIdentifier": row.get::<_, Option<String>>(5)?,
                    "notes": row.get::<_, Option<String>>(6)?,
                    "createdAt": row.get::<_, String>(7)?,
                    "balanceMinor": balance_minor,
                    "lastEventAt": last_event_at,
                    "activeHoldingCount": active_holding_count
                }),
                json!({
                    "accountId": id,
                    "currency": currency,
                    "balanceMinor": balance_minor,
                    "lastEventAt": last_event_at
                }),
            ))
        })
        .map_err(|_| "Unable to read encrypted accounts.".to_owned())?;
    let mut accounts = Vec::new();
    let mut balances = Vec::new();
    for row in rows {
        let (account, balance) =
            row.map_err(|_| "Unable to decode the encrypted account snapshot.".to_owned())?;
        accounts.push(account);
        balances.push(balance);
    }
    Ok((accounts, balances))
}

#[tauri::command]
pub fn account_create_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: CreateAccountDraftRequest,
) -> Result<AccountDraftResponse, String> {
    create_account_draft_at(&runtime, request)
}

#[tauri::command]
pub fn account_update_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: UpdateAccountDraftRequest,
) -> Result<AccountDraftResponse, String> {
    update_account_draft_at(&runtime, request)
}

#[tauri::command]
pub fn account_archive_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: ArchiveAccountDraftRequest,
) -> Result<AccountDraftResponse, String> {
    archive_account_draft_at(&runtime, request)
}

#[tauri::command]
pub fn account_confirm_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: ConfirmAccountDraftRequest,
) -> Result<AccountConfirmationResponse, String> {
    confirm_account_draft_at(&runtime, request)
}

#[tauri::command]
pub fn account_reject_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: RejectAccountDraftRequest,
) -> Result<AccountRejectionResponse, String> {
    reject_account_draft_at(&runtime, request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::open_encrypted;

    fn runtime_with_vault() -> (tempfile::TempDir, VaultRuntime) {
        let directory = tempfile::tempdir().expect("temporary directory should exist");
        let connection = open_encrypted(&directory.path().join("accounts.sqlite3"), &[23_u8; 32])
            .expect("encrypted database should open");
        connection
            .execute(
                "INSERT INTO vaults(id, display_name, base_currency, created_at)
                 VALUES ('vault-1', 'Test vault', 'CNY', '2026-07-26T00:00:00.000Z')",
                [],
            )
            .expect("vault fixture should insert");
        let runtime = VaultRuntime::default();
        runtime.install_test_session("vault-1", connection);
        (directory, runtime)
    }

    fn request() -> CreateAccountDraftRequest {
        CreateAccountDraftRequest {
            institution_name: "招商银行".to_owned(),
            display_name: "日常账户".to_owned(),
            account_type: "cash".to_owned(),
            currency: "cny".to_owned(),
            masked_identifier: Some("3619".to_owned()),
            opening_balance: "128500.32".to_owned(),
            balance_date: "2026-07-25".to_owned(),
            notes: Some("仅用于测试的虚构账户".to_owned()),
        }
    }

    fn confirm_created_account(
        runtime: &VaultRuntime,
        request: CreateAccountDraftRequest,
    ) -> String {
        let draft =
            create_account_draft_at(runtime, request).expect("account draft should be created");
        confirm_account_draft_at(
            runtime,
            ConfirmAccountDraftRequest {
                draft_id: draft.draft_id,
                confirmed_by_user: true,
            },
        )
        .expect("account draft should confirm")
        .account_id
    }

    #[test]
    fn money_parser_is_exact_and_rejects_unsafe_values() {
        assert_eq!(parse_minor("128500.32").unwrap(), 12_850_032);
        assert_eq!(parse_minor("-0.5").unwrap(), -50);
        assert!(parse_minor("0.001").is_err());
        assert!(parse_minor("1e6").is_err());
        assert!(parse_minor("90000000000000.01").is_err());
    }

    #[test]
    fn account_requires_review_before_atomic_confirmation() {
        let (_directory, runtime) = runtime_with_vault();
        let draft = create_account_draft_at(&runtime, request()).expect("draft should be created");
        runtime
            .with_unlocked_connection(|_, connection| {
                let before: i64 = connection
                    .query_row("SELECT count(*) FROM accounts", [], |row| row.get(0))
                    .unwrap();
                assert_eq!(before, 0);
                Ok(())
            })
            .unwrap();

        assert!(confirm_account_draft_at(
            &runtime,
            ConfirmAccountDraftRequest {
                draft_id: draft.draft_id.clone(),
                confirmed_by_user: false,
            }
        )
        .is_err());

        let confirmed = confirm_account_draft_at(
            &runtime,
            ConfirmAccountDraftRequest {
                draft_id: draft.draft_id.clone(),
                confirmed_by_user: true,
            },
        )
        .expect("draft should confirm");
        assert_eq!(confirmed.status, "confirmed");

        runtime
            .with_unlocked_connection(|_, connection| {
                let balance: i64 = connection
                    .query_row(
                        "SELECT balance_minor FROM account_balances
                         WHERE account_id = ?1",
                        [&confirmed.account_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(balance, 12_850_032);
                let audit_count: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM audit_events
                         WHERE object_id = ?1 AND action = 'account_created'",
                        [&confirmed.account_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(audit_count, 1);
                let (accounts, balances) =
                    account_snapshot(connection, "vault-1").expect("snapshot should load");
                assert_eq!(accounts.len(), 1);
                assert_eq!(accounts[0]["displayName"], "日常账户");
                assert_eq!(accounts[0]["balanceMinor"], 12_850_032);
                assert_eq!(balances[0]["balanceMinor"], 12_850_032);
                Ok(())
            })
            .unwrap();

        let retry = confirm_account_draft_at(
            &runtime,
            ConfirmAccountDraftRequest {
                draft_id: draft.draft_id,
                confirmed_by_user: true,
            },
        )
        .expect("confirmation retry should be idempotent");
        assert_eq!(retry.account_id, confirmed.account_id);
    }

    #[test]
    fn rejected_draft_never_creates_an_account() {
        let (_directory, runtime) = runtime_with_vault();
        let draft = create_account_draft_at(&runtime, request()).expect("draft should be created");
        reject_account_draft_at(
            &runtime,
            RejectAccountDraftRequest {
                draft_id: draft.draft_id.clone(),
            },
        )
        .expect("draft should reject");
        assert!(confirm_account_draft_at(
            &runtime,
            ConfirmAccountDraftRequest {
                draft_id: draft.draft_id,
                confirmed_by_user: true,
            }
        )
        .is_err());
        runtime
            .with_unlocked_connection(|_, connection| {
                let count: i64 = connection
                    .query_row("SELECT count(*) FROM accounts", [], |row| row.get(0))
                    .unwrap();
                assert_eq!(count, 0);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn account_profile_update_requires_review_and_preserves_ledger_balance() {
        let (_directory, runtime) = runtime_with_vault();
        let account_id = confirm_created_account(&runtime, request());
        let draft = update_account_draft_at(
            &runtime,
            UpdateAccountDraftRequest {
                account_id: account_id.clone(),
                institution_name: "招商银行".to_owned(),
                display_name: "家庭日常账户".to_owned(),
                account_type: "savings".to_owned(),
                masked_identifier: Some("7788".to_owned()),
                notes: Some("更新后的虚构备注".to_owned()),
            },
        )
        .expect("update draft should be created");

        runtime
            .with_unlocked_connection(|_, connection| {
                let current: String = connection
                    .query_row(
                        "SELECT display_name FROM accounts WHERE id = ?1",
                        [&account_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(current, "日常账户");
                Ok(())
            })
            .unwrap();

        confirm_account_draft_at(
            &runtime,
            ConfirmAccountDraftRequest {
                draft_id: draft.draft_id.clone(),
                confirmed_by_user: true,
            },
        )
        .expect("update draft should confirm");
        let retry = confirm_account_draft_at(
            &runtime,
            ConfirmAccountDraftRequest {
                draft_id: draft.draft_id,
                confirmed_by_user: true,
            },
        )
        .expect("update confirmation should be idempotent");
        assert_eq!(retry.account_id, account_id);

        runtime
            .with_unlocked_connection(|_, connection| {
                let (accounts, _) = account_snapshot(connection, "vault-1").unwrap();
                assert_eq!(accounts[0]["displayName"], "家庭日常账户");
                assert_eq!(accounts[0]["accountType"], "savings");
                assert_eq!(accounts[0]["maskedIdentifier"], "7788");
                assert_eq!(accounts[0]["balanceMinor"], 12_850_032);
                let ledger_count: i64 = connection
                    .query_row("SELECT count(*) FROM ledger_events", [], |row| row.get(0))
                    .unwrap();
                assert_eq!(ledger_count, 1);
                let audit_count: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM audit_events
                         WHERE object_id = ?1 AND action = 'account_updated'",
                        [&account_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(audit_count, 1);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn archive_rejects_non_zero_balance_and_preserves_zero_balance_history() {
        let (_directory, runtime) = runtime_with_vault();
        let non_zero_id = confirm_created_account(&runtime, request());
        assert!(archive_account_draft_at(
            &runtime,
            ArchiveAccountDraftRequest {
                account_id: non_zero_id,
            }
        )
        .is_err());

        let zero_id = confirm_created_account(
            &runtime,
            CreateAccountDraftRequest {
                institution_name: "演示银行".to_owned(),
                display_name: "备用账户".to_owned(),
                account_type: "cash".to_owned(),
                currency: "CNY".to_owned(),
                masked_identifier: None,
                opening_balance: "0.00".to_owned(),
                balance_date: "2026-07-26".to_owned(),
                notes: None,
            },
        );
        let archive = archive_account_draft_at(
            &runtime,
            ArchiveAccountDraftRequest {
                account_id: zero_id.clone(),
            },
        )
        .expect("zero balance archive draft should be created");
        confirm_account_draft_at(
            &runtime,
            ConfirmAccountDraftRequest {
                draft_id: archive.draft_id.clone(),
                confirmed_by_user: true,
            },
        )
        .expect("archive draft should confirm");
        confirm_account_draft_at(
            &runtime,
            ConfirmAccountDraftRequest {
                draft_id: archive.draft_id,
                confirmed_by_user: true,
            },
        )
        .expect("archive confirmation should be idempotent");

        runtime
            .with_unlocked_connection(|_, connection| {
                let archived_at: Option<String> = connection
                    .query_row(
                        "SELECT archived_at FROM accounts WHERE id = ?1",
                        [&zero_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert!(archived_at.is_some());
                let ledger_count: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM ledger_events WHERE account_id = ?1",
                        [&zero_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(ledger_count, 1);
                let (accounts, _) = account_snapshot(connection, "vault-1").unwrap();
                assert_eq!(accounts.len(), 1);
                let audit_count: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM audit_events
                         WHERE object_id = ?1 AND action = 'account_archived'",
                        [&zero_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(audit_count, 1);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn archive_requires_all_account_holdings_to_be_archived_first() {
        let (_directory, runtime) = runtime_with_vault();
        let account_id = confirm_created_account(
            &runtime,
            CreateAccountDraftRequest {
                institution_name: "演示券商".to_owned(),
                display_name: "零余额投资账户".to_owned(),
                account_type: "fund".to_owned(),
                currency: "CNY".to_owned(),
                masked_identifier: None,
                opening_balance: "0.00".to_owned(),
                balance_date: "2026-07-27".to_owned(),
                notes: None,
            },
        );
        runtime
            .with_unlocked_connection(|vault_id, connection| {
                connection
                    .execute(
                        "INSERT INTO draft_changes(
                           id, vault_id, source_type, source_fingerprint, status,
                           proposed_events_json, evidence_json, created_at
                         ) VALUES (
                           'draft-holding-account-guard', ?1, 'manual_holding',
                           'draft-holding-account-guard', 'confirmed', '{}', '[]',
                           '2026-07-27T01:00:00.000Z'
                         )",
                        [vault_id],
                    )
                    .unwrap();
                connection
                    .execute(
                        "INSERT INTO holdings(
                           id, vault_id, account_id, name, product_type,
                           currency, created_at
                         ) VALUES (
                           'holding-account-guard', ?1, ?2, '虚构基金', 'fund',
                           'CNY', '2026-07-27T01:00:00.000Z'
                         )",
                        params![vault_id, account_id],
                    )
                    .unwrap();
                connection
                    .execute(
                        "INSERT INTO holding_valuations(
                           id, vault_id, holding_id, draft_id, units_micros,
                           cost_basis_minor, market_value_minor, as_of_date,
                           source_type, created_at
                         ) VALUES (
                           'valuation-account-guard', ?1, 'holding-account-guard',
                           'draft-holding-account-guard', 1000000, 0, 0,
                           '2026-07-27', 'manual', '2026-07-27T01:00:00.000Z'
                         )",
                        [vault_id],
                    )
                    .unwrap();
                Ok(())
            })
            .unwrap();

        let blocked = archive_account_draft_at(
            &runtime,
            ArchiveAccountDraftRequest {
                account_id: account_id.clone(),
            },
        )
        .err()
        .expect("active holdings should block account archive");
        assert!(blocked.contains("active holdings"));

        runtime
            .with_unlocked_connection(|_, connection| {
                connection
                    .execute(
                        "UPDATE holdings
                         SET archived_at = '2026-07-27T02:00:00.000Z'
                         WHERE id = 'holding-account-guard'",
                        [],
                    )
                    .unwrap();
                Ok(())
            })
            .unwrap();
        let draft = archive_account_draft_at(
            &runtime,
            ArchiveAccountDraftRequest {
                account_id: account_id.clone(),
            },
        )
        .expect("account should become archivable after its holdings are archived");
        confirm_account_draft_at(
            &runtime,
            ConfirmAccountDraftRequest {
                draft_id: draft.draft_id,
                confirmed_by_user: true,
            },
        )
        .unwrap();
    }
}
