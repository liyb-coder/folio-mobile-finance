use crate::vault::VaultRuntime;
use getrandom::fill;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const MAX_SAFE_MINOR: i128 = 9_000_000_000_000_000;
const TRANSACTION_KINDS: [&str; 3] = ["income", "expense", "transfer"];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTransactionDraftRequest {
    pub(crate) transaction_kind: String,
    pub(crate) account_id: String,
    pub(crate) destination_account_id: Option<String>,
    pub(crate) amount: String,
    pub(crate) occurred_on: String,
    pub(crate) description: String,
    pub(crate) category: Option<String>,
    pub(crate) notes: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmTransactionDraftRequest {
    pub(crate) draft_id: String,
    pub(crate) confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectTransactionDraftRequest {
    draft_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTransactionCorrectionDraftRequest {
    transaction_id: String,
    correction_kind: String,
    reason: String,
    replacement: Option<CreateTransactionDraftRequest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmTransactionCorrectionDraftRequest {
    draft_id: String,
    confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectTransactionCorrectionDraftRequest {
    draft_id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransactionDraftPayload {
    kind: String,
    transaction_kind: String,
    account_id: String,
    account_name: String,
    destination_account_id: Option<String>,
    destination_account_name: Option<String>,
    amount_minor: i64,
    currency: String,
    occurred_on: String,
    description: String,
    category: Option<String>,
    notes: Option<String>,
    primary_event_id: String,
    secondary_event_id: Option<String>,
    link_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct OriginalLedgerEvent {
    id: String,
    account_id: String,
    account_name: String,
    event_type: String,
    delta_minor: i64,
    currency: String,
    occurred_at: String,
    link_id: Option<String>,
    metadata_json: String,
    account_archived: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct OriginalTransaction {
    transaction_id: String,
    transaction_kind: String,
    account_id: String,
    account_name: String,
    destination_account_id: Option<String>,
    destination_account_name: Option<String>,
    amount_minor: i64,
    currency: String,
    occurred_on: String,
    description: String,
    category: Option<String>,
    notes: Option<String>,
    events: Vec<OriginalLedgerEvent>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransactionCorrectionDraftPayload {
    kind: String,
    correction_kind: String,
    reason: String,
    original: OriginalTransaction,
    reversal_event_ids: Vec<String>,
    correction_link_id: String,
    replacement: Option<TransactionDraftPayload>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionDraftResponse {
    pub(crate) draft_id: String,
    action: &'static str,
    transaction_kind: String,
    account_id: String,
    account_name: String,
    destination_account_id: Option<String>,
    destination_account_name: Option<String>,
    amount_minor: i64,
    currency: String,
    occurred_on: String,
    description: String,
    category: Option<String>,
    notes: Option<String>,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionConfirmationResponse {
    draft_id: String,
    transaction_id: String,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionRejectionResponse {
    draft_id: String,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionCorrectionDraftResponse {
    draft_id: String,
    action: String,
    reason: String,
    original: Value,
    replacement: Option<Value>,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionCorrectionConfirmationResponse {
    draft_id: String,
    correction_kind: String,
    original_transaction_id: String,
    replacement_transaction_id: Option<String>,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionCorrectionRejectionResponse {
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

fn parse_positive_minor(value: &str) -> Result<i64, String> {
    let value = value.trim();
    let mut parts = value.split('.');
    let major = parts.next().unwrap_or_default();
    let fraction = parts.next();
    if parts.next().is_some()
        || major.is_empty()
        || !major.bytes().all(|byte| byte.is_ascii_digit())
        || fraction
            .is_some_and(|part| part.len() > 2 || !part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err("Amount must be a positive number with at most two decimal places.".to_owned());
    }
    let major: i128 = major
        .parse()
        .map_err(|_| "Amount is outside the supported range.".to_owned())?;
    let fraction = match fraction.unwrap_or_default() {
        "" => 0_i128,
        value if value.len() == 1 => value
            .parse::<i128>()
            .map(|number| number * 10)
            .map_err(|_| "Amount is invalid.".to_owned())?,
        value => value
            .parse::<i128>()
            .map_err(|_| "Amount is invalid.".to_owned())?,
    };
    let minor = major
        .checked_mul(100)
        .and_then(|number| number.checked_add(fraction))
        .ok_or_else(|| "Amount is outside the supported range.".to_owned())?;
    if minor <= 0 || minor > MAX_SAFE_MINOR {
        return Err("Amount must be greater than zero and within the supported range.".to_owned());
    }
    i64::try_from(minor).map_err(|_| "Amount is outside the supported range.".to_owned())
}

fn validate_date(connection: &Connection, value: String) -> Result<String, String> {
    let value = value.trim().to_owned();
    let valid: bool = connection
        .query_row("SELECT COALESCE(date(?1) = ?1, 0)", [&value], |row| {
            row.get(0)
        })
        .map_err(|_| "Unable to validate the transaction date.".to_owned())?;
    if !valid {
        return Err("Transaction date must be a valid YYYY-MM-DD date.".to_owned());
    }
    Ok(value)
}

fn active_account(
    connection: &Connection,
    vault_id: &str,
    account_id: &str,
) -> Result<(String, String), String> {
    connection
        .query_row(
            "SELECT display_name, currency
             FROM accounts
             WHERE id = ?1 AND vault_id = ?2 AND archived_at IS NULL",
            params![account_id, vault_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|_| "Unable to read the transaction account.".to_owned())?
        .ok_or_else(|| "The transaction account does not exist or is archived.".to_owned())
}

fn transaction_draft_response(
    draft_id: String,
    payload: TransactionDraftPayload,
) -> TransactionDraftResponse {
    TransactionDraftResponse {
        draft_id,
        action: "create",
        transaction_kind: payload.transaction_kind,
        account_id: payload.account_id,
        account_name: payload.account_name,
        destination_account_id: payload.destination_account_id,
        destination_account_name: payload.destination_account_name,
        amount_minor: payload.amount_minor,
        currency: payload.currency,
        occurred_on: payload.occurred_on,
        description: payload.description,
        category: payload.category,
        notes: payload.notes,
        status: "needs_review",
    }
}

fn build_transaction_payload(
    connection: &Connection,
    vault_id: &str,
    request: CreateTransactionDraftRequest,
) -> Result<TransactionDraftPayload, String> {
    let transaction_kind = request.transaction_kind.trim().to_ascii_lowercase();
    if !TRANSACTION_KINDS.contains(&transaction_kind.as_str()) {
        return Err("Transaction type is not supported.".to_owned());
    }
    let account_id = required_text(request.account_id, "Account identifier", 96)?;
    let (account_name, currency) = active_account(connection, vault_id, &account_id)?;
    let amount_minor = parse_positive_minor(&request.amount)?;
    let occurred_on = validate_date(connection, request.occurred_on)?;
    let description = required_text(request.description, "Description", 120)?;
    let category = optional_text(request.category, "Category", 60)?;
    let notes = optional_text(request.notes, "Notes", 1000)?;

    let (destination_account_id, destination_account_name) = if transaction_kind == "transfer" {
        let destination_id = required_text(
            request.destination_account_id.unwrap_or_default(),
            "Destination account identifier",
            96,
        )?;
        if destination_id == account_id {
            return Err("Transfer accounts must be different.".to_owned());
        }
        let (destination_name, destination_currency) =
            active_account(connection, vault_id, &destination_id)?;
        if destination_currency != currency {
            return Err(
                "Cross-currency transfers require an explicit exchange-rate workflow.".to_owned(),
            );
        }
        (Some(destination_id), Some(destination_name))
    } else {
        if request.destination_account_id.is_some() {
            return Err("Only transfers may include a destination account.".to_owned());
        }
        (None, None)
    };

    let is_transfer = transaction_kind == "transfer";
    Ok(TransactionDraftPayload {
        kind: "transaction.create".to_owned(),
        transaction_kind,
        account_id,
        account_name,
        destination_account_id,
        destination_account_name,
        amount_minor,
        currency,
        occurred_on,
        description,
        category,
        notes,
        primary_event_id: random_id("event")?,
        secondary_event_id: if is_transfer {
            Some(random_id("event")?)
        } else {
            None
        },
        link_id: if is_transfer {
            Some(random_id("transfer")?)
        } else {
            None
        },
    })
}

pub(crate) fn create_transaction_draft_at(
    runtime: &VaultRuntime,
    request: CreateTransactionDraftRequest,
) -> Result<TransactionDraftResponse, String> {
    runtime.with_unlocked_connection(|vault_id, connection| {
        let is_transfer = request
            .transaction_kind
            .trim()
            .eq_ignore_ascii_case("transfer");
        let evidence = json!([{
            "source": "manual_entry",
            "reviewRequired": true,
            "doubleEntry": is_transfer
        }])
        .to_string();
        create_sourced_transaction_draft(
            connection,
            vault_id,
            request,
            "manual_transaction",
            None,
            evidence,
        )
    })
}

pub(crate) fn create_sourced_transaction_draft(
    connection: &Connection,
    vault_id: &str,
    request: CreateTransactionDraftRequest,
    source_type: &str,
    source_fingerprint: Option<&str>,
    evidence_json: String,
) -> Result<TransactionDraftResponse, String> {
    if !matches!(source_type, "manual_transaction" | "email_transaction") {
        return Err("Transaction draft source is not supported.".to_owned());
    }
    let draft_id = random_id("draft")?;
    let payload = build_transaction_payload(connection, vault_id, request)?;
    let proposed = serde_json::to_string(&payload)
        .map_err(|_| "Unable to serialize the transaction draft.".to_owned())?;
    let fingerprint = source_fingerprint.unwrap_or(&draft_id);
    connection
        .execute(
            "INSERT INTO draft_changes(
                id, vault_id, source_type, source_fingerprint, status,
                proposed_events_json, evidence_json, created_at
             ) VALUES (
                ?1, ?2, ?3, ?4, 'needs_review',
                ?5, ?6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![
                draft_id,
                vault_id,
                source_type,
                fingerprint,
                proposed,
                evidence_json
            ],
        )
        .map_err(|_| "Unable to save the transaction review draft.".to_owned())?;
    Ok(transaction_draft_response(draft_id, payload))
}

fn append_ledger_event(
    connection: &Connection,
    vault_id: &str,
    draft_id: &str,
    event_id: &str,
    account_id: &str,
    event_type: &str,
    delta_minor: i64,
    currency: &str,
    occurred_at: &str,
    idempotency_suffix: &str,
    link_id: Option<&str>,
    metadata: &str,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO ledger_events(
                id, vault_id, account_id, draft_id, event_type, delta_minor,
                currency, occurred_at, status, idempotency_key, link_id,
                metadata_json, created_at
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'confirmed',
                ?9, ?10, ?11, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![
                event_id,
                vault_id,
                account_id,
                draft_id,
                event_type,
                delta_minor,
                currency,
                occurred_at,
                format!("manual-transaction:{draft_id}:{idempotency_suffix}"),
                link_id,
                metadata
            ],
        )
        .map_err(|_| "Unable to append the transaction ledger event.".to_owned())?;
    Ok(())
}

pub(crate) fn confirm_transaction_draft_at(
    runtime: &VaultRuntime,
    request: ConfirmTransactionDraftRequest,
) -> Result<TransactionConfirmationResponse, String> {
    if !request.confirmed_by_user {
        return Err("Explicit user confirmation is required.".to_owned());
    }
    let draft_id = required_text(request.draft_id, "Draft identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let row: Option<(String, String, String)> = connection
            .query_row(
                "SELECT status, proposed_events_json, source_type
                 FROM draft_changes
                 WHERE id = ?1 AND vault_id = ?2
                   AND source_type IN ('manual_transaction', 'email_transaction')",
                params![draft_id, vault_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|_| "Unable to read the transaction draft.".to_owned())?;
        let Some((status, proposed, source_type)) = row else {
            return Err("The transaction draft does not exist.".to_owned());
        };
        let payload: TransactionDraftPayload = serde_json::from_str(&proposed)
            .map_err(|_| "The transaction draft is invalid.".to_owned())?;
        let transaction_id = payload
            .link_id
            .clone()
            .unwrap_or_else(|| payload.primary_event_id.clone());
        if payload.kind != "transaction.create" {
            return Err("The transaction draft type is invalid.".to_owned());
        }
        if status == "confirmed" {
            return Ok(TransactionConfirmationResponse {
                draft_id,
                transaction_id,
                status: "confirmed",
            });
        }
        if status != "needs_review" {
            return Err(
                "The transaction draft is no longer available for confirmation.".to_owned(),
            );
        }

        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "Unable to start the transaction confirmation.".to_owned())?;
        let (_, source_currency) = active_account(&transaction, vault_id, &payload.account_id)?;
        if source_currency != payload.currency {
            return Err("The source account currency changed after review.".to_owned());
        }
        let occurred_at = format!("{}T00:00:00.000Z", payload.occurred_on);
        let source_label = if source_type == "email_transaction" {
            "qq_imap"
        } else {
            "manual_entry"
        };
        let metadata = json!({
            "source": source_label,
            "description": payload.description,
            "category": payload.category,
            "notes": payload.notes,
            "transactionKind": payload.transaction_kind
        })
        .to_string();

        match payload.transaction_kind.as_str() {
            "income" => append_ledger_event(
                &transaction,
                vault_id,
                &draft_id,
                &payload.primary_event_id,
                &payload.account_id,
                "income",
                payload.amount_minor,
                &payload.currency,
                &occurred_at,
                "income",
                None,
                &metadata,
            )?,
            "expense" => append_ledger_event(
                &transaction,
                vault_id,
                &draft_id,
                &payload.primary_event_id,
                &payload.account_id,
                "expense",
                -payload.amount_minor,
                &payload.currency,
                &occurred_at,
                "expense",
                None,
                &metadata,
            )?,
            "transfer" => {
                let destination_id = payload
                    .destination_account_id
                    .as_deref()
                    .ok_or_else(|| "The transfer destination is missing.".to_owned())?;
                let secondary_event_id = payload
                    .secondary_event_id
                    .as_deref()
                    .ok_or_else(|| "The transfer destination event is missing.".to_owned())?;
                let link_id = payload
                    .link_id
                    .as_deref()
                    .ok_or_else(|| "The transfer link is missing.".to_owned())?;
                let (_, destination_currency) =
                    active_account(&transaction, vault_id, destination_id)?;
                if destination_currency != payload.currency {
                    return Err(
                        "Cross-currency transfers require an explicit exchange-rate workflow."
                            .to_owned(),
                    );
                }
                append_ledger_event(
                    &transaction,
                    vault_id,
                    &draft_id,
                    &payload.primary_event_id,
                    &payload.account_id,
                    "transfer_out",
                    -payload.amount_minor,
                    &payload.currency,
                    &occurred_at,
                    "transfer-out",
                    Some(link_id),
                    &metadata,
                )?;
                append_ledger_event(
                    &transaction,
                    vault_id,
                    &draft_id,
                    secondary_event_id,
                    destination_id,
                    "transfer_in",
                    payload.amount_minor,
                    &payload.currency,
                    &occurred_at,
                    "transfer-in",
                    Some(link_id),
                    &metadata,
                )?;
            }
            _ => return Err("Transaction type is not supported.".to_owned()),
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
            .map_err(|_| "Unable to confirm the transaction draft.".to_owned())?;
        if updated != 1 {
            return Err("The transaction draft changed before confirmation.".to_owned());
        }
        if source_type == "email_transaction" {
            transaction
                .execute(
                    "UPDATE email_receipts
                     SET status = 'confirmed'
                     WHERE id IN (
                       SELECT receipt_id FROM email_receipt_items
                       WHERE transaction_draft_id = ?1
                     )
                     AND NOT EXISTS (
                       SELECT 1
                       FROM email_receipt_items item
                       JOIN draft_changes draft
                         ON draft.id = item.transaction_draft_id
                       WHERE item.receipt_id = email_receipts.id
                         AND draft.status != 'confirmed'
                     )",
                    [&draft_id],
                )
                .map_err(|_| "Unable to update the email review state.".to_owned())?;
        }
        transaction
            .execute(
                "INSERT INTO audit_events(
                    id, vault_id, category, action, actor_id,
                    object_type, object_id, metadata_json, occurred_at
                 ) VALUES (
                    ?1, ?2, 'data', 'transaction_created', 'local_user',
                    'transaction', ?3, ?4,
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![
                    random_id("audit")?,
                    vault_id,
                    transaction_id,
                    json!({
                        "source": source_label,
                        "transactionKind": payload.transaction_kind,
                        "currency": payload.currency,
                        "eventCount": if payload.transaction_kind == "transfer" { 2 } else { 1 }
                    })
                    .to_string()
                ],
            )
            .map_err(|_| "Unable to append the transaction audit event.".to_owned())?;
        transaction
            .commit()
            .map_err(|_| "Unable to commit the transaction confirmation.".to_owned())?;
        Ok(TransactionConfirmationResponse {
            draft_id,
            transaction_id,
            status: "confirmed",
        })
    })
}

fn reject_transaction_draft_at(
    runtime: &VaultRuntime,
    request: RejectTransactionDraftRequest,
) -> Result<TransactionRejectionResponse, String> {
    let draft_id = required_text(request.draft_id, "Draft identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let status: Option<String> = connection
            .query_row(
                "SELECT status FROM draft_changes
                 WHERE id = ?1 AND vault_id = ?2
                   AND source_type IN ('manual_transaction', 'email_transaction')",
                params![draft_id, vault_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| "Unable to read the transaction draft.".to_owned())?;
        match status.as_deref() {
            None => return Err("The transaction draft does not exist.".to_owned()),
            Some("confirmed") => {
                return Err("A confirmed transaction draft cannot be rejected.".to_owned())
            }
            Some("rejected") => {
                return Ok(TransactionRejectionResponse {
                    draft_id,
                    status: "rejected",
                })
            }
            Some("needs_review") => {}
            _ => return Err("The transaction draft state is invalid.".to_owned()),
        }
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "Unable to start the transaction draft rejection.".to_owned())?;
        transaction
            .execute(
                "UPDATE draft_changes
                 SET status = 'rejected',
                     rejected_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                     rejection_reason = 'user_cancelled'
                 WHERE id = ?1 AND vault_id = ?2 AND status = 'needs_review'",
                params![draft_id, vault_id],
            )
            .map_err(|_| "Unable to reject the transaction draft.".to_owned())?;
        transaction
            .execute(
                "UPDATE email_receipts
                 SET status = 'rejected'
                 WHERE id IN (
                   SELECT receipt_id FROM email_receipt_items
                   WHERE transaction_draft_id = ?1
                 )",
                [&draft_id],
            )
            .map_err(|_| "Unable to update the rejected email review state.".to_owned())?;
        transaction
            .execute(
                "INSERT INTO audit_events(
                    id, vault_id, category, action, actor_id,
                    object_type, object_id, metadata_json, occurred_at
                 ) VALUES (
                    ?1, ?2, 'data', 'transaction_draft_rejected', 'local_user',
                    'draft_change', ?3, '{}',
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![random_id("audit")?, vault_id, draft_id],
            )
            .map_err(|_| "Unable to append the transaction draft audit event.".to_owned())?;
        transaction
            .commit()
            .map_err(|_| "Unable to commit the transaction draft rejection.".to_owned())?;
        Ok(TransactionRejectionResponse {
            draft_id,
            status: "rejected",
        })
    })
}

fn load_original_transaction(
    connection: &Connection,
    vault_id: &str,
    transaction_id: &str,
) -> Result<OriginalTransaction, String> {
    let mut statement = connection
        .prepare(
            "SELECT
                e.id, e.account_id, a.display_name, e.event_type,
                e.delta_minor, e.currency, e.occurred_at, e.link_id,
                e.metadata_json, a.archived_at IS NOT NULL
             FROM ledger_events e
             JOIN accounts a
               ON a.id = e.account_id AND a.vault_id = e.vault_id
             WHERE e.vault_id = ?1
               AND (
                 (e.id = ?2 AND e.event_type IN ('income', 'expense'))
                 OR
                 (e.link_id = ?2 AND e.event_type IN ('transfer_out', 'transfer_in'))
               )
             ORDER BY
               CASE e.event_type
                 WHEN 'transfer_out' THEN 0
                 WHEN 'transfer_in' THEN 1
                 ELSE 0
               END,
               e.id",
        )
        .map_err(|_| "Unable to prepare the original transaction review.".to_owned())?;
    let rows = statement
        .query_map(params![vault_id, transaction_id], |row| {
            Ok(OriginalLedgerEvent {
                id: row.get(0)?,
                account_id: row.get(1)?,
                account_name: row.get(2)?,
                event_type: row.get(3)?,
                delta_minor: row.get(4)?,
                currency: row.get(5)?,
                occurred_at: row.get(6)?,
                link_id: row.get(7)?,
                metadata_json: row.get(8)?,
                account_archived: row.get(9)?,
            })
        })
        .map_err(|_| "Unable to read the original transaction.".to_owned())?;
    let mut events = Vec::new();
    for row in rows {
        events.push(row.map_err(|_| "Unable to decode the original transaction.".to_owned())?);
    }
    if events.is_empty() {
        return Err("The original transaction does not exist.".to_owned());
    }
    if events.iter().any(|event| event.account_archived) {
        return Err("A transaction on an archived account cannot be corrected.".to_owned());
    }
    if events.iter().any(|event| {
        serde_json::from_str::<Value>(&event.metadata_json)
            .ok()
            .and_then(|metadata| {
                metadata
                    .get("holdingOperationId")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .is_some()
    }) {
        return Err(
            "Holding-linked transactions must be corrected from the holding operation history."
                .to_owned(),
        );
    }
    for event in &events {
        let already_reversed: bool = connection
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM ledger_events
                    WHERE vault_id = ?1 AND reverses_event_id = ?2
                )",
                params![vault_id, event.id],
                |row| row.get(0),
            )
            .map_err(|_| "Unable to verify the transaction correction state.".to_owned())?;
        if already_reversed {
            return Err("The transaction has already been reversed or revised.".to_owned());
        }
    }

    let primary = &events[0];
    let (transaction_kind, destination_account_id, destination_account_name) =
        match primary.event_type.as_str() {
            "income" | "expense" if events.len() == 1 && primary.id == transaction_id => {
                (primary.event_type.clone(), None, None)
            }
            "transfer_out"
                if events.len() == 2
                    && primary.link_id.as_deref() == Some(transaction_id)
                    && events[1].event_type == "transfer_in"
                    && events[1].link_id.as_deref() == Some(transaction_id)
                    && primary.currency == events[1].currency
                    && i128::from(primary.delta_minor) + i128::from(events[1].delta_minor) == 0
                    && primary.delta_minor < 0
                    && events[1].delta_minor > 0 =>
            {
                (
                    "transfer".to_owned(),
                    Some(events[1].account_id.clone()),
                    Some(events[1].account_name.clone()),
                )
            }
            _ => return Err("The original transaction is incomplete or inconsistent.".to_owned()),
        };
    let metadata: Value =
        serde_json::from_str(&primary.metadata_json).unwrap_or_else(|_| json!({}));
    Ok(OriginalTransaction {
        transaction_id: transaction_id.to_owned(),
        transaction_kind,
        account_id: primary.account_id.clone(),
        account_name: primary.account_name.clone(),
        destination_account_id,
        destination_account_name,
        amount_minor: primary
            .delta_minor
            .checked_abs()
            .ok_or_else(|| "The original transaction amount is unsafe.".to_owned())?,
        currency: primary.currency.clone(),
        occurred_on: primary
            .occurred_at
            .split('T')
            .next()
            .unwrap_or_default()
            .to_owned(),
        description: metadata
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned(),
        category: metadata
            .get("category")
            .and_then(Value::as_str)
            .map(str::to_owned),
        notes: metadata
            .get("notes")
            .and_then(Value::as_str)
            .map(str::to_owned),
        events,
    })
}

fn original_transaction_value(original: &OriginalTransaction) -> Value {
    json!({
        "id": original.transaction_id,
        "transactionKind": original.transaction_kind,
        "accountId": original.account_id,
        "accountName": original.account_name,
        "destinationAccountId": original.destination_account_id,
        "destinationAccountName": original.destination_account_name,
        "amountMinor": original.amount_minor,
        "currency": original.currency,
        "occurredOn": original.occurred_on,
        "description": original.description,
        "category": original.category,
        "notes": original.notes
    })
}

fn transaction_payload_value(payload: &TransactionDraftPayload) -> Value {
    json!({
        "transactionKind": payload.transaction_kind,
        "accountId": payload.account_id,
        "accountName": payload.account_name,
        "destinationAccountId": payload.destination_account_id,
        "destinationAccountName": payload.destination_account_name,
        "amountMinor": payload.amount_minor,
        "currency": payload.currency,
        "occurredOn": payload.occurred_on,
        "description": payload.description,
        "category": payload.category,
        "notes": payload.notes
    })
}

fn replacement_transaction_id(payload: &TransactionDraftPayload) -> String {
    payload
        .link_id
        .clone()
        .unwrap_or_else(|| payload.primary_event_id.clone())
}

fn correction_draft_response(
    draft_id: String,
    payload: &TransactionCorrectionDraftPayload,
) -> TransactionCorrectionDraftResponse {
    TransactionCorrectionDraftResponse {
        draft_id,
        action: payload.correction_kind.clone(),
        reason: payload.reason.clone(),
        original: original_transaction_value(&payload.original),
        replacement: payload.replacement.as_ref().map(transaction_payload_value),
        status: "needs_review",
    }
}

fn create_transaction_correction_draft_at(
    runtime: &VaultRuntime,
    request: CreateTransactionCorrectionDraftRequest,
) -> Result<TransactionCorrectionDraftResponse, String> {
    let transaction_id = required_text(request.transaction_id, "Transaction identifier", 96)?;
    let correction_kind = request.correction_kind.trim().to_ascii_lowercase();
    if correction_kind != "reverse" && correction_kind != "revise" {
        return Err("Transaction correction type is not supported.".to_owned());
    }
    let reason = required_text(request.reason, "Correction reason", 240)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let original = load_original_transaction(connection, vault_id, &transaction_id)?;
        let replacement = match (correction_kind.as_str(), request.replacement) {
            ("reverse", None) => None,
            ("reverse", Some(_)) => {
                return Err("A reversal cannot include a replacement transaction.".to_owned())
            }
            ("revise", Some(replacement)) => Some(build_transaction_payload(
                connection,
                vault_id,
                replacement,
            )?),
            ("revise", None) => {
                return Err("A revision requires a replacement transaction.".to_owned())
            }
            _ => return Err("Transaction correction type is not supported.".to_owned()),
        };
        let draft_id = random_id("draft")?;
        let payload = TransactionCorrectionDraftPayload {
            kind: "transaction.correction".to_owned(),
            correction_kind,
            reason,
            reversal_event_ids: original
                .events
                .iter()
                .map(|_| random_id("event"))
                .collect::<Result<Vec<_>, _>>()?,
            correction_link_id: random_id("correction")?,
            original,
            replacement,
        };
        let proposed = serde_json::to_string(&payload)
            .map_err(|_| "Unable to serialize the transaction correction draft.".to_owned())?;
        let evidence = json!([{
            "source": "manual_correction",
            "reviewRequired": true,
            "correctionKind": payload.correction_kind,
            "originalTransactionId": payload.original.transaction_id
        }])
        .to_string();
        connection
            .execute(
                "INSERT INTO draft_changes(
                    id, vault_id, source_type, source_fingerprint, status,
                    proposed_events_json, evidence_json, created_at
                 ) VALUES (
                    ?1, ?2, 'manual_transaction_correction', ?1, 'needs_review',
                    ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![draft_id, vault_id, proposed, evidence],
            )
            .map_err(|_| "Unable to save the transaction correction review draft.".to_owned())?;
        Ok(correction_draft_response(draft_id, &payload))
    })
}

fn append_reversal_event(
    connection: &Connection,
    vault_id: &str,
    draft_id: &str,
    event_id: &str,
    original: &OriginalLedgerEvent,
    correction_link_id: &str,
    idempotency_index: usize,
    correction_kind: &str,
    reason: &str,
    original_transaction_id: &str,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO ledger_events(
                id, vault_id, account_id, draft_id, event_type, delta_minor,
                currency, occurred_at, status, idempotency_key, link_id,
                reverses_event_id, metadata_json, created_at
             ) VALUES (
                ?1, ?2, ?3, ?4, 'reversal', ?5, ?6, ?7, 'confirmed',
                ?8, ?9, ?10, ?11, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![
                event_id,
                vault_id,
                original.account_id,
                draft_id,
                original
                    .delta_minor
                    .checked_neg()
                    .ok_or_else(|| "The reversal amount is unsafe.".to_owned())?,
                original.currency,
                original.occurred_at,
                format!("manual-transaction-correction:{draft_id}:reversal-{idempotency_index}"),
                correction_link_id,
                original.id,
                json!({
                    "source": "manual_correction",
                    "correctionKind": correction_kind,
                    "reason": reason,
                    "originalTransactionId": original_transaction_id
                })
                .to_string()
            ],
        )
        .map_err(|_| "Unable to append the transaction reversal event.".to_owned())?;
    Ok(())
}

fn append_replacement_events(
    connection: &Connection,
    vault_id: &str,
    draft_id: &str,
    payload: &TransactionDraftPayload,
    original_transaction_id: &str,
    reason: &str,
) -> Result<(), String> {
    let (_, source_currency) = active_account(connection, vault_id, &payload.account_id)?;
    if source_currency != payload.currency {
        return Err("The replacement source account currency changed after review.".to_owned());
    }
    let occurred_at = format!("{}T00:00:00.000Z", payload.occurred_on);
    let metadata = json!({
        "source": "manual_revision",
        "description": payload.description,
        "category": payload.category,
        "notes": payload.notes,
        "transactionKind": payload.transaction_kind,
        "revisesTransactionId": original_transaction_id,
        "correctionReason": reason
    })
    .to_string();
    match payload.transaction_kind.as_str() {
        "income" => append_ledger_event(
            connection,
            vault_id,
            draft_id,
            &payload.primary_event_id,
            &payload.account_id,
            "income",
            payload.amount_minor,
            &payload.currency,
            &occurred_at,
            "revision-income",
            None,
            &metadata,
        ),
        "expense" => append_ledger_event(
            connection,
            vault_id,
            draft_id,
            &payload.primary_event_id,
            &payload.account_id,
            "expense",
            -payload.amount_minor,
            &payload.currency,
            &occurred_at,
            "revision-expense",
            None,
            &metadata,
        ),
        "transfer" => {
            let destination_id = payload
                .destination_account_id
                .as_deref()
                .ok_or_else(|| "The replacement transfer destination is missing.".to_owned())?;
            let secondary_event_id = payload
                .secondary_event_id
                .as_deref()
                .ok_or_else(|| "The replacement transfer event is missing.".to_owned())?;
            let link_id = payload
                .link_id
                .as_deref()
                .ok_or_else(|| "The replacement transfer link is missing.".to_owned())?;
            let (_, destination_currency) = active_account(connection, vault_id, destination_id)?;
            if destination_currency != payload.currency {
                return Err(
                    "Cross-currency transfers require an explicit exchange-rate workflow."
                        .to_owned(),
                );
            }
            append_ledger_event(
                connection,
                vault_id,
                draft_id,
                &payload.primary_event_id,
                &payload.account_id,
                "transfer_out",
                -payload.amount_minor,
                &payload.currency,
                &occurred_at,
                "revision-transfer-out",
                Some(link_id),
                &metadata,
            )?;
            append_ledger_event(
                connection,
                vault_id,
                draft_id,
                secondary_event_id,
                destination_id,
                "transfer_in",
                payload.amount_minor,
                &payload.currency,
                &occurred_at,
                "revision-transfer-in",
                Some(link_id),
                &metadata,
            )
        }
        _ => Err("Replacement transaction type is not supported.".to_owned()),
    }
}

fn confirm_transaction_correction_draft_at(
    runtime: &VaultRuntime,
    request: ConfirmTransactionCorrectionDraftRequest,
) -> Result<TransactionCorrectionConfirmationResponse, String> {
    if !request.confirmed_by_user {
        return Err("Explicit user confirmation is required.".to_owned());
    }
    let draft_id = required_text(request.draft_id, "Draft identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let row: Option<(String, String)> = connection
            .query_row(
                "SELECT status, proposed_events_json
                 FROM draft_changes
                 WHERE id = ?1 AND vault_id = ?2
                   AND source_type = 'manual_transaction_correction'",
                params![draft_id, vault_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| "Unable to read the transaction correction draft.".to_owned())?;
        let (status, proposed) =
            row.ok_or_else(|| "The transaction correction draft does not exist.".to_owned())?;
        let payload: TransactionCorrectionDraftPayload = serde_json::from_str(&proposed)
            .map_err(|_| "The transaction correction draft is invalid.".to_owned())?;
        if payload.kind != "transaction.correction" {
            return Err("The transaction correction draft type is invalid.".to_owned());
        }
        let replacement_transaction_id =
            payload.replacement.as_ref().map(replacement_transaction_id);
        if status == "confirmed" {
            return Ok(TransactionCorrectionConfirmationResponse {
                draft_id,
                correction_kind: payload.correction_kind,
                original_transaction_id: payload.original.transaction_id,
                replacement_transaction_id,
                status: "confirmed",
            });
        }
        if status != "needs_review" {
            return Err(
                "The transaction correction draft is no longer available for confirmation."
                    .to_owned(),
            );
        }

        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "Unable to start the transaction correction.".to_owned())?;
        let current =
            load_original_transaction(&transaction, vault_id, &payload.original.transaction_id)?;
        if current != payload.original {
            return Err(
                "The original transaction changed after review. Create a new correction draft."
                    .to_owned(),
            );
        }
        if payload.reversal_event_ids.len() != payload.original.events.len() {
            return Err("The transaction correction event set is invalid.".to_owned());
        }
        for (index, (event_id, original_event)) in payload
            .reversal_event_ids
            .iter()
            .zip(payload.original.events.iter())
            .enumerate()
        {
            append_reversal_event(
                &transaction,
                vault_id,
                &draft_id,
                event_id,
                original_event,
                &payload.correction_link_id,
                index,
                &payload.correction_kind,
                &payload.reason,
                &payload.original.transaction_id,
            )?;
        }
        if let Some(replacement) = &payload.replacement {
            append_replacement_events(
                &transaction,
                vault_id,
                &draft_id,
                replacement,
                &payload.original.transaction_id,
                &payload.reason,
            )?;
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
            .map_err(|_| "Unable to confirm the transaction correction draft.".to_owned())?;
        if updated != 1 {
            return Err("The transaction correction draft changed before confirmation.".to_owned());
        }
        transaction
            .execute(
                "INSERT INTO audit_events(
                    id, vault_id, category, action, actor_id,
                    object_type, object_id, metadata_json, occurred_at
                 ) VALUES (
                    ?1, ?2, 'data', ?3, 'local_user',
                    'transaction', ?4, ?5,
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![
                    random_id("audit")?,
                    vault_id,
                    if payload.correction_kind == "revise" {
                        "transaction_revised"
                    } else {
                        "transaction_reversed"
                    },
                    payload.original.transaction_id,
                    json!({
                        "draftId": draft_id,
                        "reason": payload.reason,
                        "originalTransactionId": payload.original.transaction_id,
                        "replacementTransactionId": replacement_transaction_id,
                        "reversalEventCount": payload.reversal_event_ids.len()
                    })
                    .to_string()
                ],
            )
            .map_err(|_| "Unable to append the transaction correction audit event.".to_owned())?;
        transaction
            .commit()
            .map_err(|_| "Unable to commit the transaction correction.".to_owned())?;
        Ok(TransactionCorrectionConfirmationResponse {
            draft_id,
            correction_kind: payload.correction_kind,
            original_transaction_id: payload.original.transaction_id,
            replacement_transaction_id,
            status: "confirmed",
        })
    })
}

fn reject_transaction_correction_draft_at(
    runtime: &VaultRuntime,
    request: RejectTransactionCorrectionDraftRequest,
) -> Result<TransactionCorrectionRejectionResponse, String> {
    let draft_id = required_text(request.draft_id, "Draft identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let status: Option<String> = connection
            .query_row(
                "SELECT status FROM draft_changes
                 WHERE id = ?1 AND vault_id = ?2
                   AND source_type = 'manual_transaction_correction'",
                params![draft_id, vault_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| "Unable to read the transaction correction draft.".to_owned())?;
        match status.as_deref() {
            None => return Err("The transaction correction draft does not exist.".to_owned()),
            Some("confirmed") => {
                return Err("A confirmed transaction correction cannot be rejected.".to_owned())
            }
            Some("rejected") => {
                return Ok(TransactionCorrectionRejectionResponse {
                    draft_id,
                    status: "rejected",
                })
            }
            Some("needs_review") => {}
            _ => return Err("The transaction correction draft state is invalid.".to_owned()),
        }
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "Unable to start the correction draft rejection.".to_owned())?;
        transaction
            .execute(
                "UPDATE draft_changes
                 SET status = 'rejected',
                     rejected_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                     rejection_reason = 'user_cancelled'
                 WHERE id = ?1 AND vault_id = ?2 AND status = 'needs_review'",
                params![draft_id, vault_id],
            )
            .map_err(|_| "Unable to reject the transaction correction draft.".to_owned())?;
        transaction
            .execute(
                "INSERT INTO audit_events(
                    id, vault_id, category, action, actor_id,
                    object_type, object_id, metadata_json, occurred_at
                 ) VALUES (
                    ?1, ?2, 'data', 'transaction_correction_draft_rejected', 'local_user',
                    'draft_change', ?3, '{}',
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![random_id("audit")?, vault_id, draft_id],
            )
            .map_err(|_| "Unable to append the correction draft audit event.".to_owned())?;
        transaction
            .commit()
            .map_err(|_| "Unable to commit the correction draft rejection.".to_owned())?;
        Ok(TransactionCorrectionRejectionResponse {
            draft_id,
            status: "rejected",
        })
    })
}

pub(crate) fn transaction_snapshot(
    connection: &Connection,
    vault_id: &str,
) -> Result<Vec<Value>, String> {
    let mut statement = connection
        .prepare(
            "SELECT
                e.id, e.event_type, e.account_id, a.display_name,
                e.delta_minor, e.currency, e.occurred_at, e.link_id,
                e.metadata_json, e.created_at,
                (
                    SELECT destination.account_id
                    FROM ledger_events destination
                    WHERE destination.vault_id = e.vault_id
                      AND destination.link_id = e.link_id
                      AND destination.event_type = 'transfer_in'
                    LIMIT 1
                ),
                (
                    SELECT destination_account.display_name
                    FROM ledger_events destination
                    JOIN accounts destination_account
                      ON destination_account.id = destination.account_id
                     AND destination_account.vault_id = destination.vault_id
                    WHERE destination.vault_id = e.vault_id
                      AND destination.link_id = e.link_id
                      AND destination.event_type = 'transfer_in'
                    LIMIT 1
                ),
                EXISTS(
                    SELECT 1
                    FROM ledger_events reversal
                    WHERE reversal.vault_id = e.vault_id
                      AND reversal.reverses_event_id = e.id
                ),
                (
                    SELECT json_extract(reversal.metadata_json, '$.reason')
                    FROM ledger_events reversal
                    WHERE reversal.vault_id = e.vault_id
                      AND reversal.reverses_event_id = e.id
                    LIMIT 1
                )
             FROM ledger_events e
             JOIN accounts a
               ON a.id = e.account_id AND a.vault_id = e.vault_id
             WHERE e.vault_id = ?1
               AND e.event_type IN ('income', 'expense', 'transfer_out')
             ORDER BY e.occurred_at DESC, e.created_at DESC, e.id DESC",
        )
        .map_err(|_| "Unable to prepare the transaction snapshot.".to_owned())?;
    let rows = statement
        .query_map([vault_id], |row| {
            let event_type: String = row.get(1)?;
            let delta_minor: i64 = row.get(4)?;
            let metadata_text: String = row.get(8)?;
            let metadata: Value =
                serde_json::from_str(&metadata_text).unwrap_or_else(|_| json!({}));
            let kind = if event_type == "transfer_out" {
                "transfer"
            } else {
                event_type.as_str()
            };
            Ok(json!({
                "id": row.get::<_, Option<String>>(7)?.unwrap_or(row.get::<_, String>(0)?),
                "kind": kind,
                "accountId": row.get::<_, String>(2)?,
                "accountName": row.get::<_, String>(3)?,
                "destinationAccountId": row.get::<_, Option<String>>(10)?,
                "destinationAccountName": row.get::<_, Option<String>>(11)?,
                "amountMinor": delta_minor.checked_abs().unwrap_or(i64::MAX),
                "currency": row.get::<_, String>(5)?,
                "occurredAt": row.get::<_, String>(6)?,
                "description": metadata.get("description").and_then(Value::as_str).unwrap_or(""),
                "category": metadata.get("category").and_then(Value::as_str),
                "notes": metadata.get("notes").and_then(Value::as_str),
                "revisesTransactionId": metadata.get("revisesTransactionId").and_then(Value::as_str),
                "correctionReason": metadata.get("correctionReason").and_then(Value::as_str),
                "reversed": row.get::<_, bool>(12)?,
                "reversalReason": row.get::<_, Option<String>>(13)?,
                "createdAt": row.get::<_, String>(9)?
            }))
        })
        .map_err(|_| "Unable to read encrypted transactions.".to_owned())?;
    let mut transactions = Vec::new();
    for row in rows {
        transactions.push(
            row.map_err(|_| "Unable to decode the encrypted transaction snapshot.".to_owned())?,
        );
    }
    Ok(transactions)
}

#[tauri::command]
pub fn transaction_create_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: CreateTransactionDraftRequest,
) -> Result<TransactionDraftResponse, String> {
    create_transaction_draft_at(&runtime, request)
}

#[tauri::command]
pub fn transaction_confirm_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: ConfirmTransactionDraftRequest,
) -> Result<TransactionConfirmationResponse, String> {
    confirm_transaction_draft_at(&runtime, request)
}

#[tauri::command]
pub fn transaction_reject_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: RejectTransactionDraftRequest,
) -> Result<TransactionRejectionResponse, String> {
    reject_transaction_draft_at(&runtime, request)
}

#[tauri::command]
pub fn transaction_correction_create_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: CreateTransactionCorrectionDraftRequest,
) -> Result<TransactionCorrectionDraftResponse, String> {
    create_transaction_correction_draft_at(&runtime, request)
}

#[tauri::command]
pub fn transaction_correction_confirm_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: ConfirmTransactionCorrectionDraftRequest,
) -> Result<TransactionCorrectionConfirmationResponse, String> {
    confirm_transaction_correction_draft_at(&runtime, request)
}

#[tauri::command]
pub fn transaction_correction_reject_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: RejectTransactionCorrectionDraftRequest,
) -> Result<TransactionCorrectionRejectionResponse, String> {
    reject_transaction_correction_draft_at(&runtime, request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::open_encrypted;

    fn runtime_with_accounts() -> (tempfile::TempDir, VaultRuntime) {
        let directory = tempfile::tempdir().expect("temporary directory should exist");
        let connection =
            open_encrypted(&directory.path().join("transactions.sqlite3"), &[31_u8; 32])
                .expect("encrypted database should open");
        connection
            .execute(
                "INSERT INTO vaults(id, display_name, base_currency, created_at)
                 VALUES ('vault-1', 'Test vault', 'CNY', '2026-07-27T00:00:00.000Z')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO accounts(
                    id, vault_id, institution_name, display_name,
                    account_type, currency, created_at
                 ) VALUES
                    ('account-1', 'vault-1', '演示银行', '日常账户',
                     'cash', 'CNY', '2026-07-27T00:00:00.000Z'),
                    ('account-2', 'vault-1', '演示银行', '储蓄账户',
                     'savings', 'CNY', '2026-07-27T00:00:00.000Z'),
                    ('account-usd', 'vault-1', '演示银行', '美元账户',
                     'cash', 'USD', '2026-07-27T00:00:00.000Z')",
                [],
            )
            .unwrap();
        let runtime = VaultRuntime::default();
        runtime.install_test_session("vault-1", connection);
        (directory, runtime)
    }

    fn request(kind: &str) -> CreateTransactionDraftRequest {
        CreateTransactionDraftRequest {
            transaction_kind: kind.to_owned(),
            account_id: "account-1".to_owned(),
            destination_account_id: (kind == "transfer").then(|| "account-2".to_owned()),
            amount: "1280.55".to_owned(),
            occurred_on: "2026-07-27".to_owned(),
            description: "虚构测试流水".to_owned(),
            category: Some("测试".to_owned()),
            notes: None,
        }
    }

    #[test]
    fn amount_parser_is_exact_and_positive() {
        assert_eq!(parse_positive_minor("1280.55").unwrap(), 128_055);
        assert_eq!(parse_positive_minor("0.1").unwrap(), 10);
        assert!(parse_positive_minor("0").is_err());
        assert!(parse_positive_minor("-1").is_err());
        assert!(parse_positive_minor("1.001").is_err());
        assert!(parse_positive_minor("1e3").is_err());
    }

    #[test]
    fn income_and_expense_require_review_and_keep_exact_signs() {
        let (_directory, runtime) = runtime_with_accounts();
        for kind in ["income", "expense"] {
            let draft =
                create_transaction_draft_at(&runtime, request(kind)).expect("draft should create");
            runtime
                .with_unlocked_connection(|_, connection| {
                    let count: i64 = connection
                        .query_row("SELECT count(*) FROM ledger_events", [], |row| row.get(0))
                        .unwrap();
                    assert_eq!(count, if kind == "income" { 0 } else { 1 });
                    Ok(())
                })
                .unwrap();
            assert!(confirm_transaction_draft_at(
                &runtime,
                ConfirmTransactionDraftRequest {
                    draft_id: draft.draft_id.clone(),
                    confirmed_by_user: false,
                }
            )
            .is_err());
            confirm_transaction_draft_at(
                &runtime,
                ConfirmTransactionDraftRequest {
                    draft_id: draft.draft_id,
                    confirmed_by_user: true,
                },
            )
            .expect("draft should confirm");
        }
        runtime
            .with_unlocked_connection(|_, connection| {
                let deltas: Vec<i64> = connection
                    .prepare(
                        "SELECT delta_minor FROM ledger_events
                         ORDER BY occurred_at, created_at, id",
                    )
                    .unwrap()
                    .query_map([], |row| row.get(0))
                    .unwrap()
                    .map(Result::unwrap)
                    .collect();
                assert_eq!(deltas.len(), 2);
                assert!(deltas.contains(&128_055));
                assert!(deltas.contains(&-128_055));
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn transfer_confirmation_is_atomic_balanced_and_idempotent() {
        let (_directory, runtime) = runtime_with_accounts();
        let draft = create_transaction_draft_at(&runtime, request("transfer"))
            .expect("draft should create");
        let first = confirm_transaction_draft_at(
            &runtime,
            ConfirmTransactionDraftRequest {
                draft_id: draft.draft_id.clone(),
                confirmed_by_user: true,
            },
        )
        .expect("transfer should confirm");
        let retry = confirm_transaction_draft_at(
            &runtime,
            ConfirmTransactionDraftRequest {
                draft_id: draft.draft_id,
                confirmed_by_user: true,
            },
        )
        .expect("transfer retry should be idempotent");
        assert_eq!(retry.transaction_id, first.transaction_id);
        runtime
            .with_unlocked_connection(|_, connection| {
                let count: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM ledger_events WHERE link_id = ?1",
                        [&first.transaction_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                let total: i64 = connection
                    .query_row(
                        "SELECT sum(delta_minor) FROM ledger_events WHERE link_id = ?1",
                        [&first.transaction_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(count, 2);
                assert_eq!(total, 0);
                let snapshot = transaction_snapshot(connection, "vault-1").unwrap();
                assert_eq!(snapshot.len(), 1);
                assert_eq!(snapshot[0]["kind"], "transfer");
                assert_eq!(snapshot[0]["destinationAccountName"], "储蓄账户");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn invalid_or_rejected_transfers_never_write_ledger_events() {
        let (_directory, runtime) = runtime_with_accounts();
        let mut cross_currency = request("transfer");
        cross_currency.destination_account_id = Some("account-usd".to_owned());
        assert!(create_transaction_draft_at(&runtime, cross_currency).is_err());

        let draft = create_transaction_draft_at(&runtime, request("transfer"))
            .expect("draft should create");
        reject_transaction_draft_at(
            &runtime,
            RejectTransactionDraftRequest {
                draft_id: draft.draft_id.clone(),
            },
        )
        .expect("draft should reject");
        assert!(confirm_transaction_draft_at(
            &runtime,
            ConfirmTransactionDraftRequest {
                draft_id: draft.draft_id,
                confirmed_by_user: true,
            }
        )
        .is_err());
        runtime
            .with_unlocked_connection(|_, connection| {
                let count: i64 = connection
                    .query_row("SELECT count(*) FROM ledger_events", [], |row| row.get(0))
                    .unwrap();
                assert_eq!(count, 0);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn reversal_is_reviewed_idempotent_and_restores_the_balance() {
        let (_directory, runtime) = runtime_with_accounts();
        let created = create_transaction_draft_at(&runtime, request("expense")).unwrap();
        let original = confirm_transaction_draft_at(
            &runtime,
            ConfirmTransactionDraftRequest {
                draft_id: created.draft_id,
                confirmed_by_user: true,
            },
        )
        .unwrap();
        let correction = create_transaction_correction_draft_at(
            &runtime,
            CreateTransactionCorrectionDraftRequest {
                transaction_id: original.transaction_id.clone(),
                correction_kind: "reverse".to_owned(),
                reason: "虚构重复流水".to_owned(),
                replacement: None,
            },
        )
        .unwrap();
        runtime
            .with_unlocked_connection(|_, connection| {
                let balance: i64 = connection
                    .query_row(
                        "SELECT balance_minor FROM account_balances
                         WHERE account_id = 'account-1'",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(balance, -128_055);
                Ok(())
            })
            .unwrap();
        assert!(confirm_transaction_correction_draft_at(
            &runtime,
            ConfirmTransactionCorrectionDraftRequest {
                draft_id: correction.draft_id.clone(),
                confirmed_by_user: false,
            }
        )
        .is_err());
        let first = confirm_transaction_correction_draft_at(
            &runtime,
            ConfirmTransactionCorrectionDraftRequest {
                draft_id: correction.draft_id.clone(),
                confirmed_by_user: true,
            },
        )
        .unwrap();
        let retry = confirm_transaction_correction_draft_at(
            &runtime,
            ConfirmTransactionCorrectionDraftRequest {
                draft_id: correction.draft_id,
                confirmed_by_user: true,
            },
        )
        .unwrap();
        assert_eq!(retry.original_transaction_id, first.original_transaction_id);
        runtime
            .with_unlocked_connection(|_, connection| {
                let state: (i64, i64, i64) = connection
                    .query_row(
                        "SELECT
                            COALESCE((SELECT balance_minor FROM account_balances
                                      WHERE account_id = 'account-1'), 0),
                            (SELECT count(*) FROM ledger_events),
                            (SELECT count(*) FROM audit_events
                             WHERE action = 'transaction_reversed')",
                        [],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                    )
                    .unwrap();
                assert_eq!(state, (0, 2, 1));
                let snapshot = transaction_snapshot(connection, "vault-1").unwrap();
                assert_eq!(snapshot.len(), 1);
                assert_eq!(snapshot[0]["reversed"], true);
                assert_eq!(snapshot[0]["reversalReason"], "虚构重复流水");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn holding_linked_ledger_events_cannot_be_corrected_in_isolation() {
        let (_directory, runtime) = runtime_with_accounts();
        runtime
            .with_unlocked_connection(|vault_id, connection| {
                connection
                    .execute(
                        "INSERT INTO ledger_events(
                           id, vault_id, account_id, event_type, delta_minor,
                           currency, occurred_at, status, idempotency_key,
                           metadata_json, created_at
                         ) VALUES (
                           'holding-income', ?1, 'account-1', 'income', 500,
                           'CNY', '2026-07-27', 'confirmed', 'holding-income:1',
                           '{\"holdingOperationId\":\"holding-op-1\"}',
                           '2026-07-27T00:00:00.000Z'
                         )",
                        [vault_id],
                    )
                    .unwrap();
                Ok(())
            })
            .unwrap();
        let error = create_transaction_correction_draft_at(
            &runtime,
            CreateTransactionCorrectionDraftRequest {
                transaction_id: "holding-income".to_owned(),
                correction_kind: "reverse".to_owned(),
                reason: "不应单独更正".to_owned(),
                replacement: None,
            },
        )
        .err()
        .expect("holding-linked transaction correction must fail closed");
        assert!(error.contains("holding operation history"));
    }

    #[test]
    fn revision_atomically_reverses_original_and_appends_replacement() {
        let (_directory, runtime) = runtime_with_accounts();
        let created = create_transaction_draft_at(&runtime, request("expense")).unwrap();
        let original = confirm_transaction_draft_at(
            &runtime,
            ConfirmTransactionDraftRequest {
                draft_id: created.draft_id,
                confirmed_by_user: true,
            },
        )
        .unwrap();
        let mut replacement = request("expense");
        replacement.amount = "1000.00".to_owned();
        replacement.description = "虚构更正流水".to_owned();
        let correction = create_transaction_correction_draft_at(
            &runtime,
            CreateTransactionCorrectionDraftRequest {
                transaction_id: original.transaction_id.clone(),
                correction_kind: "revise".to_owned(),
                reason: "金额录入错误".to_owned(),
                replacement: Some(replacement),
            },
        )
        .unwrap();
        let confirmed = confirm_transaction_correction_draft_at(
            &runtime,
            ConfirmTransactionCorrectionDraftRequest {
                draft_id: correction.draft_id,
                confirmed_by_user: true,
            },
        )
        .unwrap();
        assert!(confirmed.replacement_transaction_id.is_some());
        runtime
            .with_unlocked_connection(|_, connection| {
                let balance: i64 = connection
                    .query_row(
                        "SELECT balance_minor FROM account_balances
                         WHERE account_id = 'account-1'",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(balance, -100_000);
                let snapshot = transaction_snapshot(connection, "vault-1").unwrap();
                assert_eq!(snapshot.len(), 2);
                let reversed = snapshot
                    .iter()
                    .find(|item| item["id"] == original.transaction_id)
                    .unwrap();
                let replacement = snapshot
                    .iter()
                    .find(|item| item["revisesTransactionId"] == original.transaction_id)
                    .unwrap();
                assert_eq!(reversed["reversed"], true);
                assert_eq!(replacement["amountMinor"], 100_000);
                assert_eq!(replacement["description"], "虚构更正流水");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn transfer_reversal_is_double_sided_and_rejected_draft_is_inert() {
        let (_directory, runtime) = runtime_with_accounts();
        let created = create_transaction_draft_at(&runtime, request("transfer")).unwrap();
        let original = confirm_transaction_draft_at(
            &runtime,
            ConfirmTransactionDraftRequest {
                draft_id: created.draft_id,
                confirmed_by_user: true,
            },
        )
        .unwrap();
        let rejected = create_transaction_correction_draft_at(
            &runtime,
            CreateTransactionCorrectionDraftRequest {
                transaction_id: original.transaction_id.clone(),
                correction_kind: "reverse".to_owned(),
                reason: "暂不冲销".to_owned(),
                replacement: None,
            },
        )
        .unwrap();
        reject_transaction_correction_draft_at(
            &runtime,
            RejectTransactionCorrectionDraftRequest {
                draft_id: rejected.draft_id,
            },
        )
        .unwrap();
        let correction = create_transaction_correction_draft_at(
            &runtime,
            CreateTransactionCorrectionDraftRequest {
                transaction_id: original.transaction_id,
                correction_kind: "reverse".to_owned(),
                reason: "账户选择错误".to_owned(),
                replacement: None,
            },
        )
        .unwrap();
        confirm_transaction_correction_draft_at(
            &runtime,
            ConfirmTransactionCorrectionDraftRequest {
                draft_id: correction.draft_id,
                confirmed_by_user: true,
            },
        )
        .unwrap();
        runtime
            .with_unlocked_connection(|_, connection| {
                let counts: (i64, i64, i64) = connection
                    .query_row(
                        "SELECT
                            (SELECT count(*) FROM ledger_events),
                            COALESCE((SELECT balance_minor FROM account_balances
                                      WHERE account_id = 'account-1'), 0),
                            COALESCE((SELECT balance_minor FROM account_balances
                                      WHERE account_id = 'account-2'), 0)",
                        [],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                    )
                    .unwrap();
                assert_eq!(counts, (4, 0, 0));
                Ok(())
            })
            .unwrap();
    }
}
