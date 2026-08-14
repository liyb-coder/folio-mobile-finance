use crate::vault::VaultRuntime;
use chrono::{Datelike, NaiveDate};
use getrandom::fill;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const MAX_SAFE_MINOR: i128 = 9_000_000_000_000_000;
const REMINDER_CATEGORIES: [&str; 7] = [
    "rent",
    "insurance",
    "maturity",
    "repayment",
    "investment",
    "idle_cash",
    "custom",
];
const RECURRENCE_RULES: [&str; 2] = ["monthly", "yearly"];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateReminderDraftRequest {
    title: String,
    category: String,
    linked_account_id: Option<String>,
    amount: Option<String>,
    due_on: String,
    advance_days: i64,
    recurrence_rule: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReminderDraftRequest {
    reminder_id: String,
    title: String,
    category: String,
    linked_account_id: Option<String>,
    amount: Option<String>,
    due_on: String,
    advance_days: i64,
    recurrence_rule: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderActionDraftRequest {
    reminder_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmReminderDraftRequest {
    draft_id: String,
    confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectReminderDraftRequest {
    draft_id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReminderRecord {
    id: String,
    linked_account_id: Option<String>,
    linked_account_name: Option<String>,
    category: String,
    title: String,
    amount_minor: Option<i64>,
    currency: Option<String>,
    due_on: String,
    advance_seconds: i64,
    recurrence_rule: Option<String>,
    recurrence_anchor_month: Option<i64>,
    recurrence_anchor_day: Option<i64>,
    status: String,
    notes: Option<String>,
    created_at: String,
    updated_at: String,
    archived_at: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReminderDraftPayload {
    kind: String,
    action: String,
    reminder_id: String,
    before: Option<ReminderRecord>,
    after: ReminderRecord,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderDraftResponse {
    draft_id: String,
    action: String,
    reminder_id: String,
    title: String,
    category: String,
    linked_account_id: Option<String>,
    linked_account_name: Option<String>,
    amount_minor: Option<i64>,
    currency: Option<String>,
    due_on: String,
    advance_days: i64,
    recurrence_rule: Option<String>,
    status: String,
    notes: Option<String>,
    completed_due_on: Option<String>,
    next_due_on: Option<String>,
    review_status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderConfirmationResponse {
    draft_id: String,
    reminder_id: String,
    action: String,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderRejectionResponse {
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

fn parse_optional_positive_minor(value: Option<String>) -> Result<Option<i64>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
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
    i64::try_from(minor)
        .map(Some)
        .map_err(|_| "Amount is outside the supported range.".to_owned())
}

fn validate_date(connection: &Connection, value: String) -> Result<String, String> {
    let value = value.trim().to_owned();
    let valid: bool = connection
        .query_row("SELECT COALESCE(date(?1) = ?1, 0)", [&value], |row| {
            row.get(0)
        })
        .map_err(|_| "Unable to validate the reminder date.".to_owned())?;
    if !valid {
        return Err("Reminder date must be a valid YYYY-MM-DD date.".to_owned());
    }
    Ok(value)
}

fn normalize_category(value: String) -> Result<String, String> {
    let value = value.trim().to_ascii_lowercase();
    if !REMINDER_CATEGORIES.contains(&value.as_str()) {
        return Err("Reminder category is not supported.".to_owned());
    }
    Ok(value)
}

fn normalize_recurrence(value: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim().to_ascii_lowercase();
    if value.is_empty() || value == "none" {
        return Ok(None);
    }
    if !RECURRENCE_RULES.contains(&value.as_str()) {
        return Err("Reminder recurrence rule is not supported.".to_owned());
    }
    Ok(Some(value))
}

fn recurrence_anchor(
    due_on: &str,
    recurrence_rule: Option<&str>,
) -> Result<(Option<i64>, Option<i64>), String> {
    if recurrence_rule.is_none() {
        return Ok((None, None));
    }
    let due = NaiveDate::parse_from_str(due_on, "%Y-%m-%d")
        .map_err(|_| "Reminder recurrence date is invalid.".to_owned())?;
    Ok((Some(i64::from(due.month())), Some(i64::from(due.day()))))
}

fn days_in_month(year: i32, month: u32) -> Result<u32, String> {
    let (next_year, next_month) = if month == 12 {
        (
            year.checked_add(1)
                .ok_or_else(|| "Reminder recurrence is outside the supported range.".to_owned())?,
            1,
        )
    } else {
        (year, month + 1)
    };
    let next = NaiveDate::from_ymd_opt(next_year, next_month, 1)
        .ok_or_else(|| "Reminder recurrence is outside the supported range.".to_owned())?;
    next.pred_opt()
        .map(|date| date.day())
        .ok_or_else(|| "Reminder recurrence is outside the supported range.".to_owned())
}

fn next_recurrence_due(record: &ReminderRecord) -> Result<Option<String>, String> {
    let Some(rule) = record.recurrence_rule.as_deref() else {
        return Ok(None);
    };
    let current = NaiveDate::parse_from_str(&record.due_on, "%Y-%m-%d")
        .map_err(|_| "Reminder recurrence date is invalid.".to_owned())?;
    let anchor_month = record
        .recurrence_anchor_month
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or(current.month());
    let anchor_day = record
        .recurrence_anchor_day
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or(current.day());
    let (year, month) =
        match rule {
            "monthly" if current.month() == 12 => (
                current.year().checked_add(1).ok_or_else(|| {
                    "Reminder recurrence is outside the supported range.".to_owned()
                })?,
                1,
            ),
            "monthly" => (current.year(), current.month() + 1),
            "yearly" => (
                current.year().checked_add(1).ok_or_else(|| {
                    "Reminder recurrence is outside the supported range.".to_owned()
                })?,
                anchor_month,
            ),
            _ => return Err("Reminder recurrence rule is not supported.".to_owned()),
        };
    let day = anchor_day.min(days_in_month(year, month)?);
    NaiveDate::from_ymd_opt(year, month, day)
        .map(|date| Some(date.format("%Y-%m-%d").to_string()))
        .ok_or_else(|| "Reminder recurrence is outside the supported range.".to_owned())
}

fn normalize_advance_days(value: i64) -> Result<i64, String> {
    if !(0..=3650).contains(&value) {
        return Err("Advance reminder days must be between 0 and 3650.".to_owned());
    }
    value
        .checked_mul(86_400)
        .ok_or_else(|| "Advance reminder interval is outside the supported range.".to_owned())
}

fn now(connection: &Connection) -> Result<String, String> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get(0)
        })
        .map_err(|_| "Unable to create a reminder timestamp.".to_owned())
}

fn vault_base_currency(connection: &Connection, vault_id: &str) -> Result<String, String> {
    connection
        .query_row(
            "SELECT base_currency FROM vaults WHERE id = ?1",
            [vault_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to read the vault base currency.".to_owned())
}

fn active_account(
    connection: &Connection,
    vault_id: &str,
    account_id: Option<String>,
) -> Result<(Option<String>, Option<String>, Option<String>), String> {
    let Some(account_id) = account_id else {
        return Ok((None, None, None));
    };
    let account_id = required_text(account_id, "Account identifier", 96)?;
    let row: Option<(String, String)> = connection
        .query_row(
            "SELECT display_name, currency
             FROM accounts
             WHERE id = ?1 AND vault_id = ?2 AND archived_at IS NULL",
            params![account_id, vault_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|_| "Unable to read the linked reminder account.".to_owned())?;
    let (name, currency) =
        row.ok_or_else(|| "The linked reminder account does not exist or is archived.".to_owned())?;
    Ok((Some(account_id), Some(name), Some(currency)))
}

fn read_reminder(
    connection: &Connection,
    vault_id: &str,
    reminder_id: &str,
) -> Result<ReminderRecord, String> {
    connection
        .query_row(
            "SELECT
                r.id, r.linked_account_id, a.display_name, r.category, r.title,
                r.amount_minor, r.currency, r.due_at, r.advance_seconds,
                r.recurrence_rule, r.recurrence_anchor_month,
                r.recurrence_anchor_day, r.status, r.notes, r.created_at,
                r.updated_at, r.archived_at
             FROM reminders r
             LEFT JOIN accounts a
               ON a.id = r.linked_account_id AND a.vault_id = r.vault_id
             WHERE r.id = ?1 AND r.vault_id = ?2",
            params![reminder_id, vault_id],
            |row| {
                Ok(ReminderRecord {
                    id: row.get(0)?,
                    linked_account_id: row.get(1)?,
                    linked_account_name: row.get(2)?,
                    category: row.get(3)?,
                    title: row.get(4)?,
                    amount_minor: row.get(5)?,
                    currency: row.get(6)?,
                    due_on: row.get(7)?,
                    advance_seconds: row.get(8)?,
                    recurrence_rule: row.get(9)?,
                    recurrence_anchor_month: row.get(10)?,
                    recurrence_anchor_day: row.get(11)?,
                    status: row.get(12)?,
                    notes: row.get(13)?,
                    created_at: row.get(14)?,
                    updated_at: row.get(15)?,
                    archived_at: row.get(16)?,
                })
            },
        )
        .optional()
        .map_err(|_| "Unable to read the encrypted reminder.".to_owned())?
        .ok_or_else(|| "The reminder does not exist.".to_owned())
}

fn validate_editable(record: &ReminderRecord) -> Result<(), String> {
    if record.archived_at.is_some() {
        return Err("An archived reminder cannot be changed.".to_owned());
    }
    if record.status != "active" && record.status != "snoozed" {
        return Err("Only an active reminder can be edited or completed.".to_owned());
    }
    Ok(())
}

fn draft_response(draft_id: String, payload: ReminderDraftPayload) -> ReminderDraftResponse {
    let completed_due_on = if payload.action == "complete" {
        payload.before.as_ref().map(|record| record.due_on.clone())
    } else {
        None
    };
    let next_due_on = if payload.action == "complete" && payload.after.status == "active" {
        Some(payload.after.due_on.clone())
    } else {
        None
    };
    ReminderDraftResponse {
        draft_id,
        action: payload.action,
        reminder_id: payload.reminder_id,
        title: payload.after.title,
        category: payload.after.category,
        linked_account_id: payload.after.linked_account_id,
        linked_account_name: payload.after.linked_account_name,
        amount_minor: payload.after.amount_minor,
        currency: payload.after.currency,
        due_on: payload.after.due_on,
        advance_days: payload.after.advance_seconds / 86_400,
        recurrence_rule: payload.after.recurrence_rule,
        status: payload.after.status,
        notes: payload.after.notes,
        completed_due_on,
        next_due_on,
        review_status: "needs_review",
    }
}

fn save_draft(
    connection: &Connection,
    vault_id: &str,
    payload: ReminderDraftPayload,
) -> Result<ReminderDraftResponse, String> {
    let draft_id = random_id("draft")?;
    let proposed = serde_json::to_string(&payload)
        .map_err(|_| "Unable to serialize the reminder review draft.".to_owned())?;
    let evidence = json!([{
        "source": "manual_entry",
        "reviewRequired": true,
        "action": payload.action
    }])
    .to_string();
    connection
        .execute(
            "INSERT INTO draft_changes(
                id, vault_id, source_type, source_fingerprint, status,
                proposed_events_json, evidence_json, created_at
             ) VALUES (
                ?1, ?2, 'manual_reminder', ?1, 'needs_review',
                ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![draft_id, vault_id, proposed, evidence],
        )
        .map_err(|_| "Unable to save the reminder review draft.".to_owned())?;
    Ok(draft_response(draft_id, payload))
}

fn normalized_after(
    connection: &Connection,
    vault_id: &str,
    reminder_id: String,
    created_at: String,
    request: CreateReminderDraftRequest,
) -> Result<ReminderRecord, String> {
    let title = required_text(request.title, "Reminder title", 120)?;
    let category = normalize_category(request.category)?;
    let (linked_account_id, linked_account_name, account_currency) =
        active_account(connection, vault_id, request.linked_account_id)?;
    let amount_minor = parse_optional_positive_minor(request.amount)?;
    let currency = if amount_minor.is_some() {
        Some(match account_currency {
            Some(currency) => currency,
            None => vault_base_currency(connection, vault_id)?,
        })
    } else {
        None
    };
    let due_on = validate_date(connection, request.due_on)?;
    let advance_seconds = normalize_advance_days(request.advance_days)?;
    let recurrence_rule = normalize_recurrence(request.recurrence_rule)?;
    let (recurrence_anchor_month, recurrence_anchor_day) =
        recurrence_anchor(&due_on, recurrence_rule.as_deref())?;
    let notes = optional_text(request.notes, "Notes", 1000)?;
    Ok(ReminderRecord {
        id: reminder_id,
        linked_account_id,
        linked_account_name,
        category,
        title,
        amount_minor,
        currency,
        due_on,
        advance_seconds,
        recurrence_rule,
        recurrence_anchor_month,
        recurrence_anchor_day,
        status: "active".to_owned(),
        notes,
        created_at: created_at.clone(),
        updated_at: created_at,
        archived_at: None,
    })
}

pub(crate) fn create_reminder_draft_at(
    runtime: &VaultRuntime,
    request: CreateReminderDraftRequest,
) -> Result<ReminderDraftResponse, String> {
    runtime.with_unlocked_connection(|vault_id, connection| {
        let reminder_id = random_id("reminder")?;
        let created_at = now(connection)?;
        let after = normalized_after(
            connection,
            vault_id,
            reminder_id.clone(),
            created_at,
            request,
        )?;
        save_draft(
            connection,
            vault_id,
            ReminderDraftPayload {
                kind: "reminder.create".to_owned(),
                action: "create".to_owned(),
                reminder_id,
                before: None,
                after,
            },
        )
    })
}

fn update_reminder_draft_at(
    runtime: &VaultRuntime,
    request: UpdateReminderDraftRequest,
) -> Result<ReminderDraftResponse, String> {
    let reminder_id = required_text(request.reminder_id, "Reminder identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let before = read_reminder(connection, vault_id, &reminder_id)?;
        validate_editable(&before)?;
        let created_at = before.created_at.clone();
        let mut after = normalized_after(
            connection,
            vault_id,
            reminder_id.clone(),
            created_at,
            CreateReminderDraftRequest {
                title: request.title,
                category: request.category,
                linked_account_id: request.linked_account_id,
                amount: request.amount,
                due_on: request.due_on,
                advance_days: request.advance_days,
                recurrence_rule: request.recurrence_rule,
                notes: request.notes,
            },
        )?;
        after.updated_at = now(connection)?;
        save_draft(
            connection,
            vault_id,
            ReminderDraftPayload {
                kind: "reminder.update".to_owned(),
                action: "update".to_owned(),
                reminder_id,
                before: Some(before),
                after,
            },
        )
    })
}

fn action_reminder_draft_at(
    runtime: &VaultRuntime,
    request: ReminderActionDraftRequest,
    action: &str,
) -> Result<ReminderDraftResponse, String> {
    let reminder_id = required_text(request.reminder_id, "Reminder identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let before = read_reminder(connection, vault_id, &reminder_id)?;
        if action == "complete" {
            validate_editable(&before)?;
        } else if before.archived_at.is_some() {
            return Err("The reminder is already archived.".to_owned());
        }
        let mut after = before.clone();
        after.updated_at = now(connection)?;
        match action {
            "complete" => {
                if let Some(next_due_on) = next_recurrence_due(&before)? {
                    after.due_on = next_due_on;
                    after.status = "active".to_owned();
                } else {
                    after.status = "completed".to_owned();
                }
            }
            "archive" => {
                after.status = "ignored".to_owned();
                after.archived_at = Some(after.updated_at.clone());
            }
            _ => return Err("Reminder action is not supported.".to_owned()),
        }
        save_draft(
            connection,
            vault_id,
            ReminderDraftPayload {
                kind: format!("reminder.{action}"),
                action: action.to_owned(),
                reminder_id,
                before: Some(before),
                after,
            },
        )
    })
}

pub(crate) fn confirm_reminder_draft_at(
    runtime: &VaultRuntime,
    request: ConfirmReminderDraftRequest,
) -> Result<ReminderConfirmationResponse, String> {
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
                   AND source_type = 'manual_reminder'",
                params![draft_id, vault_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| "Unable to read the reminder review draft.".to_owned())?;
        let (status, proposed) =
            row.ok_or_else(|| "The reminder review draft does not exist.".to_owned())?;
        let payload: ReminderDraftPayload = serde_json::from_str(&proposed)
            .map_err(|_| "The reminder review draft is invalid.".to_owned())?;
        if status == "confirmed" {
            return Ok(ReminderConfirmationResponse {
                draft_id,
                reminder_id: payload.reminder_id,
                action: payload.action,
                status: "confirmed",
            });
        }
        if status != "needs_review" {
            return Err("Only a pending reminder draft can be confirmed.".to_owned());
        }

        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "Unable to start the reminder confirmation transaction.".to_owned())?;
        if payload.action == "create" {
            transaction
                .execute(
                    "INSERT INTO reminders(
                        id, vault_id, linked_account_id, category, title,
                        amount_minor, currency, due_at, advance_seconds,
                        recurrence_rule, recurrence_anchor_month,
                        recurrence_anchor_day, status, notes, created_at,
                        updated_at, archived_at
                     ) VALUES (
                        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                        ?11, ?12, ?13, ?14, ?15, ?16, ?17
                     )",
                    params![
                        payload.after.id,
                        vault_id,
                        payload.after.linked_account_id,
                        payload.after.category,
                        payload.after.title,
                        payload.after.amount_minor,
                        payload.after.currency,
                        payload.after.due_on,
                        payload.after.advance_seconds,
                        payload.after.recurrence_rule,
                        payload.after.recurrence_anchor_month,
                        payload.after.recurrence_anchor_day,
                        payload.after.status,
                        payload.after.notes,
                        payload.after.created_at,
                        payload.after.updated_at,
                        payload.after.archived_at
                    ],
                )
                .map_err(|_| "Unable to create the encrypted reminder.".to_owned())?;
        } else {
            let current = read_reminder(&transaction, vault_id, &payload.reminder_id)?;
            if payload.before.as_ref() != Some(&current) {
                return Err(
                    "The reminder changed after review. Create a new review draft.".to_owned(),
                );
            }
            transaction
                .execute(
                    "UPDATE reminders
                     SET linked_account_id = ?1, category = ?2, title = ?3,
                         amount_minor = ?4, currency = ?5, due_at = ?6,
                         advance_seconds = ?7, recurrence_rule = ?8,
                         recurrence_anchor_month = ?9,
                         recurrence_anchor_day = ?10, status = ?11,
                         notes = ?12, updated_at = ?13, archived_at = ?14
                     WHERE id = ?15 AND vault_id = ?16",
                    params![
                        payload.after.linked_account_id,
                        payload.after.category,
                        payload.after.title,
                        payload.after.amount_minor,
                        payload.after.currency,
                        payload.after.due_on,
                        payload.after.advance_seconds,
                        payload.after.recurrence_rule,
                        payload.after.recurrence_anchor_month,
                        payload.after.recurrence_anchor_day,
                        payload.after.status,
                        payload.after.notes,
                        payload.after.updated_at,
                        payload.after.archived_at,
                        payload.after.id,
                        vault_id
                    ],
                )
                .map_err(|_| "Unable to update the encrypted reminder.".to_owned())?;
        }

        if payload.action == "complete" {
            let before = payload
                .before
                .as_ref()
                .ok_or_else(|| "Completed reminder draft is missing its prior state.".to_owned())?;
            let next_due_on = if payload.after.status == "active" {
                Some(payload.after.due_on.as_str())
            } else {
                None
            };
            transaction
                .execute(
                    "INSERT INTO reminder_occurrences(
                        id, reminder_id, due_on, completed_at, next_due_on,
                        confirmation_draft_id, created_at
                     ) VALUES (
                        ?1, ?2, ?3, ?4, ?5, ?6,
                        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                     )",
                    params![
                        random_id("reminder_occurrence")?,
                        payload.reminder_id,
                        before.due_on,
                        payload.after.updated_at,
                        next_due_on,
                        draft_id,
                    ],
                )
                .map_err(|_| "Unable to append the reminder occurrence.".to_owned())?;
        }

        let event_action = match payload.action.as_str() {
            "create" => "created",
            "update" => "updated",
            "complete" => "completed",
            "archive" => "archived",
            _ => return Err("Reminder draft action is not supported.".to_owned()),
        };
        let history_metadata = json!({
            "draftId": draft_id,
            "before": payload.before,
            "after": payload.after
        })
        .to_string();
        transaction
            .execute(
                "INSERT INTO reminder_events(
                    id, reminder_id, action, occurred_at, metadata_json
                 ) VALUES (
                    ?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?4
                 )",
                params![
                    random_id("reminder_event")?,
                    payload.reminder_id,
                    event_action,
                    history_metadata
                ],
            )
            .map_err(|_| "Unable to append the reminder history event.".to_owned())?;
        transaction
            .execute(
                "UPDATE draft_changes
                 SET status = 'confirmed',
                     confirmed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                     confirmed_by = 'local_user'
                 WHERE id = ?1 AND vault_id = ?2 AND status = 'needs_review'",
                params![draft_id, vault_id],
            )
            .map_err(|_| "Unable to confirm the reminder review draft.".to_owned())?;
        transaction
            .execute(
                "INSERT INTO audit_events(
                    id, vault_id, category, action, actor_id,
                    object_type, object_id, metadata_json, occurred_at
                 ) VALUES (
                    ?1, ?2, 'data', ?3, 'local_user',
                    'reminder', ?4, ?5,
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![
                    random_id("audit")?,
                    vault_id,
                    format!("reminder_{}", payload.action),
                    payload.reminder_id,
                    json!({
                        "draftId": draft_id,
                        "before": payload.before,
                        "after": payload.after
                    })
                    .to_string()
                ],
            )
            .map_err(|_| "Unable to append the reminder audit event.".to_owned())?;
        transaction
            .commit()
            .map_err(|_| "Unable to commit the reminder change.".to_owned())?;
        Ok(ReminderConfirmationResponse {
            draft_id,
            reminder_id: payload.reminder_id,
            action: payload.action,
            status: "confirmed",
        })
    })
}

fn reject_reminder_draft_at(
    runtime: &VaultRuntime,
    request: RejectReminderDraftRequest,
) -> Result<ReminderRejectionResponse, String> {
    let draft_id = required_text(request.draft_id, "Draft identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let status: Option<String> = connection
            .query_row(
                "SELECT status FROM draft_changes
                 WHERE id = ?1 AND vault_id = ?2
                   AND source_type = 'manual_reminder'",
                params![draft_id, vault_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| "Unable to read the reminder review draft.".to_owned())?;
        let status =
            status.ok_or_else(|| "The reminder review draft does not exist.".to_owned())?;
        if status == "rejected" {
            return Ok(ReminderRejectionResponse {
                draft_id,
                status: "rejected",
            });
        }
        if status != "needs_review" {
            return Err("Only a pending reminder draft can be rejected.".to_owned());
        }
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "Unable to start the reminder draft rejection.".to_owned())?;
        transaction
            .execute(
                "UPDATE draft_changes
                 SET status = 'rejected',
                     rejected_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                     rejection_reason = 'cancelled_by_user'
                 WHERE id = ?1 AND vault_id = ?2 AND status = 'needs_review'",
                params![draft_id, vault_id],
            )
            .map_err(|_| "Unable to reject the reminder review draft.".to_owned())?;
        transaction
            .execute(
                "INSERT INTO audit_events(
                    id, vault_id, category, action, actor_id,
                    object_type, object_id, metadata_json, occurred_at
                 ) VALUES (
                    ?1, ?2, 'data', 'reminder_draft_rejected', 'local_user',
                    'draft_change', ?3, '{}',
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![random_id("audit")?, vault_id, draft_id],
            )
            .map_err(|_| "Unable to append the reminder draft audit event.".to_owned())?;
        transaction
            .commit()
            .map_err(|_| "Unable to commit the reminder draft rejection.".to_owned())?;
        Ok(ReminderRejectionResponse {
            draft_id,
            status: "rejected",
        })
    })
}

pub(crate) fn reminder_snapshot(
    connection: &Connection,
    vault_id: &str,
) -> Result<Vec<Value>, String> {
    let mut statement = connection
        .prepare(
            "SELECT
                r.id, r.linked_account_id, a.display_name, r.category, r.title,
                r.amount_minor, r.currency, r.due_at, r.advance_seconds,
                r.recurrence_rule, r.status, r.notes, r.created_at, r.updated_at,
                (SELECT count(*) FROM reminder_occurrences occurrence
                 WHERE occurrence.reminder_id = r.id),
                (SELECT max(due_on) FROM reminder_occurrences occurrence
                 WHERE occurrence.reminder_id = r.id)
             FROM reminders r
             LEFT JOIN accounts a
               ON a.id = r.linked_account_id AND a.vault_id = r.vault_id
             WHERE r.vault_id = ?1 AND r.archived_at IS NULL
             ORDER BY
               CASE r.status WHEN 'active' THEN 0 WHEN 'snoozed' THEN 1 ELSE 2 END,
               r.due_at ASC, r.updated_at DESC, r.id DESC",
        )
        .map_err(|_| "Unable to prepare the reminder snapshot.".to_owned())?;
    let rows = statement
        .query_map([vault_id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "linkedAccountId": row.get::<_, Option<String>>(1)?,
                "linkedAccountName": row.get::<_, Option<String>>(2)?,
                "category": row.get::<_, String>(3)?,
                "title": row.get::<_, String>(4)?,
                "amountMinor": row.get::<_, Option<i64>>(5)?,
                "currency": row.get::<_, Option<String>>(6)?,
                "dueOn": row.get::<_, String>(7)?,
                "advanceDays": row.get::<_, i64>(8)? / 86_400,
                "recurrenceRule": row.get::<_, Option<String>>(9)?,
                "status": row.get::<_, String>(10)?,
                "notes": row.get::<_, Option<String>>(11)?,
                "createdAt": row.get::<_, String>(12)?,
                "updatedAt": row.get::<_, String>(13)?
                ,"completedOccurrences": row.get::<_, i64>(14)?
                ,"lastCompletedOn": row.get::<_, Option<String>>(15)?
            }))
        })
        .map_err(|_| "Unable to read encrypted reminders.".to_owned())?;
    let mut reminders = Vec::new();
    for row in rows {
        reminders.push(row.map_err(|_| "Unable to decode the reminder snapshot.".to_owned())?);
    }
    Ok(reminders)
}

#[tauri::command]
pub fn reminder_create_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: CreateReminderDraftRequest,
) -> Result<ReminderDraftResponse, String> {
    create_reminder_draft_at(&runtime, request)
}

#[tauri::command]
pub fn reminder_update_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: UpdateReminderDraftRequest,
) -> Result<ReminderDraftResponse, String> {
    update_reminder_draft_at(&runtime, request)
}

#[tauri::command]
pub fn reminder_complete_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: ReminderActionDraftRequest,
) -> Result<ReminderDraftResponse, String> {
    action_reminder_draft_at(&runtime, request, "complete")
}

#[tauri::command]
pub fn reminder_archive_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: ReminderActionDraftRequest,
) -> Result<ReminderDraftResponse, String> {
    action_reminder_draft_at(&runtime, request, "archive")
}

#[tauri::command]
pub fn reminder_confirm_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: ConfirmReminderDraftRequest,
) -> Result<ReminderConfirmationResponse, String> {
    confirm_reminder_draft_at(&runtime, request)
}

#[tauri::command]
pub fn reminder_reject_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: RejectReminderDraftRequest,
) -> Result<ReminderRejectionResponse, String> {
    reject_reminder_draft_at(&runtime, request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::open_encrypted;

    fn runtime_with_account() -> (tempfile::TempDir, VaultRuntime) {
        let directory = tempfile::tempdir().expect("temporary directory should exist");
        let connection = open_encrypted(&directory.path().join("reminders.sqlite3"), &[41_u8; 32])
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
                 ) VALUES (
                    'account-1', 'vault-1', '演示银行', '日常账户',
                    'cash', 'CNY', '2026-07-27T00:00:00.000Z'
                 )",
                [],
            )
            .unwrap();
        let runtime = VaultRuntime::default();
        runtime.install_test_session("vault-1", connection);
        (directory, runtime)
    }

    fn create_request() -> CreateReminderDraftRequest {
        CreateReminderDraftRequest {
            title: "虚构保险续缴".to_owned(),
            category: "insurance".to_owned(),
            linked_account_id: Some("account-1".to_owned()),
            amount: Some("12800.50".to_owned()),
            due_on: "2026-08-02".to_owned(),
            advance_days: 3,
            recurrence_rule: Some("yearly".to_owned()),
            notes: Some("仅用于测试".to_owned()),
        }
    }

    fn confirm(runtime: &VaultRuntime, draft_id: String) -> ReminderConfirmationResponse {
        confirm_reminder_draft_at(
            runtime,
            ConfirmReminderDraftRequest {
                draft_id,
                confirmed_by_user: true,
            },
        )
        .expect("draft should confirm")
    }

    #[test]
    fn reminder_amount_is_exact_and_optional() {
        assert_eq!(
            parse_optional_positive_minor(Some("12800.50".to_owned())).unwrap(),
            Some(1_280_050)
        );
        assert_eq!(parse_optional_positive_minor(None).unwrap(), None);
        for invalid in ["0", "-1", "1.001", "1e2", "NaN"] {
            assert!(parse_optional_positive_minor(Some(invalid.to_owned())).is_err());
        }
    }

    #[test]
    fn recurring_dates_keep_the_original_day_anchor() {
        let monthly = ReminderRecord {
            id: "reminder-monthly".to_owned(),
            linked_account_id: None,
            linked_account_name: None,
            category: "custom".to_owned(),
            title: "月末复核".to_owned(),
            amount_minor: None,
            currency: None,
            due_on: "2026-01-31".to_owned(),
            advance_seconds: 0,
            recurrence_rule: Some("monthly".to_owned()),
            recurrence_anchor_month: Some(1),
            recurrence_anchor_day: Some(31),
            status: "active".to_owned(),
            notes: None,
            created_at: "2026-01-01T00:00:00.000Z".to_owned(),
            updated_at: "2026-01-01T00:00:00.000Z".to_owned(),
            archived_at: None,
        };
        assert_eq!(
            next_recurrence_due(&monthly).unwrap().as_deref(),
            Some("2026-02-28")
        );
        let mut february = monthly;
        february.due_on = "2026-02-28".to_owned();
        assert_eq!(
            next_recurrence_due(&february).unwrap().as_deref(),
            Some("2026-03-31")
        );

        let mut leap_year = february;
        leap_year.due_on = "2024-02-29".to_owned();
        leap_year.recurrence_rule = Some("yearly".to_owned());
        leap_year.recurrence_anchor_month = Some(2);
        leap_year.recurrence_anchor_day = Some(29);
        assert_eq!(
            next_recurrence_due(&leap_year).unwrap().as_deref(),
            Some("2025-02-28")
        );
    }

    #[test]
    fn create_requires_review_and_confirmation_is_idempotent() {
        let (_directory, runtime) = runtime_with_account();
        let draft = create_reminder_draft_at(&runtime, create_request()).unwrap();
        assert_eq!(draft.amount_minor, Some(1_280_050));
        runtime
            .with_unlocked_connection(|_, connection| {
                let count: i64 = connection
                    .query_row("SELECT count(*) FROM reminders", [], |row| row.get(0))
                    .unwrap();
                assert_eq!(count, 0);
                Ok(())
            })
            .unwrap();
        let first = confirm(&runtime, draft.draft_id.clone());
        let retry = confirm(&runtime, draft.draft_id);
        assert_eq!(retry.reminder_id, first.reminder_id);
        runtime
            .with_unlocked_connection(|_, connection| {
                let counts: (i64, i64, i64) = connection
                    .query_row(
                        "SELECT
                            (SELECT count(*) FROM reminders),
                            (SELECT count(*) FROM reminder_events),
                            (SELECT count(*) FROM audit_events WHERE action = 'reminder_create')",
                        [],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                    )
                    .unwrap();
                assert_eq!(counts, (1, 1, 1));
                let snapshot = reminder_snapshot(connection, "vault-1").unwrap();
                assert_eq!(snapshot.len(), 1);
                assert_eq!(snapshot[0]["title"], "虚构保险续缴");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn update_rejects_stale_review_and_preserves_history() {
        let (_directory, runtime) = runtime_with_account();
        let created = create_reminder_draft_at(&runtime, create_request()).unwrap();
        let confirmed = confirm(&runtime, created.draft_id);
        let update = update_reminder_draft_at(
            &runtime,
            UpdateReminderDraftRequest {
                reminder_id: confirmed.reminder_id.clone(),
                title: "虚构保险续缴（已核对）".to_owned(),
                category: "insurance".to_owned(),
                linked_account_id: Some("account-1".to_owned()),
                amount: Some("13000".to_owned()),
                due_on: "2026-08-03".to_owned(),
                advance_days: 7,
                recurrence_rule: Some("yearly".to_owned()),
                notes: None,
            },
        )
        .unwrap();
        runtime
            .with_unlocked_connection(|_, connection| {
                connection
                    .execute(
                        "UPDATE reminders SET title = '并发修改' WHERE id = ?1",
                        [&confirmed.reminder_id],
                    )
                    .unwrap();
                Ok(())
            })
            .unwrap();
        assert!(confirm_reminder_draft_at(
            &runtime,
            ConfirmReminderDraftRequest {
                draft_id: update.draft_id,
                confirmed_by_user: true,
            }
        )
        .is_err());
        runtime
            .with_unlocked_connection(|_, connection| {
                let event_count: i64 = connection
                    .query_row("SELECT count(*) FROM reminder_events", [], |row| row.get(0))
                    .unwrap();
                assert_eq!(event_count, 1);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn complete_and_archive_keep_an_audit_trail() {
        let (_directory, runtime) = runtime_with_account();
        let first = create_reminder_draft_at(&runtime, create_request()).unwrap();
        let first_id = confirm(&runtime, first.draft_id).reminder_id;
        let complete = action_reminder_draft_at(
            &runtime,
            ReminderActionDraftRequest {
                reminder_id: first_id.clone(),
            },
            "complete",
        )
        .unwrap();
        confirm(&runtime, complete.draft_id);

        let second = create_reminder_draft_at(
            &runtime,
            CreateReminderDraftRequest {
                title: "虚构租金核对".to_owned(),
                category: "rent".to_owned(),
                linked_account_id: None,
                amount: None,
                due_on: "2026-08-05".to_owned(),
                advance_days: 1,
                recurrence_rule: Some("monthly".to_owned()),
                notes: None,
            },
        )
        .unwrap();
        let second_id = confirm(&runtime, second.draft_id).reminder_id;
        let archive = action_reminder_draft_at(
            &runtime,
            ReminderActionDraftRequest {
                reminder_id: second_id.clone(),
            },
            "archive",
        )
        .unwrap();
        confirm(&runtime, archive.draft_id);

        runtime
            .with_unlocked_connection(|_, connection| {
                let first_state: (String, String) = connection
                    .query_row(
                        "SELECT status, due_at FROM reminders WHERE id = ?1",
                        [&first_id],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .unwrap();
                let second_state: (String, bool) = connection
                    .query_row(
                        "SELECT status, archived_at IS NOT NULL
                         FROM reminders WHERE id = ?1",
                        [&second_id],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .unwrap();
                assert_eq!(first_state, ("active".to_owned(), "2027-08-02".to_owned()));
                assert_eq!(second_state, ("ignored".to_owned(), true));
                let occurrence: (String, Option<String>) = connection
                    .query_row(
                        "SELECT due_on, next_due_on
                         FROM reminder_occurrences WHERE reminder_id = ?1",
                        [&first_id],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .unwrap();
                assert_eq!(
                    occurrence,
                    ("2026-08-02".to_owned(), Some("2027-08-02".to_owned()))
                );
                assert!(connection
                    .execute(
                        "UPDATE reminder_occurrences
                         SET completed_at = 'tampered' WHERE reminder_id = ?1",
                        [&first_id]
                    )
                    .is_err());
                let snapshot = reminder_snapshot(connection, "vault-1").unwrap();
                assert_eq!(snapshot.len(), 1);
                assert_eq!(snapshot[0]["status"], "active");
                assert_eq!(snapshot[0]["completedOccurrences"], 1);
                assert_eq!(snapshot[0]["lastCompletedOn"], "2026-08-02");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn rejected_draft_never_creates_a_reminder() {
        let (_directory, runtime) = runtime_with_account();
        let draft = create_reminder_draft_at(&runtime, create_request()).unwrap();
        reject_reminder_draft_at(
            &runtime,
            RejectReminderDraftRequest {
                draft_id: draft.draft_id.clone(),
            },
        )
        .unwrap();
        assert!(confirm_reminder_draft_at(
            &runtime,
            ConfirmReminderDraftRequest {
                draft_id: draft.draft_id,
                confirmed_by_user: true,
            }
        )
        .is_err());
        runtime
            .with_unlocked_connection(|_, connection| {
                let count: i64 = connection
                    .query_row("SELECT count(*) FROM reminders", [], |row| row.get(0))
                    .unwrap();
                assert_eq!(count, 0);
                Ok(())
            })
            .unwrap();
    }
}
