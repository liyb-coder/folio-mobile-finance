use crate::vault::VaultRuntime;
use getrandom::fill;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::json;

const MAX_SAFE_MINOR: i128 = 9_000_000_000_000_000;
const MAX_SAFE_UNITS_MICROS: i128 = 9_000_000_000_000_000;
const PRODUCT_TYPES: [&str; 6] = [
    "cash_management",
    "fixed_income",
    "fund",
    "security",
    "insurance",
    "other",
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateHoldingDraftRequest {
    account_id: String,
    name: String,
    product_type: String,
    currency: String,
    masked_identifier: Option<String>,
    units: String,
    cost_basis: String,
    market_value: String,
    as_of_date: String,
    notes: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateHoldingValuationDraftRequest {
    holding_id: String,
    units: String,
    cost_basis: String,
    market_value: String,
    as_of_date: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateHoldingDraftRequest {
    holding_id: String,
    name: String,
    product_type: String,
    masked_identifier: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveHoldingDraftRequest {
    holding_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmHoldingDraftRequest {
    draft_id: String,
    confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectHoldingDraftRequest {
    draft_id: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HoldingCreatePayload {
    kind: String,
    holding_id: String,
    valuation_id: String,
    account_id: String,
    account_name: String,
    name: String,
    product_type: String,
    currency: String,
    masked_identifier: Option<String>,
    units_micros: i64,
    cost_basis_minor: i64,
    market_value_minor: i64,
    as_of_date: String,
    notes: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HoldingValuationPayload {
    kind: String,
    holding_id: String,
    holding_name: String,
    account_name: String,
    currency: String,
    previous_valuation_id: String,
    valuation_id: String,
    units_micros: i64,
    cost_basis_minor: i64,
    market_value_minor: i64,
    as_of_date: String,
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct HoldingProfile {
    account_id: String,
    account_name: String,
    name: String,
    product_type: String,
    currency: String,
    masked_identifier: Option<String>,
    notes: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HoldingUpdatePayload {
    kind: String,
    holding_id: String,
    before: HoldingProfile,
    after: HoldingProfile,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HoldingArchivePayload {
    kind: String,
    holding_id: String,
    profile: HoldingProfile,
    latest_valuation_id: String,
    units_micros: i64,
    cost_basis_minor: i64,
    market_value_minor: i64,
    as_of_date: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HoldingDraftHeader {
    kind: String,
    holding_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HoldingDraftResponse {
    draft_id: String,
    action: &'static str,
    holding_id: String,
    account_id: Option<String>,
    account_name: String,
    name: String,
    product_type: Option<String>,
    currency: String,
    masked_identifier: Option<String>,
    units_micros: i64,
    cost_basis_minor: i64,
    market_value_minor: i64,
    as_of_date: String,
    notes: Option<String>,
    before: Option<serde_json::Value>,
    status: &'static str,
    affects_account_balance: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HoldingConfirmationResponse {
    draft_id: String,
    holding_id: String,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HoldingRejectionResponse {
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

fn normalize_product_type(value: String) -> Result<String, String> {
    let product_type = value.trim().to_ascii_lowercase();
    if !PRODUCT_TYPES.contains(&product_type.as_str()) {
        return Err("Holding product type is not supported.".to_owned());
    }
    Ok(product_type)
}

fn normalize_masked_identifier(value: Option<String>) -> Result<Option<String>, String> {
    let value = optional_text(value, "Holding identifier", 16)?;
    if let Some(identifier) = value.as_ref() {
        if !identifier
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            return Err("Holding identifier may contain only letters, numbers, or '-'.".to_owned());
        }
    }
    Ok(value)
}

fn parse_fixed(value: &str, decimals: u32, field: &str, maximum: i128) -> Result<i64, String> {
    let value = value.trim();
    let mut parts = value.split('.');
    let major = parts.next().unwrap_or_default();
    let fraction = parts.next();
    if parts.next().is_some()
        || major.is_empty()
        || !major.bytes().all(|byte| byte.is_ascii_digit())
        || fraction.is_some_and(|part| {
            part.is_empty()
                || part.len() > decimals as usize
                || !part.bytes().all(|byte| byte.is_ascii_digit())
        })
    {
        return Err(format!(
            "{field} must be a non-negative number with at most {decimals} decimal places."
        ));
    }
    let scale = 10_i128.pow(decimals);
    let major: i128 = major
        .parse()
        .map_err(|_| format!("{field} is outside the supported range."))?;
    let fraction = fraction.unwrap_or_default();
    let fraction_value: i128 = if fraction.is_empty() {
        0
    } else {
        fraction
            .parse::<i128>()
            .map_err(|_| format!("{field} is invalid."))?
            * 10_i128.pow(decimals - fraction.len() as u32)
    };
    let result = major
        .checked_mul(scale)
        .and_then(|number| number.checked_add(fraction_value))
        .ok_or_else(|| format!("{field} is outside the supported range."))?;
    if result > maximum {
        return Err(format!("{field} is outside the supported range."));
    }
    i64::try_from(result).map_err(|_| format!("{field} is outside the supported range."))
}

fn parse_money(value: &str, field: &str) -> Result<i64, String> {
    parse_fixed(value, 2, field, MAX_SAFE_MINOR)
}

fn parse_units(value: &str) -> Result<i64, String> {
    parse_fixed(value, 6, "Holding units", MAX_SAFE_UNITS_MICROS)
}

fn validate_date(connection: &Connection, value: String) -> Result<String, String> {
    let value = value.trim().to_owned();
    let valid: bool = connection
        .query_row("SELECT COALESCE(date(?1) = ?1, 0)", [&value], |row| {
            row.get(0)
        })
        .map_err(|_| "Unable to validate holding valuation date.".to_owned())?;
    if !valid {
        return Err("Holding valuation date is invalid.".to_owned());
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
            "SELECT display_name, currency FROM accounts
             WHERE id = ?1 AND vault_id = ?2 AND archived_at IS NULL",
            params![account_id, vault_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|_| "Unable to read the holding account.".to_owned())?
        .ok_or_else(|| "The holding account does not exist or is archived.".to_owned())
}

fn holding_name_exists(
    connection: &Connection,
    vault_id: &str,
    account_id: &str,
    name: &str,
    excluded_holding_id: Option<&str>,
) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM holdings
               WHERE vault_id = ?1 AND account_id = ?2 AND name = ?3
                 AND (?4 IS NULL OR id <> ?4)
             )",
            params![vault_id, account_id, name, excluded_holding_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to check existing holdings.".to_owned())
}

fn insert_draft(
    connection: &Connection,
    vault_id: &str,
    draft_id: &str,
    proposed: &str,
    action: &str,
) -> Result<(), String> {
    let evidence = json!([{
        "source": "manual_holding",
        "action": action,
        "reviewRequired": true,
        "affectsAccountBalance": false
    }])
    .to_string();
    connection
        .execute(
            "INSERT INTO draft_changes(
               id, vault_id, source_type, source_fingerprint, status,
               proposed_events_json, evidence_json, created_at
             ) VALUES (
               ?1, ?2, 'manual_holding', ?1, 'needs_review',
               ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![draft_id, vault_id, proposed, evidence],
        )
        .map_err(|_| "Unable to save the holding review draft.".to_owned())?;
    Ok(())
}

pub(crate) fn create_holding_draft_at(
    runtime: &VaultRuntime,
    request: CreateHoldingDraftRequest,
) -> Result<HoldingDraftResponse, String> {
    let account_id = required_text(request.account_id, "Account identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let (account_name, account_currency) = active_account(connection, vault_id, &account_id)?;
        let name = required_text(request.name, "Holding name", 120)?;
        let product_type = normalize_product_type(request.product_type)?;
        let currency = normalize_currency(request.currency)?;
        if currency != account_currency {
            return Err("Holding currency must match its account currency.".to_owned());
        }
        if holding_name_exists(connection, vault_id, &account_id, &name, None)? {
            return Err("A holding with the same account and name already exists.".to_owned());
        }
        let masked_identifier = normalize_masked_identifier(request.masked_identifier)?;
        let units_micros = parse_units(&request.units)?;
        let cost_basis_minor = parse_money(&request.cost_basis, "Holding cost basis")?;
        let market_value_minor = parse_money(&request.market_value, "Holding market value")?;
        let as_of_date = validate_date(connection, request.as_of_date)?;
        let notes = optional_text(request.notes, "Holding notes", 1000)?;

        let draft_id = random_id("draft")?;
        let payload = HoldingCreatePayload {
            kind: "holding.create".to_owned(),
            holding_id: random_id("holding")?,
            valuation_id: random_id("valuation")?,
            account_id,
            account_name,
            name,
            product_type,
            currency,
            masked_identifier,
            units_micros,
            cost_basis_minor,
            market_value_minor,
            as_of_date,
            notes,
        };
        let proposed = serde_json::to_string(&payload)
            .map_err(|_| "Unable to serialize the holding draft.".to_owned())?;
        insert_draft(connection, vault_id, &draft_id, &proposed, "create")?;
        Ok(HoldingDraftResponse {
            draft_id,
            action: "create",
            holding_id: payload.holding_id,
            account_id: Some(payload.account_id),
            account_name: payload.account_name,
            name: payload.name,
            product_type: Some(payload.product_type),
            currency: payload.currency,
            masked_identifier: payload.masked_identifier,
            units_micros: payload.units_micros,
            cost_basis_minor: payload.cost_basis_minor,
            market_value_minor: payload.market_value_minor,
            as_of_date: payload.as_of_date,
            notes: payload.notes,
            before: None,
            status: "needs_review",
            affects_account_balance: false,
        })
    })
}

fn latest_holding_valuation(
    connection: &Connection,
    vault_id: &str,
    holding_id: &str,
) -> Result<(String, String, String, String, i64, i64, i64, String), String> {
    connection
        .query_row(
            "SELECT
               h.name, a.display_name, h.currency, v.id,
               v.units_micros, v.cost_basis_minor, v.market_value_minor, v.as_of_date
             FROM holdings h
             JOIN accounts a ON a.id = h.account_id AND a.vault_id = h.vault_id
             JOIN holding_valuations v ON v.id = (
               SELECT latest.id FROM holding_valuations latest
               WHERE latest.vault_id = h.vault_id AND latest.holding_id = h.id
               ORDER BY latest.as_of_date DESC, latest.created_at DESC, latest.id DESC
               LIMIT 1
             )
             WHERE h.id = ?1 AND h.vault_id = ?2 AND h.archived_at IS NULL",
            params![holding_id, vault_id],
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
                ))
            },
        )
        .optional()
        .map_err(|_| "Unable to read the encrypted holding.".to_owned())?
        .ok_or_else(|| "The holding does not exist or is archived.".to_owned())
}

fn create_holding_valuation_draft_at(
    runtime: &VaultRuntime,
    request: CreateHoldingValuationDraftRequest,
) -> Result<HoldingDraftResponse, String> {
    let holding_id = required_text(request.holding_id, "Holding identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let (
            holding_name,
            account_name,
            currency,
            previous_valuation_id,
            previous_units,
            previous_cost,
            previous_market,
            previous_date,
        ) = latest_holding_valuation(connection, vault_id, &holding_id)?;
        let units_micros = parse_units(&request.units)?;
        let cost_basis_minor = parse_money(&request.cost_basis, "Holding cost basis")?;
        let market_value_minor = parse_money(&request.market_value, "Holding market value")?;
        let as_of_date = validate_date(connection, request.as_of_date)?;
        if (
            units_micros,
            cost_basis_minor,
            market_value_minor,
            as_of_date.as_str(),
        ) == (
            previous_units,
            previous_cost,
            previous_market,
            previous_date.as_str(),
        ) {
            return Err("No holding valuation changes were provided.".to_owned());
        }
        if as_of_date < previous_date {
            return Err(
                "Holding valuation date cannot be older than the current snapshot.".to_owned(),
            );
        }

        let draft_id = random_id("draft")?;
        let payload = HoldingValuationPayload {
            kind: "holding.valuation".to_owned(),
            holding_id,
            holding_name,
            account_name,
            currency,
            previous_valuation_id,
            valuation_id: random_id("valuation")?,
            units_micros,
            cost_basis_minor,
            market_value_minor,
            as_of_date,
        };
        let proposed = serde_json::to_string(&payload)
            .map_err(|_| "Unable to serialize the holding valuation draft.".to_owned())?;
        insert_draft(connection, vault_id, &draft_id, &proposed, "valuation")?;
        Ok(HoldingDraftResponse {
            draft_id,
            action: "valuation",
            holding_id: payload.holding_id,
            account_id: None,
            account_name: payload.account_name,
            name: payload.holding_name,
            product_type: None,
            currency: payload.currency,
            masked_identifier: None,
            units_micros: payload.units_micros,
            cost_basis_minor: payload.cost_basis_minor,
            market_value_minor: payload.market_value_minor,
            as_of_date: payload.as_of_date,
            notes: None,
            before: None,
            status: "needs_review",
            affects_account_balance: false,
        })
    })
}

fn holding_profile(
    connection: &Connection,
    vault_id: &str,
    holding_id: &str,
) -> Result<HoldingProfile, String> {
    connection
        .query_row(
            "SELECT
               h.account_id, a.display_name, h.name, h.product_type,
               h.currency, h.masked_identifier, h.notes
             FROM holdings h
             JOIN accounts a ON a.id = h.account_id AND a.vault_id = h.vault_id
             WHERE h.id = ?1 AND h.vault_id = ?2
               AND h.archived_at IS NULL AND a.archived_at IS NULL",
            params![holding_id, vault_id],
            |row| {
                Ok(HoldingProfile {
                    account_id: row.get(0)?,
                    account_name: row.get(1)?,
                    name: row.get(2)?,
                    product_type: row.get(3)?,
                    currency: row.get(4)?,
                    masked_identifier: row.get(5)?,
                    notes: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(|_| "Unable to read the encrypted holding profile.".to_owned())?
        .ok_or_else(|| "The holding does not exist or is archived.".to_owned())
}

fn create_holding_update_draft_at(
    runtime: &VaultRuntime,
    request: UpdateHoldingDraftRequest,
) -> Result<HoldingDraftResponse, String> {
    let holding_id = required_text(request.holding_id, "Holding identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let before = holding_profile(connection, vault_id, &holding_id)?;
        let after = HoldingProfile {
            account_id: before.account_id.clone(),
            account_name: before.account_name.clone(),
            name: required_text(request.name, "Holding name", 120)?,
            product_type: normalize_product_type(request.product_type)?,
            currency: before.currency.clone(),
            masked_identifier: normalize_masked_identifier(request.masked_identifier)?,
            notes: optional_text(request.notes, "Holding notes", 1000)?,
        };
        if before == after {
            return Err("No holding profile changes were provided.".to_owned());
        }
        if holding_name_exists(
            connection,
            vault_id,
            &after.account_id,
            &after.name,
            Some(&holding_id),
        )? {
            return Err("A holding with the same account and name already exists.".to_owned());
        }
        let (_, _, _, _, units_micros, cost_basis_minor, market_value_minor, as_of_date) =
            latest_holding_valuation(connection, vault_id, &holding_id)?;
        let draft_id = random_id("draft")?;
        let payload = HoldingUpdatePayload {
            kind: "holding.update".to_owned(),
            holding_id,
            before,
            after,
        };
        let proposed = serde_json::to_string(&payload)
            .map_err(|_| "Unable to serialize the holding update draft.".to_owned())?;
        insert_draft(connection, vault_id, &draft_id, &proposed, "update")?;
        let before_json = serde_json::to_value(&payload.before)
            .map_err(|_| "Unable to prepare the holding review response.".to_owned())?;
        Ok(HoldingDraftResponse {
            draft_id,
            action: "update",
            holding_id: payload.holding_id,
            account_id: Some(payload.after.account_id),
            account_name: payload.after.account_name,
            name: payload.after.name,
            product_type: Some(payload.after.product_type),
            currency: payload.after.currency,
            masked_identifier: payload.after.masked_identifier,
            units_micros,
            cost_basis_minor,
            market_value_minor,
            as_of_date,
            notes: payload.after.notes,
            before: Some(before_json),
            status: "needs_review",
            affects_account_balance: false,
        })
    })
}

fn create_holding_archive_draft_at(
    runtime: &VaultRuntime,
    request: ArchiveHoldingDraftRequest,
) -> Result<HoldingDraftResponse, String> {
    let holding_id = required_text(request.holding_id, "Holding identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let profile = holding_profile(connection, vault_id, &holding_id)?;
        let (
            _,
            _,
            _,
            latest_valuation_id,
            units_micros,
            cost_basis_minor,
            market_value_minor,
            as_of_date,
        ) = latest_holding_valuation(connection, vault_id, &holding_id)?;
        let draft_id = random_id("draft")?;
        let payload = HoldingArchivePayload {
            kind: "holding.archive".to_owned(),
            holding_id,
            profile,
            latest_valuation_id,
            units_micros,
            cost_basis_minor,
            market_value_minor,
            as_of_date,
        };
        let proposed = serde_json::to_string(&payload)
            .map_err(|_| "Unable to serialize the holding archive draft.".to_owned())?;
        insert_draft(connection, vault_id, &draft_id, &proposed, "archive")?;
        let before_json = serde_json::to_value(&payload.profile)
            .map_err(|_| "Unable to prepare the holding archive response.".to_owned())?;
        Ok(HoldingDraftResponse {
            draft_id,
            action: "archive",
            holding_id: payload.holding_id,
            account_id: Some(payload.profile.account_id),
            account_name: payload.profile.account_name,
            name: payload.profile.name,
            product_type: Some(payload.profile.product_type),
            currency: payload.profile.currency,
            masked_identifier: payload.profile.masked_identifier,
            units_micros: payload.units_micros,
            cost_basis_minor: payload.cost_basis_minor,
            market_value_minor: payload.market_value_minor,
            as_of_date: payload.as_of_date,
            notes: payload.profile.notes,
            before: Some(before_json),
            status: "needs_review",
            affects_account_balance: false,
        })
    })
}

fn append_audit(
    connection: &Connection,
    vault_id: &str,
    action: &str,
    holding_id: &str,
    metadata: serde_json::Value,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO audit_events(
               id, vault_id, category, action, actor_id,
               object_type, object_id, metadata_json, occurred_at
             ) VALUES (
               ?1, ?2, 'data', ?3, 'local_user',
               'holding', ?4, ?5,
               strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![
                random_id("audit")?,
                vault_id,
                action,
                holding_id,
                metadata.to_string()
            ],
        )
        .map_err(|_| "Unable to append the holding audit event.".to_owned())?;
    Ok(())
}

fn confirm_holding_create(
    connection: &Connection,
    vault_id: &str,
    draft_id: &str,
    payload: &HoldingCreatePayload,
) -> Result<(), String> {
    let (_, account_currency) = active_account(connection, vault_id, &payload.account_id)?;
    if account_currency != payload.currency {
        return Err("Holding currency must match its account currency.".to_owned());
    }
    if holding_name_exists(
        connection,
        vault_id,
        &payload.account_id,
        &payload.name,
        None,
    )? {
        return Err("A holding with the same account and name already exists.".to_owned());
    }
    connection
        .execute(
            "INSERT INTO holdings(
               id, vault_id, account_id, name, product_type, currency,
               masked_identifier, notes, created_at
             ) VALUES (
               ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
               strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![
                payload.holding_id,
                vault_id,
                payload.account_id,
                payload.name,
                payload.product_type,
                payload.currency,
                payload.masked_identifier,
                payload.notes
            ],
        )
        .map_err(|_| "Unable to create the encrypted holding.".to_owned())?;
    insert_valuation(
        connection,
        vault_id,
        draft_id,
        &payload.holding_id,
        &payload.valuation_id,
        payload.units_micros,
        payload.cost_basis_minor,
        payload.market_value_minor,
        &payload.as_of_date,
    )?;
    append_audit(
        connection,
        vault_id,
        "holding_created",
        &payload.holding_id,
        json!({
            "source": "manual_entry",
            "valuationId": payload.valuation_id,
            "asOfDate": payload.as_of_date,
            "affectsAccountBalance": false
        }),
    )
}

#[allow(clippy::too_many_arguments)]
fn insert_valuation(
    connection: &Connection,
    vault_id: &str,
    draft_id: &str,
    holding_id: &str,
    valuation_id: &str,
    units_micros: i64,
    cost_basis_minor: i64,
    market_value_minor: i64,
    as_of_date: &str,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO holding_valuations(
               id, vault_id, holding_id, draft_id, units_micros,
               cost_basis_minor, market_value_minor, as_of_date,
               source_type, created_at
             ) VALUES (
               ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'manual',
               strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![
                valuation_id,
                vault_id,
                holding_id,
                draft_id,
                units_micros,
                cost_basis_minor,
                market_value_minor,
                as_of_date
            ],
        )
        .map_err(|_| "Unable to append the immutable holding valuation.".to_owned())?;
    Ok(())
}

fn confirm_holding_valuation(
    connection: &Connection,
    vault_id: &str,
    draft_id: &str,
    payload: &HoldingValuationPayload,
) -> Result<(), String> {
    let (_, _, _, current_valuation_id, _, _, _, _) =
        latest_holding_valuation(connection, vault_id, &payload.holding_id)?;
    if current_valuation_id != payload.previous_valuation_id {
        return Err(
            "The holding changed after review. Create a new valuation draft before confirming."
                .to_owned(),
        );
    }
    insert_valuation(
        connection,
        vault_id,
        draft_id,
        &payload.holding_id,
        &payload.valuation_id,
        payload.units_micros,
        payload.cost_basis_minor,
        payload.market_value_minor,
        &payload.as_of_date,
    )?;
    append_audit(
        connection,
        vault_id,
        "holding_valuation_appended",
        &payload.holding_id,
        json!({
            "previousValuationId": payload.previous_valuation_id,
            "valuationId": payload.valuation_id,
            "asOfDate": payload.as_of_date,
            "affectsAccountBalance": false
        }),
    )
}

fn confirm_holding_update(
    connection: &Connection,
    vault_id: &str,
    payload: &HoldingUpdatePayload,
) -> Result<(), String> {
    let current = holding_profile(connection, vault_id, &payload.holding_id)?;
    if current != payload.before {
        return Err(
            "The holding changed after review. Create a new review draft before confirming."
                .to_owned(),
        );
    }
    if holding_name_exists(
        connection,
        vault_id,
        &payload.after.account_id,
        &payload.after.name,
        Some(&payload.holding_id),
    )? {
        return Err("A holding with the same account and name already exists.".to_owned());
    }
    let updated = connection
        .execute(
            "UPDATE holdings
             SET name = ?1, product_type = ?2, masked_identifier = ?3, notes = ?4
             WHERE id = ?5 AND vault_id = ?6 AND archived_at IS NULL",
            params![
                payload.after.name,
                payload.after.product_type,
                payload.after.masked_identifier,
                payload.after.notes,
                payload.holding_id,
                vault_id
            ],
        )
        .map_err(|_| "Unable to update the encrypted holding.".to_owned())?;
    if updated != 1 {
        return Err("The holding is no longer available for updating.".to_owned());
    }
    append_audit(
        connection,
        vault_id,
        "holding_updated",
        &payload.holding_id,
        json!({
            "before": payload.before,
            "after": payload.after,
            "affectsAccountBalance": false
        }),
    )
}

fn confirm_holding_archive(
    connection: &Connection,
    vault_id: &str,
    payload: &HoldingArchivePayload,
) -> Result<(), String> {
    let current = holding_profile(connection, vault_id, &payload.holding_id)?;
    if current != payload.profile {
        return Err(
            "The holding changed after review. Create a new archive draft before confirming."
                .to_owned(),
        );
    }
    let (_, _, _, current_valuation_id, _, _, _, _) =
        latest_holding_valuation(connection, vault_id, &payload.holding_id)?;
    if current_valuation_id != payload.latest_valuation_id {
        return Err(
            "The holding changed after review. Create a new archive draft before confirming."
                .to_owned(),
        );
    }
    let updated = connection
        .execute(
            "UPDATE holdings
             SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1 AND vault_id = ?2 AND archived_at IS NULL",
            params![payload.holding_id, vault_id],
        )
        .map_err(|_| "Unable to archive the encrypted holding.".to_owned())?;
    if updated != 1 {
        return Err("The holding is no longer available for archiving.".to_owned());
    }
    append_audit(
        connection,
        vault_id,
        "holding_archived",
        &payload.holding_id,
        json!({
            "profile": payload.profile,
            "latestValuationId": payload.latest_valuation_id,
            "unitsMicros": payload.units_micros,
            "costBasisMinor": payload.cost_basis_minor,
            "marketValueMinor": payload.market_value_minor,
            "asOfDate": payload.as_of_date,
            "affectsAccountBalance": false
        }),
    )
}

pub(crate) fn confirm_holding_draft_at(
    runtime: &VaultRuntime,
    request: ConfirmHoldingDraftRequest,
) -> Result<HoldingConfirmationResponse, String> {
    if !request.confirmed_by_user {
        return Err("Explicit user confirmation is required.".to_owned());
    }
    let draft_id = required_text(request.draft_id, "Draft identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let row: Option<(String, String)> = connection
            .query_row(
                "SELECT status, proposed_events_json FROM draft_changes
                 WHERE id = ?1 AND vault_id = ?2 AND source_type = 'manual_holding'",
                params![draft_id, vault_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| "Unable to read the holding review draft.".to_owned())?;
        let (status, proposed) =
            row.ok_or_else(|| "The holding draft does not exist.".to_owned())?;
        let header: HoldingDraftHeader = serde_json::from_str(&proposed)
            .map_err(|_| "The holding draft is invalid.".to_owned())?;
        if status == "confirmed" {
            return Ok(HoldingConfirmationResponse {
                draft_id,
                holding_id: header.holding_id,
                status: "confirmed",
            });
        }
        if status != "needs_review" {
            return Err("The holding draft is no longer available for confirmation.".to_owned());
        }

        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "Unable to start the holding confirmation transaction.".to_owned())?;
        match header.kind.as_str() {
            "holding.create" => {
                let payload: HoldingCreatePayload = serde_json::from_str(&proposed)
                    .map_err(|_| "The holding creation draft is invalid.".to_owned())?;
                confirm_holding_create(&transaction, vault_id, &draft_id, &payload)?;
            }
            "holding.valuation" => {
                let payload: HoldingValuationPayload = serde_json::from_str(&proposed)
                    .map_err(|_| "The holding valuation draft is invalid.".to_owned())?;
                confirm_holding_valuation(&transaction, vault_id, &draft_id, &payload)?;
            }
            "holding.update" => {
                let payload: HoldingUpdatePayload = serde_json::from_str(&proposed)
                    .map_err(|_| "The holding update draft is invalid.".to_owned())?;
                confirm_holding_update(&transaction, vault_id, &payload)?;
            }
            "holding.archive" => {
                let payload: HoldingArchivePayload = serde_json::from_str(&proposed)
                    .map_err(|_| "The holding archive draft is invalid.".to_owned())?;
                confirm_holding_archive(&transaction, vault_id, &payload)?;
            }
            _ => return Err("The holding draft type is invalid.".to_owned()),
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
            .map_err(|_| "Unable to confirm the holding draft.".to_owned())?;
        if updated != 1 {
            return Err("The holding draft changed before confirmation.".to_owned());
        }
        transaction
            .commit()
            .map_err(|_| "Unable to commit the holding confirmation.".to_owned())?;
        Ok(HoldingConfirmationResponse {
            draft_id,
            holding_id: header.holding_id,
            status: "confirmed",
        })
    })
}

fn reject_holding_draft_at(
    runtime: &VaultRuntime,
    request: RejectHoldingDraftRequest,
) -> Result<HoldingRejectionResponse, String> {
    let draft_id = required_text(request.draft_id, "Draft identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let status: Option<String> = connection
            .query_row(
                "SELECT status FROM draft_changes
                 WHERE id = ?1 AND vault_id = ?2 AND source_type = 'manual_holding'",
                params![draft_id, vault_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| "Unable to read the holding draft.".to_owned())?;
        match status.as_deref() {
            None => return Err("The holding draft does not exist.".to_owned()),
            Some("confirmed") => {
                return Err("A confirmed holding draft cannot be rejected.".to_owned())
            }
            Some("rejected") => {
                return Ok(HoldingRejectionResponse {
                    draft_id,
                    status: "rejected",
                })
            }
            Some("needs_review") => {}
            _ => return Err("The holding draft state is invalid.".to_owned()),
        }
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "Unable to start the holding draft rejection.".to_owned())?;
        transaction
            .execute(
                "UPDATE draft_changes
                 SET status = 'rejected',
                     rejected_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                     rejection_reason = 'user_cancelled'
                 WHERE id = ?1 AND vault_id = ?2 AND status = 'needs_review'",
                params![draft_id, vault_id],
            )
            .map_err(|_| "Unable to reject the holding draft.".to_owned())?;
        transaction
            .execute(
                "INSERT INTO audit_events(
                   id, vault_id, category, action, actor_id,
                   object_type, object_id, metadata_json, occurred_at
                 ) VALUES (
                   ?1, ?2, 'data', 'holding_draft_rejected', 'local_user',
                   'draft_change', ?3, '{}',
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![random_id("audit")?, vault_id, draft_id],
            )
            .map_err(|_| "Unable to append the holding draft rejection audit.".to_owned())?;
        transaction
            .commit()
            .map_err(|_| "Unable to commit the holding draft rejection.".to_owned())?;
        Ok(HoldingRejectionResponse {
            draft_id,
            status: "rejected",
        })
    })
}

pub(crate) fn holding_snapshot(
    connection: &Connection,
    vault_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let mut statement = connection
        .prepare(
            "SELECT
               h.id, h.account_id, a.display_name, h.name, h.product_type,
               h.currency, h.masked_identifier, h.notes, h.created_at,
               h.archived_at, v.id, v.units_micros, v.cost_basis_minor,
               v.market_value_minor, v.as_of_date,
               (SELECT count(*) FROM holding_valuations count_v
                WHERE count_v.vault_id = h.vault_id AND count_v.holding_id = h.id)
             FROM holdings h
             JOIN accounts a ON a.id = h.account_id AND a.vault_id = h.vault_id
             JOIN holding_valuations v ON v.id = (
               SELECT latest.id FROM holding_valuations latest
               WHERE latest.vault_id = h.vault_id AND latest.holding_id = h.id
               ORDER BY latest.as_of_date DESC, latest.created_at DESC, latest.id DESC
               LIMIT 1
             )
             WHERE h.vault_id = ?1
             ORDER BY h.archived_at IS NOT NULL, v.market_value_minor DESC, h.name, h.id",
        )
        .map_err(|_| "Unable to prepare the encrypted holdings snapshot.".to_owned())?;
    let rows = statement
        .query_map([vault_id], |row| {
            let cost_basis_minor: i64 = row.get(12)?;
            let market_value_minor: i64 = row.get(13)?;
            let gain_minor = market_value_minor.saturating_sub(cost_basis_minor);
            let return_bps = if cost_basis_minor > 0 {
                let value = i128::from(gain_minor) * 10_000 / i128::from(cost_basis_minor);
                i64::try_from(value).ok()
            } else {
                None
            };
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "accountId": row.get::<_, String>(1)?,
                "accountName": row.get::<_, String>(2)?,
                "name": row.get::<_, String>(3)?,
                "productType": row.get::<_, String>(4)?,
                "currency": row.get::<_, String>(5)?,
                "maskedIdentifier": row.get::<_, Option<String>>(6)?,
                "notes": row.get::<_, Option<String>>(7)?,
                "createdAt": row.get::<_, String>(8)?,
                "archivedAt": row.get::<_, Option<String>>(9)?,
                "valuationId": row.get::<_, String>(10)?,
                "unitsMicros": row.get::<_, i64>(11)?,
                "costBasisMinor": cost_basis_minor,
                "marketValueMinor": market_value_minor,
                "gainMinor": gain_minor,
                "returnBps": return_bps,
                "asOfDate": row.get::<_, String>(14)?,
                "valuationCount": row.get::<_, i64>(15)?,
                "includedInAccountBalance": true,
                "affectsAccountBalance": false
            }))
        })
        .map_err(|_| "Unable to read encrypted holdings.".to_owned())?;
    let mut holdings = Vec::new();
    for row in rows {
        holdings
            .push(row.map_err(|_| "Unable to decode the encrypted holdings snapshot.".to_owned())?);
    }
    Ok(holdings)
}

#[tauri::command]
pub fn holding_create_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: CreateHoldingDraftRequest,
) -> Result<HoldingDraftResponse, String> {
    create_holding_draft_at(&runtime, request)
}

#[tauri::command]
pub fn holding_valuation_create_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: CreateHoldingValuationDraftRequest,
) -> Result<HoldingDraftResponse, String> {
    create_holding_valuation_draft_at(&runtime, request)
}

#[tauri::command]
pub fn holding_update_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: UpdateHoldingDraftRequest,
) -> Result<HoldingDraftResponse, String> {
    create_holding_update_draft_at(&runtime, request)
}

#[tauri::command]
pub fn holding_archive_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: ArchiveHoldingDraftRequest,
) -> Result<HoldingDraftResponse, String> {
    create_holding_archive_draft_at(&runtime, request)
}

#[tauri::command]
pub fn holding_confirm_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: ConfirmHoldingDraftRequest,
) -> Result<HoldingConfirmationResponse, String> {
    confirm_holding_draft_at(&runtime, request)
}

#[tauri::command]
pub fn holding_reject_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: RejectHoldingDraftRequest,
) -> Result<HoldingRejectionResponse, String> {
    reject_holding_draft_at(&runtime, request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::open_encrypted;

    fn runtime_with_account() -> (tempfile::TempDir, VaultRuntime) {
        let directory = tempfile::tempdir().expect("temporary directory should exist");
        let connection = open_encrypted(&directory.path().join("holdings.sqlite3"), &[31_u8; 32])
            .expect("encrypted database should open");
        connection
            .execute_batch(
                "
                INSERT INTO vaults(id, display_name, base_currency, created_at)
                VALUES ('vault-1', 'Holding test vault', 'CNY', '2026-07-27T00:00:00.000Z');
                INSERT INTO accounts(
                  id, vault_id, institution_name, display_name, account_type,
                  currency, created_at
                ) VALUES (
                  'account-1', 'vault-1', '测试机构', '投资账户', 'fund',
                  'CNY', '2026-07-27T00:00:00.000Z'
                );
                INSERT INTO ledger_events(
                  id, vault_id, account_id, event_type, delta_minor, currency,
                  occurred_at, status, idempotency_key, created_at
                ) VALUES (
                  'event-opening', 'vault-1', 'account-1', 'opening_balance',
                  10000000, 'CNY', '2026-07-27T00:00:00.000Z',
                  'confirmed', 'holding-test-opening', '2026-07-27T00:00:00.000Z'
                );
                ",
            )
            .expect("holding fixtures should insert");
        let runtime = VaultRuntime::default();
        runtime.install_test_session("vault-1", connection);
        (directory, runtime)
    }

    fn create_request() -> CreateHoldingDraftRequest {
        CreateHoldingDraftRequest {
            account_id: "account-1".to_owned(),
            name: "测试红利基金".to_owned(),
            product_type: "fund".to_owned(),
            currency: "CNY".to_owned(),
            masked_identifier: Some("FUND-1028".to_owned()),
            units: "1234.567890".to_owned(),
            cost_basis: "50000.00".to_owned(),
            market_value: "51880.32".to_owned(),
            as_of_date: "2026-07-27".to_owned(),
            notes: Some("虚构测试持仓".to_owned()),
        }
    }

    fn confirm(runtime: &VaultRuntime, draft_id: String) -> HoldingConfirmationResponse {
        confirm_holding_draft_at(
            runtime,
            ConfirmHoldingDraftRequest {
                draft_id,
                confirmed_by_user: true,
            },
        )
        .expect("holding draft should confirm")
    }

    #[test]
    fn holding_numbers_are_exact_and_reject_unsafe_precision() {
        assert_eq!(parse_units("1234.567890").unwrap(), 1_234_567_890);
        assert_eq!(parse_money("51880.32", "Market value").unwrap(), 5_188_032);
        assert!(parse_units("1.0000001").is_err());
        assert!(parse_money("0.001", "Market value").is_err());
        assert!(parse_units("-1").is_err());
    }

    #[test]
    fn holding_requires_review_and_never_changes_account_balance() {
        let (_directory, runtime) = runtime_with_account();
        let draft = create_holding_draft_at(&runtime, create_request())
            .expect("holding draft should create");
        assert!(!draft.affects_account_balance);
        runtime
            .with_unlocked_connection(|vault_id, connection| {
                let count: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM holdings WHERE vault_id = ?1",
                        [vault_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(count, 0);
                Ok(())
            })
            .unwrap();
        confirm(&runtime, draft.draft_id);
        runtime
            .with_unlocked_connection(|vault_id, connection| {
                let balance: i64 = connection
                    .query_row(
                        "SELECT balance_minor FROM account_balances
                         WHERE vault_id = ?1 AND account_id = 'account-1'",
                        [vault_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(balance, 10_000_000);
                let snapshot = holding_snapshot(connection, vault_id)?;
                assert_eq!(snapshot.len(), 1);
                assert_eq!(snapshot[0]["marketValueMinor"], 5_188_032);
                assert_eq!(snapshot[0]["gainMinor"], 188_032);
                assert_eq!(snapshot[0]["valuationCount"], 1);
                assert_eq!(snapshot[0]["includedInAccountBalance"], true);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn valuation_snapshots_are_immutable_and_concurrent_reviews_fail_closed() {
        let (_directory, runtime) = runtime_with_account();
        let created = create_holding_draft_at(&runtime, create_request())
            .expect("holding draft should create");
        let holding_id = confirm(&runtime, created.draft_id).holding_id;
        let first = create_holding_valuation_draft_at(
            &runtime,
            CreateHoldingValuationDraftRequest {
                holding_id: holding_id.clone(),
                units: "1234.567890".to_owned(),
                cost_basis: "50000.00".to_owned(),
                market_value: "52100.00".to_owned(),
                as_of_date: "2026-07-28".to_owned(),
            },
        )
        .unwrap();
        let stale = create_holding_valuation_draft_at(
            &runtime,
            CreateHoldingValuationDraftRequest {
                holding_id,
                units: "1234.567890".to_owned(),
                cost_basis: "50000.00".to_owned(),
                market_value: "52200.00".to_owned(),
                as_of_date: "2026-07-28".to_owned(),
            },
        )
        .unwrap();
        confirm(&runtime, first.draft_id);
        assert!(confirm_holding_draft_at(
            &runtime,
            ConfirmHoldingDraftRequest {
                draft_id: stale.draft_id,
                confirmed_by_user: true,
            }
        )
        .is_err());
        runtime
            .with_unlocked_connection(|vault_id, connection| {
                let immutable = connection.execute(
                    "UPDATE holding_valuations SET market_value_minor = 1
                     WHERE vault_id = ?1",
                    [vault_id],
                );
                assert!(immutable.is_err());
                let count: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM holding_valuations WHERE vault_id = ?1",
                        [vault_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(count, 2);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn holding_profile_and_archive_preserve_history_and_fail_closed() {
        let (_directory, runtime) = runtime_with_account();
        let created = create_holding_draft_at(&runtime, create_request()).unwrap();
        let holding_id = confirm(&runtime, created.draft_id).holding_id;
        let update = create_holding_update_draft_at(
            &runtime,
            UpdateHoldingDraftRequest {
                holding_id: holding_id.clone(),
                name: "更新后的红利基金".to_owned(),
                product_type: "fixed_income".to_owned(),
                masked_identifier: Some("NEW-1028".to_owned()),
                notes: Some("更新后的虚构备注".to_owned()),
            },
        )
        .unwrap();
        let stale_update = create_holding_update_draft_at(
            &runtime,
            UpdateHoldingDraftRequest {
                holding_id: holding_id.clone(),
                name: "并发旧名称".to_owned(),
                product_type: "fund".to_owned(),
                masked_identifier: None,
                notes: None,
            },
        )
        .unwrap();
        assert_eq!(update.before.as_ref().unwrap()["name"], "测试红利基金");
        confirm(&runtime, update.draft_id);
        assert!(confirm_holding_draft_at(
            &runtime,
            ConfirmHoldingDraftRequest {
                draft_id: stale_update.draft_id,
                confirmed_by_user: true,
            }
        )
        .is_err());

        let stale_archive = create_holding_archive_draft_at(
            &runtime,
            ArchiveHoldingDraftRequest {
                holding_id: holding_id.clone(),
            },
        )
        .unwrap();
        let valuation = create_holding_valuation_draft_at(
            &runtime,
            CreateHoldingValuationDraftRequest {
                holding_id: holding_id.clone(),
                units: "1234.567890".to_owned(),
                cost_basis: "50000.00".to_owned(),
                market_value: "52500.00".to_owned(),
                as_of_date: "2026-07-28".to_owned(),
            },
        )
        .unwrap();
        confirm(&runtime, valuation.draft_id);
        assert!(confirm_holding_draft_at(
            &runtime,
            ConfirmHoldingDraftRequest {
                draft_id: stale_archive.draft_id,
                confirmed_by_user: true,
            }
        )
        .is_err());

        let archive = create_holding_archive_draft_at(
            &runtime,
            ArchiveHoldingDraftRequest {
                holding_id: holding_id.clone(),
            },
        )
        .unwrap();
        confirm(&runtime, archive.draft_id);
        runtime
            .with_unlocked_connection(|vault_id, connection| {
                let snapshot = holding_snapshot(connection, vault_id)?;
                assert_eq!(snapshot.len(), 1);
                assert!(snapshot[0]["archivedAt"].is_string());
                assert_eq!(snapshot[0]["name"], "更新后的红利基金");
                assert_eq!(snapshot[0]["productType"], "fixed_income");
                assert_eq!(snapshot[0]["valuationCount"], 2);
                assert_eq!(snapshot[0]["marketValueMinor"], 5_250_000);
                let balance: i64 = connection
                    .query_row(
                        "SELECT balance_minor FROM account_balances
                         WHERE vault_id = ?1 AND account_id = 'account-1'",
                        [vault_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(balance, 10_000_000);
                let update_audit: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM audit_events
                         WHERE vault_id = ?1 AND object_id = ?2
                           AND action = 'holding_updated'",
                        params![vault_id, holding_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                let archive_audit: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM audit_events
                         WHERE vault_id = ?1 AND object_id = ?2
                           AND action = 'holding_archived'",
                        params![vault_id, holding_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(update_audit, 1);
                assert_eq!(archive_audit, 1);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn rejected_holding_draft_is_inert() {
        let (_directory, runtime) = runtime_with_account();
        let draft = create_holding_draft_at(&runtime, create_request()).unwrap();
        reject_holding_draft_at(
            &runtime,
            RejectHoldingDraftRequest {
                draft_id: draft.draft_id,
            },
        )
        .unwrap();
        runtime
            .with_unlocked_connection(|vault_id, connection| {
                let count: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM holdings WHERE vault_id = ?1",
                        [vault_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(count, 0);
                Ok(())
            })
            .unwrap();
    }
}
