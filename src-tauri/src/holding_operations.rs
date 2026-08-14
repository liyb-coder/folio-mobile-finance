use crate::vault::VaultRuntime;
use getrandom::fill;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::json;

const MAX_SAFE_MINOR: i128 = 9_000_000_000_000_000;
const MAX_SAFE_UNITS_MICROS: i128 = 9_000_000_000_000_000;
const OPERATION_KINDS: [&str; 4] = ["purchase", "redeem", "dividend", "fee"];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateHoldingOperationDraftRequest {
    holding_id: String,
    operation_kind: String,
    settlement_account_id: Option<String>,
    amount: String,
    occurred_on: String,
    description: String,
    notes: Option<String>,
    resulting_units: Option<String>,
    resulting_cost_basis: Option<String>,
    resulting_market_value: Option<String>,
    valuation_date: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmHoldingOperationDraftRequest {
    draft_id: String,
    confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectHoldingOperationDraftRequest {
    draft_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateHoldingOperationCorrectionDraftRequest {
    operation_id: String,
    reason: String,
    occurred_on: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmHoldingOperationCorrectionDraftRequest {
    draft_id: String,
    confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectHoldingOperationCorrectionDraftRequest {
    draft_id: String,
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct HoldingOperationContext {
    holding_id: String,
    holding_name: String,
    product_type: String,
    holding_account_id: String,
    holding_account_name: String,
    currency: String,
    valuation_id: String,
    units_micros: i64,
    cost_basis_minor: i64,
    market_value_minor: i64,
    valuation_date: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PositionAfter {
    valuation_id: String,
    units_micros: i64,
    cost_basis_minor: i64,
    market_value_minor: i64,
    valuation_date: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HoldingOperationPayload {
    kind: String,
    operation_id: String,
    operation_kind: String,
    context: HoldingOperationContext,
    settlement_account_id: Option<String>,
    settlement_account_name: Option<String>,
    amount_minor: i64,
    occurred_on: String,
    description: String,
    notes: Option<String>,
    position_after: Option<PositionAfter>,
    units_delta_micros: i64,
    primary_event_id: Option<String>,
    secondary_event_id: Option<String>,
    ledger_link_id: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReversalEventPlan {
    original_event_id: String,
    reversal_event_id: String,
    account_id: String,
    delta_minor: i64,
    currency: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HoldingOperationCorrectionPayload {
    kind: String,
    correction_id: String,
    compensating_operation_id: String,
    original_operation_id: String,
    original_operation_kind: String,
    compensating_operation_kind: String,
    holding_id: String,
    holding_name: String,
    holding_account_id: String,
    holding_account_name: String,
    currency: String,
    amount_minor: i64,
    original_units_delta_micros: i64,
    current_valuation_id: String,
    restored_position: Option<PositionAfter>,
    settlement_account_id: Option<String>,
    settlement_account_name: Option<String>,
    reversal_events: Vec<ReversalEventPlan>,
    ledger_link_id: Option<String>,
    occurred_on: String,
    original_description: String,
    reason: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HoldingOperationDraftHeader {
    kind: String,
    operation_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HoldingOperationDraftResponse {
    draft_id: String,
    action: &'static str,
    operation_id: String,
    operation_kind: String,
    holding_id: String,
    holding_name: String,
    holding_account_id: String,
    holding_account_name: String,
    settlement_account_id: Option<String>,
    settlement_account_name: Option<String>,
    amount_minor: i64,
    currency: String,
    occurred_on: String,
    description: String,
    notes: Option<String>,
    before_units_micros: i64,
    before_cost_basis_minor: i64,
    before_market_value_minor: i64,
    after_units_micros: Option<i64>,
    after_cost_basis_minor: Option<i64>,
    after_market_value_minor: Option<i64>,
    valuation_date: Option<String>,
    units_delta_micros: i64,
    balance_effect: &'static str,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HoldingOperationConfirmationResponse {
    draft_id: String,
    operation_id: String,
    holding_id: String,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HoldingOperationRejectionResponse {
    draft_id: String,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HoldingOperationCorrectionDraftResponse {
    draft_id: String,
    action: &'static str,
    correction_id: String,
    original_operation_id: String,
    original_operation_kind: String,
    compensating_operation_id: String,
    compensating_operation_kind: String,
    holding_id: String,
    holding_name: String,
    holding_account_name: String,
    settlement_account_name: Option<String>,
    amount_minor: i64,
    currency: String,
    occurred_on: String,
    reason: String,
    restored_units_micros: Option<i64>,
    restored_cost_basis_minor: Option<i64>,
    restored_market_value_minor: Option<i64>,
    ledger_event_count: usize,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HoldingOperationCorrectionConfirmationResponse {
    draft_id: String,
    correction_id: String,
    original_operation_id: String,
    compensating_operation_id: String,
    holding_id: String,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HoldingOperationCorrectionRejectionResponse {
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
    let fraction_value = if fraction.is_empty() {
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

fn parse_positive_money(value: &str) -> Result<i64, String> {
    let amount = parse_fixed(value, 2, "Holding operation amount", MAX_SAFE_MINOR)?;
    if amount <= 0 {
        return Err("Holding operation amount must be greater than zero.".to_owned());
    }
    Ok(amount)
}

fn parse_money(value: &str, field: &str) -> Result<i64, String> {
    parse_fixed(value, 2, field, MAX_SAFE_MINOR)
}

fn parse_units(value: &str) -> Result<i64, String> {
    parse_fixed(value, 6, "Resulting holding units", MAX_SAFE_UNITS_MICROS)
}

fn validate_date(connection: &Connection, value: String, field: &str) -> Result<String, String> {
    let value = value.trim().to_owned();
    let valid: bool = connection
        .query_row("SELECT COALESCE(date(?1) = ?1, 0)", [&value], |row| {
            row.get(0)
        })
        .map_err(|_| format!("Unable to validate {field}."))?;
    if !valid {
        return Err(format!("{field} is invalid."));
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
        .map_err(|_| "Unable to read the holding operation account.".to_owned())?
        .ok_or_else(|| "The holding operation account does not exist or is archived.".to_owned())
}

fn holding_operation_context(
    connection: &Connection,
    vault_id: &str,
    holding_id: &str,
) -> Result<HoldingOperationContext, String> {
    connection
        .query_row(
            "SELECT
               h.id, h.name, h.product_type, h.account_id, a.display_name,
               h.currency, v.id, v.units_micros, v.cost_basis_minor,
               v.market_value_minor, v.as_of_date
             FROM holdings h
             JOIN accounts a ON a.id = h.account_id AND a.vault_id = h.vault_id
             JOIN holding_valuations v ON v.id = (
               SELECT latest.id FROM holding_valuations latest
               WHERE latest.vault_id = h.vault_id AND latest.holding_id = h.id
               ORDER BY latest.as_of_date DESC, latest.created_at DESC, latest.id DESC
               LIMIT 1
             )
             WHERE h.id = ?1 AND h.vault_id = ?2
               AND h.archived_at IS NULL AND a.archived_at IS NULL",
            params![holding_id, vault_id],
            |row| {
                Ok(HoldingOperationContext {
                    holding_id: row.get(0)?,
                    holding_name: row.get(1)?,
                    product_type: row.get(2)?,
                    holding_account_id: row.get(3)?,
                    holding_account_name: row.get(4)?,
                    currency: row.get(5)?,
                    valuation_id: row.get(6)?,
                    units_micros: row.get(7)?,
                    cost_basis_minor: row.get(8)?,
                    market_value_minor: row.get(9)?,
                    valuation_date: row.get(10)?,
                })
            },
        )
        .optional()
        .map_err(|_| "Unable to read the encrypted holding operation context.".to_owned())?
        .ok_or_else(|| "The holding does not exist or is archived.".to_owned())
}

fn operation_balance_effect(payload: &HoldingOperationPayload) -> &'static str {
    match payload.operation_kind.as_str() {
        "purchase" | "redeem" if payload.primary_event_id.is_some() => "transfer",
        "purchase" | "redeem" => "none",
        "dividend" => "income",
        "fee" => "expense",
        _ => "none",
    }
}

fn build_operation_payload(
    connection: &Connection,
    vault_id: &str,
    request: CreateHoldingOperationDraftRequest,
) -> Result<HoldingOperationPayload, String> {
    let holding_id = required_text(request.holding_id, "Holding identifier", 96)?;
    let context = holding_operation_context(connection, vault_id, &holding_id)?;
    let operation_kind = request.operation_kind.trim().to_ascii_lowercase();
    if !OPERATION_KINDS.contains(&operation_kind.as_str()) {
        return Err("Holding operation type is not supported.".to_owned());
    }
    let amount_minor = parse_positive_money(&request.amount)?;
    let occurred_on = validate_date(connection, request.occurred_on, "Holding operation date")?;
    let description = required_text(request.description, "Holding operation description", 120)?;
    let notes = optional_text(request.notes, "Holding operation notes", 1000)?;

    let requested_settlement = request
        .settlement_account_id
        .map(|value| required_text(value, "Settlement account identifier", 96))
        .transpose()?;
    let (settlement_account_id, settlement_account_name) =
        if matches!(operation_kind.as_str(), "dividend" | "fee") {
            let settlement_id =
                requested_settlement.unwrap_or_else(|| context.holding_account_id.clone());
            let (name, currency) = active_account(connection, vault_id, &settlement_id)?;
            if currency != context.currency {
                return Err(
                    "Holding operation settlement currency must match the holding currency."
                        .to_owned(),
                );
            }
            (Some(settlement_id), Some(name))
        } else if let Some(settlement_id) = requested_settlement {
            if settlement_id == context.holding_account_id {
                (None, None)
            } else {
                let (name, currency) = active_account(connection, vault_id, &settlement_id)?;
                if currency != context.currency {
                    return Err(
                        "Holding operation settlement currency must match the holding currency."
                            .to_owned(),
                    );
                }
                (Some(settlement_id), Some(name))
            }
        } else {
            (None, None)
        };

    let mut position_after = None;
    let mut units_delta_micros = 0_i64;
    if matches!(operation_kind.as_str(), "purchase" | "redeem") {
        let units_micros = parse_units(
            request
                .resulting_units
                .as_deref()
                .ok_or_else(|| "Resulting holding units are required.".to_owned())?,
        )?;
        let cost_basis_minor = parse_money(
            request
                .resulting_cost_basis
                .as_deref()
                .ok_or_else(|| "Resulting holding cost basis is required.".to_owned())?,
            "Resulting holding cost basis",
        )?;
        let market_value_minor = parse_money(
            request
                .resulting_market_value
                .as_deref()
                .ok_or_else(|| "Resulting holding market value is required.".to_owned())?,
            "Resulting holding market value",
        )?;
        let valuation_date = validate_date(
            connection,
            request
                .valuation_date
                .ok_or_else(|| "Resulting holding valuation date is required.".to_owned())?,
            "Resulting holding valuation date",
        )?;
        if valuation_date < context.valuation_date {
            return Err(
                "Resulting holding valuation date cannot be older than the current snapshot."
                    .to_owned(),
            );
        }
        units_delta_micros = units_micros
            .checked_sub(context.units_micros)
            .ok_or_else(|| "Holding unit change is outside the supported range.".to_owned())?;
        if operation_kind == "purchase"
            && (units_delta_micros <= 0 || cost_basis_minor < context.cost_basis_minor)
        {
            return Err(
                "A purchase must increase holding units without reducing cost basis.".to_owned(),
            );
        }
        if operation_kind == "redeem"
            && (units_delta_micros >= 0 || cost_basis_minor > context.cost_basis_minor)
        {
            return Err(
                "A redemption must reduce holding units without increasing cost basis.".to_owned(),
            );
        }
        if operation_kind == "redeem" && units_micros == 0 && cost_basis_minor != 0 {
            return Err("A fully redeemed holding must have zero remaining cost basis.".to_owned());
        }
        position_after = Some(PositionAfter {
            valuation_id: random_id("valuation")?,
            units_micros,
            cost_basis_minor,
            market_value_minor,
            valuation_date,
        });
    } else if request.resulting_units.is_some()
        || request.resulting_cost_basis.is_some()
        || request.resulting_market_value.is_some()
        || request.valuation_date.is_some()
    {
        return Err("Dividend and fee operations cannot change the holding valuation.".to_owned());
    }

    let needs_transfer =
        matches!(operation_kind.as_str(), "purchase" | "redeem") && settlement_account_id.is_some();
    let needs_single_event = matches!(operation_kind.as_str(), "dividend" | "fee");
    Ok(HoldingOperationPayload {
        kind: "holding_operation.create".to_owned(),
        operation_id: random_id("holding_op")?,
        operation_kind,
        context,
        settlement_account_id,
        settlement_account_name,
        amount_minor,
        occurred_on,
        description,
        notes,
        position_after,
        units_delta_micros,
        primary_event_id: if needs_transfer || needs_single_event {
            Some(random_id("event")?)
        } else {
            None
        },
        secondary_event_id: if needs_transfer {
            Some(random_id("event")?)
        } else {
            None
        },
        ledger_link_id: if needs_transfer {
            Some(random_id("holding_transfer")?)
        } else {
            None
        },
    })
}

fn draft_response(
    draft_id: String,
    payload: HoldingOperationPayload,
) -> HoldingOperationDraftResponse {
    let balance_effect = operation_balance_effect(&payload);
    HoldingOperationDraftResponse {
        draft_id,
        action: "create",
        operation_id: payload.operation_id,
        operation_kind: payload.operation_kind,
        holding_id: payload.context.holding_id,
        holding_name: payload.context.holding_name,
        holding_account_id: payload.context.holding_account_id,
        holding_account_name: payload.context.holding_account_name,
        settlement_account_id: payload.settlement_account_id,
        settlement_account_name: payload.settlement_account_name,
        amount_minor: payload.amount_minor,
        currency: payload.context.currency,
        occurred_on: payload.occurred_on,
        description: payload.description,
        notes: payload.notes,
        before_units_micros: payload.context.units_micros,
        before_cost_basis_minor: payload.context.cost_basis_minor,
        before_market_value_minor: payload.context.market_value_minor,
        after_units_micros: payload
            .position_after
            .as_ref()
            .map(|position| position.units_micros),
        after_cost_basis_minor: payload
            .position_after
            .as_ref()
            .map(|position| position.cost_basis_minor),
        after_market_value_minor: payload
            .position_after
            .as_ref()
            .map(|position| position.market_value_minor),
        valuation_date: payload
            .position_after
            .as_ref()
            .map(|position| position.valuation_date.clone()),
        units_delta_micros: payload.units_delta_micros,
        balance_effect,
        status: "needs_review",
    }
}

fn create_operation_draft_at(
    runtime: &VaultRuntime,
    request: CreateHoldingOperationDraftRequest,
) -> Result<HoldingOperationDraftResponse, String> {
    runtime.with_unlocked_connection(|vault_id, connection| {
        let payload = build_operation_payload(connection, vault_id, request)?;
        let draft_id = random_id("draft")?;
        let proposed = serde_json::to_string(&payload)
            .map_err(|_| "Unable to serialize the holding operation draft.".to_owned())?;
        let evidence = json!([{
            "source": "manual_holding_operation",
            "operationKind": payload.operation_kind,
            "reviewRequired": true,
            "balanceEffect": operation_balance_effect(&payload)
        }])
        .to_string();
        connection
            .execute(
                "INSERT INTO draft_changes(
                   id, vault_id, source_type, source_fingerprint, status,
                   proposed_events_json, evidence_json, created_at
                 ) VALUES (
                   ?1, ?2, 'manual_holding_operation', ?1, 'needs_review',
                   ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![draft_id, vault_id, proposed, evidence],
            )
            .map_err(|_| "Unable to save the holding operation review draft.".to_owned())?;
        Ok(draft_response(draft_id, payload))
    })
}

#[allow(clippy::too_many_arguments)]
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
                format!("holding-operation:{draft_id}:{idempotency_suffix}"),
                link_id,
                metadata
            ],
        )
        .map_err(|_| "Unable to append the holding operation ledger event.".to_owned())?;
    Ok(())
}

fn append_position_valuation(
    connection: &Connection,
    vault_id: &str,
    draft_id: &str,
    holding_id: &str,
    position: &PositionAfter,
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
                position.valuation_id,
                vault_id,
                holding_id,
                draft_id,
                position.units_micros,
                position.cost_basis_minor,
                position.market_value_minor,
                position.valuation_date
            ],
        )
        .map_err(|_| "Unable to append the holding operation valuation.".to_owned())?;
    Ok(())
}

fn confirm_operation(
    connection: &Connection,
    vault_id: &str,
    draft_id: &str,
    payload: &HoldingOperationPayload,
) -> Result<(), String> {
    let current = holding_operation_context(connection, vault_id, &payload.context.holding_id)?;
    if current != payload.context {
        return Err(
            "The holding changed after operation review. Create a new review draft before confirming."
                .to_owned(),
        );
    }
    if let Some(settlement_id) = payload.settlement_account_id.as_deref() {
        let (_, currency) = active_account(connection, vault_id, settlement_id)?;
        if currency != payload.context.currency {
            return Err(
                "Holding operation settlement currency must match the holding currency.".to_owned(),
            );
        }
    }

    let occurred_at = format!("{}T00:00:00.000Z", payload.occurred_on);
    let transaction_kind = match payload.operation_kind.as_str() {
        "purchase" | "redeem" => "transfer",
        "dividend" => "income",
        "fee" => "expense",
        _ => return Err("Holding operation type is not supported.".to_owned()),
    };
    let metadata = json!({
        "source": "manual_holding_operation",
        "description": payload.description,
        "category": match payload.operation_kind.as_str() {
            "purchase" => "产品申购",
            "redeem" => "产品赎回",
            "dividend" => "理财收益",
            "fee" => "投资费用",
            _ => "持仓操作"
        },
        "notes": payload.notes,
        "transactionKind": transaction_kind,
        "holdingOperationId": payload.operation_id,
        "holdingId": payload.context.holding_id,
        "holdingName": payload.context.holding_name,
        "holdingOperationKind": payload.operation_kind
    })
    .to_string();

    match payload.operation_kind.as_str() {
        "purchase" | "redeem" if payload.settlement_account_id.is_some() => {
            let settlement_id = payload
                .settlement_account_id
                .as_deref()
                .ok_or_else(|| "The settlement account is missing.".to_owned())?;
            let primary_id = payload
                .primary_event_id
                .as_deref()
                .ok_or_else(|| "The holding transfer source event is missing.".to_owned())?;
            let secondary_id = payload
                .secondary_event_id
                .as_deref()
                .ok_or_else(|| "The holding transfer destination event is missing.".to_owned())?;
            let link_id = payload
                .ledger_link_id
                .as_deref()
                .ok_or_else(|| "The holding transfer link is missing.".to_owned())?;
            let (source_id, destination_id) = if payload.operation_kind == "purchase" {
                (settlement_id, payload.context.holding_account_id.as_str())
            } else {
                (payload.context.holding_account_id.as_str(), settlement_id)
            };
            append_ledger_event(
                connection,
                vault_id,
                draft_id,
                primary_id,
                source_id,
                "transfer_out",
                -payload.amount_minor,
                &payload.context.currency,
                &occurred_at,
                "transfer-out",
                Some(link_id),
                &metadata,
            )?;
            append_ledger_event(
                connection,
                vault_id,
                draft_id,
                secondary_id,
                destination_id,
                "transfer_in",
                payload.amount_minor,
                &payload.context.currency,
                &occurred_at,
                "transfer-in",
                Some(link_id),
                &metadata,
            )?;
        }
        "purchase" | "redeem" => {}
        "dividend" | "fee" => {
            let account_id = payload
                .settlement_account_id
                .as_deref()
                .ok_or_else(|| "The settlement account is missing.".to_owned())?;
            let event_id = payload
                .primary_event_id
                .as_deref()
                .ok_or_else(|| "The holding cash event is missing.".to_owned())?;
            let (event_type, delta, suffix) = if payload.operation_kind == "dividend" {
                ("income", payload.amount_minor, "dividend")
            } else {
                ("expense", -payload.amount_minor, "fee")
            };
            append_ledger_event(
                connection,
                vault_id,
                draft_id,
                event_id,
                account_id,
                event_type,
                delta,
                &payload.context.currency,
                &occurred_at,
                suffix,
                None,
                &metadata,
            )?;
        }
        _ => return Err("Holding operation type is not supported.".to_owned()),
    }

    if let Some(position) = payload.position_after.as_ref() {
        append_position_valuation(
            connection,
            vault_id,
            draft_id,
            &payload.context.holding_id,
            position,
        )?;
    }
    connection
        .execute(
            "INSERT INTO holding_operations(
               id, vault_id, holding_id, draft_id, operation_kind,
               amount_minor, currency, units_delta_micros,
               before_valuation_id, after_valuation_id,
               settlement_account_id, ledger_link_id,
               primary_ledger_event_id, secondary_ledger_event_id,
               occurred_on, description, notes, created_at
             ) VALUES (
               ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
               ?11, ?12, ?13, ?14, ?15, ?16, ?17,
               strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![
                payload.operation_id,
                vault_id,
                payload.context.holding_id,
                draft_id,
                payload.operation_kind,
                payload.amount_minor,
                payload.context.currency,
                payload.units_delta_micros,
                payload.context.valuation_id,
                payload
                    .position_after
                    .as_ref()
                    .map(|position| position.valuation_id.as_str()),
                payload.settlement_account_id,
                payload.ledger_link_id,
                payload.primary_event_id,
                payload.secondary_event_id,
                payload.occurred_on,
                payload.description,
                payload.notes
            ],
        )
        .map_err(|_| "Unable to append the immutable holding operation.".to_owned())?;
    connection
        .execute(
            "INSERT INTO audit_events(
               id, vault_id, category, action, actor_id,
               object_type, object_id, metadata_json, occurred_at
             ) VALUES (
               ?1, ?2, 'data', 'holding_operation_created', 'local_user',
               'holding_operation', ?3, ?4,
               strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![
                random_id("audit")?,
                vault_id,
                payload.operation_id,
                json!({
                    "holdingId": payload.context.holding_id,
                    "operationKind": payload.operation_kind,
                    "balanceEffect": operation_balance_effect(payload),
                    "beforeValuationId": payload.context.valuation_id,
                    "afterValuationId": payload.position_after.as_ref()
                        .map(|position| position.valuation_id.as_str()),
                    "ledgerEventCount": usize::from(payload.primary_event_id.is_some())
                        + usize::from(payload.secondary_event_id.is_some())
                })
                .to_string()
            ],
        )
        .map_err(|_| "Unable to append the holding operation audit event.".to_owned())?;
    Ok(())
}

fn confirm_operation_draft_at(
    runtime: &VaultRuntime,
    request: ConfirmHoldingOperationDraftRequest,
) -> Result<HoldingOperationConfirmationResponse, String> {
    if !request.confirmed_by_user {
        return Err("Explicit user confirmation is required.".to_owned());
    }
    let draft_id = required_text(request.draft_id, "Draft identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let row: Option<(String, String)> = connection
            .query_row(
                "SELECT status, proposed_events_json FROM draft_changes
                 WHERE id = ?1 AND vault_id = ?2
                   AND source_type = 'manual_holding_operation'",
                params![draft_id, vault_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| "Unable to read the holding operation draft.".to_owned())?;
        let (status, proposed) =
            row.ok_or_else(|| "The holding operation draft does not exist.".to_owned())?;
        let header: HoldingOperationDraftHeader = serde_json::from_str(&proposed)
            .map_err(|_| "The holding operation draft is invalid.".to_owned())?;
        if header.kind != "holding_operation.create" {
            return Err("The holding operation draft type is invalid.".to_owned());
        }
        let payload: HoldingOperationPayload = serde_json::from_str(&proposed)
            .map_err(|_| "The holding operation draft is invalid.".to_owned())?;
        if status == "confirmed" {
            return Ok(HoldingOperationConfirmationResponse {
                draft_id,
                operation_id: header.operation_id,
                holding_id: payload.context.holding_id,
                status: "confirmed",
            });
        }
        if status != "needs_review" {
            return Err(
                "The holding operation draft is no longer available for confirmation.".to_owned(),
            );
        }
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "Unable to start the holding operation confirmation.".to_owned())?;
        confirm_operation(&transaction, vault_id, &draft_id, &payload)?;
        let updated = transaction
            .execute(
                "UPDATE draft_changes
                 SET status = 'confirmed',
                     confirmed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                     confirmed_by = 'local_user'
                 WHERE id = ?1 AND vault_id = ?2 AND status = 'needs_review'",
                params![draft_id, vault_id],
            )
            .map_err(|_| "Unable to confirm the holding operation draft.".to_owned())?;
        if updated != 1 {
            return Err("The holding operation draft changed before confirmation.".to_owned());
        }
        transaction
            .commit()
            .map_err(|_| "Unable to commit the holding operation.".to_owned())?;
        Ok(HoldingOperationConfirmationResponse {
            draft_id,
            operation_id: payload.operation_id,
            holding_id: payload.context.holding_id,
            status: "confirmed",
        })
    })
}

fn reject_operation_draft_at(
    runtime: &VaultRuntime,
    request: RejectHoldingOperationDraftRequest,
) -> Result<HoldingOperationRejectionResponse, String> {
    let draft_id = required_text(request.draft_id, "Draft identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let status: Option<String> = connection
            .query_row(
                "SELECT status FROM draft_changes
                 WHERE id = ?1 AND vault_id = ?2
                   AND source_type = 'manual_holding_operation'",
                params![draft_id, vault_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| "Unable to read the holding operation draft.".to_owned())?;
        match status.as_deref() {
            None => return Err("The holding operation draft does not exist.".to_owned()),
            Some("confirmed") => {
                return Err("A confirmed holding operation draft cannot be rejected.".to_owned())
            }
            Some("rejected") => {
                return Ok(HoldingOperationRejectionResponse {
                    draft_id,
                    status: "rejected",
                })
            }
            Some("needs_review") => {}
            _ => return Err("The holding operation draft state is invalid.".to_owned()),
        }
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "Unable to start the holding operation draft rejection.".to_owned())?;
        transaction
            .execute(
                "UPDATE draft_changes
                 SET status = 'rejected',
                     rejected_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                     rejection_reason = 'user_cancelled'
                 WHERE id = ?1 AND vault_id = ?2 AND status = 'needs_review'",
                params![draft_id, vault_id],
            )
            .map_err(|_| "Unable to reject the holding operation draft.".to_owned())?;
        transaction
            .execute(
                "INSERT INTO audit_events(
                   id, vault_id, category, action, actor_id,
                   object_type, object_id, metadata_json, occurred_at
                 ) VALUES (
                   ?1, ?2, 'data', 'holding_operation_draft_rejected', 'local_user',
                   'draft_change', ?3, '{}',
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![random_id("audit")?, vault_id, draft_id],
            )
            .map_err(|_| "Unable to append the holding operation rejection audit.".to_owned())?;
        transaction
            .commit()
            .map_err(|_| "Unable to commit the holding operation draft rejection.".to_owned())?;
        Ok(HoldingOperationRejectionResponse {
            draft_id,
            status: "rejected",
        })
    })
}

fn inverse_operation_kind(kind: &str) -> Result<&'static str, String> {
    match kind {
        "purchase" => Ok("redeem"),
        "redeem" => Ok("purchase"),
        "dividend" => Ok("fee"),
        "fee" => Ok("dividend"),
        _ => Err("Holding operation type is not supported.".to_owned()),
    }
}

fn load_reversal_event_plan(
    connection: &Connection,
    vault_id: &str,
    original_event_id: &str,
) -> Result<ReversalEventPlan, String> {
    let original: Option<(String, i64, String)> = connection
        .query_row(
            "SELECT account_id, delta_minor, currency
             FROM ledger_events
             WHERE id = ?1 AND vault_id = ?2",
            params![original_event_id, vault_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|_| "Unable to read the holding operation ledger event.".to_owned())?;
    let (account_id, delta_minor, currency) =
        original.ok_or_else(|| "The holding operation ledger event is missing.".to_owned())?;
    let already_reversed: bool = connection
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM ledger_events
               WHERE vault_id = ?1 AND reverses_event_id = ?2
             )",
            params![vault_id, original_event_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to verify the holding operation correction state.".to_owned())?;
    if already_reversed {
        return Err("The holding operation has already been corrected.".to_owned());
    }
    Ok(ReversalEventPlan {
        original_event_id: original_event_id.to_owned(),
        reversal_event_id: random_id("event")?,
        account_id,
        delta_minor: delta_minor
            .checked_neg()
            .ok_or_else(|| "The holding operation reversal amount is unsafe.".to_owned())?,
        currency,
    })
}

fn correction_draft_response(
    draft_id: String,
    payload: &HoldingOperationCorrectionPayload,
) -> HoldingOperationCorrectionDraftResponse {
    HoldingOperationCorrectionDraftResponse {
        draft_id,
        action: "reverse",
        correction_id: payload.correction_id.clone(),
        original_operation_id: payload.original_operation_id.clone(),
        original_operation_kind: payload.original_operation_kind.clone(),
        compensating_operation_id: payload.compensating_operation_id.clone(),
        compensating_operation_kind: payload.compensating_operation_kind.clone(),
        holding_id: payload.holding_id.clone(),
        holding_name: payload.holding_name.clone(),
        holding_account_name: payload.holding_account_name.clone(),
        settlement_account_name: payload.settlement_account_name.clone(),
        amount_minor: payload.amount_minor,
        currency: payload.currency.clone(),
        occurred_on: payload.occurred_on.clone(),
        reason: payload.reason.clone(),
        restored_units_micros: payload
            .restored_position
            .as_ref()
            .map(|position| position.units_micros),
        restored_cost_basis_minor: payload
            .restored_position
            .as_ref()
            .map(|position| position.cost_basis_minor),
        restored_market_value_minor: payload
            .restored_position
            .as_ref()
            .map(|position| position.market_value_minor),
        ledger_event_count: payload.reversal_events.len(),
        status: "needs_review",
    }
}

fn build_correction_payload(
    connection: &Connection,
    vault_id: &str,
    request: CreateHoldingOperationCorrectionDraftRequest,
) -> Result<HoldingOperationCorrectionPayload, String> {
    let operation_id = required_text(request.operation_id, "Holding operation identifier", 96)?;
    let reason = required_text(request.reason, "Holding operation correction reason", 240)?;
    let occurred_on = validate_date(
        connection,
        request.occurred_on,
        "Holding operation correction date",
    )?;
    let row: Option<(
        String,
        String,
        String,
        String,
        String,
        i64,
        String,
        i64,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
    )> = connection
        .query_row(
            "SELECT
               o.holding_id, h.name, h.account_id, a.display_name,
               o.operation_kind, o.amount_minor, o.currency,
               o.units_delta_micros, o.before_valuation_id,
               o.after_valuation_id, o.settlement_account_id,
               settlement.display_name, o.primary_ledger_event_id,
               o.secondary_ledger_event_id, o.description
             FROM holding_operations o
             JOIN holdings h ON h.id = o.holding_id AND h.vault_id = o.vault_id
             JOIN accounts a ON a.id = h.account_id AND a.vault_id = h.vault_id
             LEFT JOIN accounts settlement
               ON settlement.id = o.settlement_account_id
              AND settlement.vault_id = o.vault_id
             WHERE o.id = ?1 AND o.vault_id = ?2
               AND h.archived_at IS NULL AND a.archived_at IS NULL",
            params![operation_id, vault_id],
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
                ))
            },
        )
        .optional()
        .map_err(|_| "Unable to read the holding operation correction context.".to_owned())?;
    let (
        holding_id,
        holding_name,
        holding_account_id,
        holding_account_name,
        original_operation_kind,
        amount_minor,
        currency,
        original_units_delta_micros,
        before_valuation_id,
        after_valuation_id,
        settlement_account_id,
        settlement_account_name,
        primary_event_id,
        secondary_event_id,
        original_description,
    ) = row.ok_or_else(|| "The holding operation does not exist or is unavailable.".to_owned())?;
    let already_corrected: bool = connection
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM holding_operation_corrections
               WHERE vault_id = ?1 AND original_operation_id = ?2
             )",
            params![vault_id, operation_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to verify the holding operation correction state.".to_owned())?;
    if already_corrected {
        return Err("The holding operation has already been corrected.".to_owned());
    }
    let current = holding_operation_context(connection, vault_id, &holding_id)?;
    if occurred_on < current.valuation_date {
        return Err(
            "Holding operation correction date cannot be older than the current valuation."
                .to_owned(),
        );
    }
    let restored_position = if let Some(after_id) = after_valuation_id.as_deref() {
        if current.valuation_id != after_id {
            return Err(
                "Only the latest position-changing holding operation can be corrected.".to_owned(),
            );
        }
        let (units_micros, cost_basis_minor, market_value_minor): (i64, i64, i64) = connection
            .query_row(
                "SELECT units_micros, cost_basis_minor, market_value_minor
                 FROM holding_valuations
                 WHERE id = ?1 AND vault_id = ?2 AND holding_id = ?3",
                params![before_valuation_id, vault_id, holding_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|_| "Unable to read the valuation restored by this correction.".to_owned())?;
        Some(PositionAfter {
            valuation_id: random_id("valuation")?,
            units_micros,
            cost_basis_minor,
            market_value_minor,
            valuation_date: occurred_on.clone(),
        })
    } else {
        None
    };
    if let Some(settlement_id) = settlement_account_id.as_deref() {
        let (_, settlement_currency) = active_account(connection, vault_id, settlement_id)?;
        if settlement_currency != currency {
            return Err(
                "Holding operation settlement currency must match the holding currency.".to_owned(),
            );
        }
    }
    let mut reversal_events = Vec::new();
    if let Some(event_id) = primary_event_id.as_deref() {
        reversal_events.push(load_reversal_event_plan(connection, vault_id, event_id)?);
    }
    if let Some(event_id) = secondary_event_id.as_deref() {
        reversal_events.push(load_reversal_event_plan(connection, vault_id, event_id)?);
    }
    let compensating_operation_kind = inverse_operation_kind(&original_operation_kind)?.to_owned();
    Ok(HoldingOperationCorrectionPayload {
        kind: "holding_operation.correction".to_owned(),
        correction_id: random_id("holding_correction")?,
        compensating_operation_id: random_id("holding_op")?,
        original_operation_id: operation_id,
        original_operation_kind,
        compensating_operation_kind,
        holding_id,
        holding_name,
        holding_account_id,
        holding_account_name,
        currency,
        amount_minor,
        original_units_delta_micros,
        current_valuation_id: current.valuation_id,
        restored_position,
        settlement_account_id,
        settlement_account_name,
        ledger_link_id: (reversal_events.len() == 2)
            .then(|| random_id("holding_correction_transfer"))
            .transpose()?,
        reversal_events,
        occurred_on,
        original_description,
        reason,
    })
}

fn create_operation_correction_draft_at(
    runtime: &VaultRuntime,
    request: CreateHoldingOperationCorrectionDraftRequest,
) -> Result<HoldingOperationCorrectionDraftResponse, String> {
    runtime.with_unlocked_connection(|vault_id, connection| {
        let payload = build_correction_payload(connection, vault_id, request)?;
        let draft_id = random_id("draft")?;
        let proposed = serde_json::to_string(&payload).map_err(|_| {
            "Unable to serialize the holding operation correction draft.".to_owned()
        })?;
        let evidence = json!([{
            "source": "manual_holding_operation_correction",
            "originalOperationId": payload.original_operation_id,
            "reviewRequired": true,
            "correctionMode": "compensating_reversal"
        }])
        .to_string();
        connection
            .execute(
                "INSERT INTO draft_changes(
                   id, vault_id, source_type, source_fingerprint, status,
                   proposed_events_json, evidence_json, created_at
                 ) VALUES (
                   ?1, ?2, 'manual_holding_operation_correction', ?1,
                   'needs_review', ?3, ?4,
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![draft_id, vault_id, proposed, evidence],
            )
            .map_err(|_| {
                "Unable to save the holding operation correction review draft.".to_owned()
            })?;
        Ok(correction_draft_response(draft_id, &payload))
    })
}

fn append_holding_reversal_event(
    connection: &Connection,
    vault_id: &str,
    draft_id: &str,
    payload: &HoldingOperationCorrectionPayload,
    plan: &ReversalEventPlan,
    index: usize,
) -> Result<(), String> {
    let occurred_at = format!("{}T00:00:00.000Z", payload.occurred_on);
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
                plan.reversal_event_id,
                vault_id,
                plan.account_id,
                draft_id,
                plan.delta_minor,
                plan.currency,
                occurred_at,
                format!("holding-operation-correction:{draft_id}:{index}"),
                payload.ledger_link_id,
                plan.original_event_id,
                json!({
                    "source": "manual_holding_operation_correction",
                    "description": format!("冲销：{}", payload.original_description),
                    "category": "产品操作冲销",
                    "notes": payload.reason,
                    "transactionKind": "reversal",
                    "holdingOperationId": payload.compensating_operation_id,
                    "holdingId": payload.holding_id,
                    "holdingName": payload.holding_name,
                    "holdingOperationKind": payload.compensating_operation_kind,
                    "reversesHoldingOperationId": payload.original_operation_id,
                    "reason": payload.reason
                })
                .to_string()
            ],
        )
        .map_err(|_| "Unable to append the holding operation reversal event.".to_owned())?;
    Ok(())
}

fn confirm_operation_correction(
    connection: &Connection,
    vault_id: &str,
    draft_id: &str,
    payload: &HoldingOperationCorrectionPayload,
) -> Result<(), String> {
    let already_corrected: bool = connection
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM holding_operation_corrections
               WHERE vault_id = ?1 AND original_operation_id = ?2
             )",
            params![vault_id, payload.original_operation_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to verify the holding operation correction state.".to_owned())?;
    if already_corrected {
        return Err("The holding operation has already been corrected.".to_owned());
    }
    let current = holding_operation_context(connection, vault_id, &payload.holding_id)?;
    if payload.restored_position.is_some() && current.valuation_id != payload.current_valuation_id {
        return Err(
            "The holding changed after correction review. Create a new correction draft."
                .to_owned(),
        );
    }
    if let Some(settlement_id) = payload.settlement_account_id.as_deref() {
        let (_, settlement_currency) = active_account(connection, vault_id, settlement_id)?;
        if settlement_currency != payload.currency {
            return Err(
                "Holding operation settlement currency must match the holding currency.".to_owned(),
            );
        }
    }
    for (index, plan) in payload.reversal_events.iter().enumerate() {
        let unchanged: bool = connection
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM ledger_events
                   WHERE id = ?1 AND vault_id = ?2 AND account_id = ?3
                     AND delta_minor = ?4 AND currency = ?5
                     AND NOT EXISTS(
                       SELECT 1 FROM ledger_events reversal
                       WHERE reversal.vault_id = ?2
                         AND reversal.reverses_event_id = ?1
                     )
                 )",
                params![
                    plan.original_event_id,
                    vault_id,
                    plan.account_id,
                    plan.delta_minor.checked_neg().ok_or_else(|| {
                        "The holding operation reversal amount is unsafe.".to_owned()
                    })?,
                    plan.currency
                ],
                |row| row.get(0),
            )
            .map_err(|_| "Unable to verify the original holding ledger event.".to_owned())?;
        if !unchanged {
            return Err(
                "The holding operation changed after correction review. Create a new correction draft."
                    .to_owned(),
            );
        }
        append_holding_reversal_event(connection, vault_id, draft_id, payload, plan, index)?;
    }
    if let Some(position) = payload.restored_position.as_ref() {
        append_position_valuation(
            connection,
            vault_id,
            draft_id,
            &payload.holding_id,
            position,
        )?;
    }
    let description: String = format!("冲销：{}", payload.original_description)
        .chars()
        .take(120)
        .collect();
    connection
        .execute(
            "INSERT INTO holding_operations(
               id, vault_id, holding_id, draft_id, operation_kind,
               amount_minor, currency, units_delta_micros,
               before_valuation_id, after_valuation_id,
               settlement_account_id, ledger_link_id,
               primary_ledger_event_id, secondary_ledger_event_id,
               occurred_on, description, notes, created_at
             ) VALUES (
               ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
               ?11, ?12, ?13, ?14, ?15, ?16, ?17,
               strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![
                payload.compensating_operation_id,
                vault_id,
                payload.holding_id,
                draft_id,
                payload.compensating_operation_kind,
                payload.amount_minor,
                payload.currency,
                payload
                    .original_units_delta_micros
                    .checked_neg()
                    .ok_or_else(|| "The holding unit reversal is unsafe.".to_owned())?,
                current.valuation_id,
                payload
                    .restored_position
                    .as_ref()
                    .map(|position| position.valuation_id.as_str()),
                payload.settlement_account_id,
                payload.ledger_link_id,
                payload
                    .reversal_events
                    .first()
                    .map(|event| event.reversal_event_id.as_str()),
                payload
                    .reversal_events
                    .get(1)
                    .map(|event| event.reversal_event_id.as_str()),
                payload.occurred_on,
                description,
                payload.reason
            ],
        )
        .map_err(|_| "Unable to append the compensating holding operation.".to_owned())?;
    connection
        .execute(
            "INSERT INTO holding_operation_corrections(
               id, vault_id, draft_id, original_operation_id,
               compensating_operation_id, reason, created_at
             ) VALUES (
               ?1, ?2, ?3, ?4, ?5, ?6,
               strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![
                payload.correction_id,
                vault_id,
                draft_id,
                payload.original_operation_id,
                payload.compensating_operation_id,
                payload.reason
            ],
        )
        .map_err(|_| "Unable to append the immutable holding operation correction.".to_owned())?;
    connection
        .execute(
            "INSERT INTO audit_events(
               id, vault_id, category, action, actor_id,
               object_type, object_id, metadata_json, occurred_at
             ) VALUES (
               ?1, ?2, 'data', 'holding_operation_reversed', 'local_user',
               'holding_operation', ?3, ?4,
               strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![
                random_id("audit")?,
                vault_id,
                payload.compensating_operation_id,
                json!({
                    "correctionId": payload.correction_id,
                    "originalOperationId": payload.original_operation_id,
                    "holdingId": payload.holding_id,
                    "reason": payload.reason,
                    "ledgerEventCount": payload.reversal_events.len(),
                    "restoredValuationId": payload.restored_position.as_ref()
                        .map(|position| position.valuation_id.as_str())
                })
                .to_string()
            ],
        )
        .map_err(|_| "Unable to append the holding operation correction audit.".to_owned())?;
    Ok(())
}

fn confirm_operation_correction_draft_at(
    runtime: &VaultRuntime,
    request: ConfirmHoldingOperationCorrectionDraftRequest,
) -> Result<HoldingOperationCorrectionConfirmationResponse, String> {
    if !request.confirmed_by_user {
        return Err("Explicit user confirmation is required.".to_owned());
    }
    let draft_id = required_text(request.draft_id, "Draft identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let row: Option<(String, String)> = connection
            .query_row(
                "SELECT status, proposed_events_json FROM draft_changes
                 WHERE id = ?1 AND vault_id = ?2
                   AND source_type = 'manual_holding_operation_correction'",
                params![draft_id, vault_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| "Unable to read the holding operation correction draft.".to_owned())?;
        let (status, proposed) =
            row.ok_or_else(|| "The holding operation correction draft does not exist.".to_owned())?;
        let payload: HoldingOperationCorrectionPayload = serde_json::from_str(&proposed)
            .map_err(|_| "The holding operation correction draft is invalid.".to_owned())?;
        if payload.kind != "holding_operation.correction" {
            return Err("The holding operation correction draft type is invalid.".to_owned());
        }
        if status == "confirmed" {
            return Ok(HoldingOperationCorrectionConfirmationResponse {
                draft_id,
                correction_id: payload.correction_id,
                original_operation_id: payload.original_operation_id,
                compensating_operation_id: payload.compensating_operation_id,
                holding_id: payload.holding_id,
                status: "confirmed",
            });
        }
        if status != "needs_review" {
            return Err(
                "The holding operation correction draft is no longer available for confirmation."
                    .to_owned(),
            );
        }
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "Unable to start the holding operation correction.".to_owned())?;
        confirm_operation_correction(&transaction, vault_id, &draft_id, &payload)?;
        let updated = transaction
            .execute(
                "UPDATE draft_changes
                 SET status = 'confirmed',
                     confirmed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                     confirmed_by = 'local_user'
                 WHERE id = ?1 AND vault_id = ?2 AND status = 'needs_review'",
                params![draft_id, vault_id],
            )
            .map_err(|_| "Unable to confirm the holding operation correction draft.".to_owned())?;
        if updated != 1 {
            return Err(
                "The holding operation correction draft changed before confirmation.".to_owned(),
            );
        }
        transaction
            .commit()
            .map_err(|_| "Unable to commit the holding operation correction.".to_owned())?;
        Ok(HoldingOperationCorrectionConfirmationResponse {
            draft_id,
            correction_id: payload.correction_id,
            original_operation_id: payload.original_operation_id,
            compensating_operation_id: payload.compensating_operation_id,
            holding_id: payload.holding_id,
            status: "confirmed",
        })
    })
}

fn reject_operation_correction_draft_at(
    runtime: &VaultRuntime,
    request: RejectHoldingOperationCorrectionDraftRequest,
) -> Result<HoldingOperationCorrectionRejectionResponse, String> {
    let draft_id = required_text(request.draft_id, "Draft identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let status: Option<String> = connection
            .query_row(
                "SELECT status FROM draft_changes
                 WHERE id = ?1 AND vault_id = ?2
                   AND source_type = 'manual_holding_operation_correction'",
                params![draft_id, vault_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| "Unable to read the holding operation correction draft.".to_owned())?;
        match status.as_deref() {
            None => return Err("The holding operation correction draft does not exist.".to_owned()),
            Some("confirmed") => {
                return Err(
                    "A confirmed holding operation correction draft cannot be rejected.".to_owned(),
                )
            }
            Some("rejected") => {
                return Ok(HoldingOperationCorrectionRejectionResponse {
                    draft_id,
                    status: "rejected",
                })
            }
            Some("needs_review") => {}
            _ => return Err("The holding operation correction draft state is invalid.".to_owned()),
        }
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| {
                "Unable to start the holding operation correction rejection.".to_owned()
            })?;
        transaction
            .execute(
                "UPDATE draft_changes
                 SET status = 'rejected',
                     rejected_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                     rejection_reason = 'user_cancelled'
                 WHERE id = ?1 AND vault_id = ?2 AND status = 'needs_review'",
                params![draft_id, vault_id],
            )
            .map_err(|_| "Unable to reject the holding operation correction draft.".to_owned())?;
        transaction
            .execute(
                "INSERT INTO audit_events(
                   id, vault_id, category, action, actor_id,
                   object_type, object_id, metadata_json, occurred_at
                 ) VALUES (
                   ?1, ?2, 'data', 'holding_operation_correction_draft_rejected',
                   'local_user', 'draft_change', ?3, '{}',
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![random_id("audit")?, vault_id, draft_id],
            )
            .map_err(|_| {
                "Unable to append the holding operation correction rejection audit.".to_owned()
            })?;
        transaction.commit().map_err(|_| {
            "Unable to commit the holding operation correction rejection.".to_owned()
        })?;
        Ok(HoldingOperationCorrectionRejectionResponse {
            draft_id,
            status: "rejected",
        })
    })
}

pub(crate) fn holding_operation_snapshot(
    connection: &Connection,
    vault_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let mut statement = connection
        .prepare(
            "SELECT
               o.id, o.holding_id, h.name, h.account_id, a.display_name,
               o.operation_kind, o.amount_minor, o.currency,
               o.units_delta_micros, o.before_valuation_id,
               o.after_valuation_id, o.settlement_account_id,
               settlement.display_name, o.ledger_link_id,
               o.primary_ledger_event_id, o.secondary_ledger_event_id,
               o.occurred_on, o.description, o.notes, o.created_at,
               original_correction.compensating_operation_id,
               reversal_correction.original_operation_id,
               COALESCE(original_correction.reason, reversal_correction.reason)
             FROM holding_operations o
             JOIN holdings h ON h.id = o.holding_id AND h.vault_id = o.vault_id
             JOIN accounts a ON a.id = h.account_id AND a.vault_id = h.vault_id
             LEFT JOIN accounts settlement
               ON settlement.id = o.settlement_account_id
              AND settlement.vault_id = o.vault_id
             LEFT JOIN holding_operation_corrections original_correction
               ON original_correction.original_operation_id = o.id
              AND original_correction.vault_id = o.vault_id
             LEFT JOIN holding_operation_corrections reversal_correction
               ON reversal_correction.compensating_operation_id = o.id
              AND reversal_correction.vault_id = o.vault_id
             WHERE o.vault_id = ?1
             ORDER BY o.occurred_on DESC, o.created_at DESC, o.id DESC",
        )
        .map_err(|_| "Unable to prepare holding operation history.".to_owned())?;
    let rows = statement
        .query_map([vault_id], |row| {
            let operation_kind: String = row.get(5)?;
            let primary_event_id: Option<String> = row.get(14)?;
            let balance_effect = match operation_kind.as_str() {
                "purchase" | "redeem" if primary_event_id.is_some() => "transfer",
                "purchase" | "redeem" => "none",
                "dividend" => "income",
                "fee" => "expense",
                _ => "none",
            };
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "holdingId": row.get::<_, String>(1)?,
                "holdingName": row.get::<_, String>(2)?,
                "holdingAccountId": row.get::<_, String>(3)?,
                "holdingAccountName": row.get::<_, String>(4)?,
                "operationKind": operation_kind,
                "amountMinor": row.get::<_, i64>(6)?,
                "currency": row.get::<_, String>(7)?,
                "unitsDeltaMicros": row.get::<_, i64>(8)?,
                "beforeValuationId": row.get::<_, String>(9)?,
                "afterValuationId": row.get::<_, Option<String>>(10)?,
                "settlementAccountId": row.get::<_, Option<String>>(11)?,
                "settlementAccountName": row.get::<_, Option<String>>(12)?,
                "ledgerLinkId": row.get::<_, Option<String>>(13)?,
                "primaryLedgerEventId": primary_event_id,
                "secondaryLedgerEventId": row.get::<_, Option<String>>(15)?,
                "occurredOn": row.get::<_, String>(16)?,
                "description": row.get::<_, String>(17)?,
                "notes": row.get::<_, Option<String>>(18)?,
                "createdAt": row.get::<_, String>(19)?,
                "balanceEffect": balance_effect,
                "reversedByOperationId": row.get::<_, Option<String>>(20)?,
                "reversesOperationId": row.get::<_, Option<String>>(21)?,
                "correctionReason": row.get::<_, Option<String>>(22)?,
                "reversed": row.get::<_, Option<String>>(20)?.is_some(),
                "isReversal": row.get::<_, Option<String>>(21)?.is_some()
            }))
        })
        .map_err(|_| "Unable to read holding operation history.".to_owned())?;
    let mut operations = Vec::new();
    for row in rows {
        operations.push(row.map_err(|_| "Unable to decode holding operation history.".to_owned())?);
    }
    Ok(operations)
}

#[tauri::command]
pub fn holding_operation_create_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: CreateHoldingOperationDraftRequest,
) -> Result<HoldingOperationDraftResponse, String> {
    create_operation_draft_at(&runtime, request)
}

#[tauri::command]
pub fn holding_operation_confirm_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: ConfirmHoldingOperationDraftRequest,
) -> Result<HoldingOperationConfirmationResponse, String> {
    confirm_operation_draft_at(&runtime, request)
}

#[tauri::command]
pub fn holding_operation_reject_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: RejectHoldingOperationDraftRequest,
) -> Result<HoldingOperationRejectionResponse, String> {
    reject_operation_draft_at(&runtime, request)
}

#[tauri::command]
pub fn holding_operation_correction_create_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: CreateHoldingOperationCorrectionDraftRequest,
) -> Result<HoldingOperationCorrectionDraftResponse, String> {
    create_operation_correction_draft_at(&runtime, request)
}

#[tauri::command]
pub fn holding_operation_correction_confirm_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: ConfirmHoldingOperationCorrectionDraftRequest,
) -> Result<HoldingOperationCorrectionConfirmationResponse, String> {
    confirm_operation_correction_draft_at(&runtime, request)
}

#[tauri::command]
pub fn holding_operation_correction_reject_draft(
    runtime: tauri::State<'_, VaultRuntime>,
    request: RejectHoldingOperationCorrectionDraftRequest,
) -> Result<HoldingOperationCorrectionRejectionResponse, String> {
    reject_operation_correction_draft_at(&runtime, request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::open_encrypted;

    fn runtime_with_holding() -> (tempfile::TempDir, VaultRuntime) {
        let directory = tempfile::tempdir().expect("temporary directory should exist");
        let connection = open_encrypted(
            &directory.path().join("holding-operations.sqlite3"),
            &[47_u8; 32],
        )
        .expect("encrypted database should open");
        connection
            .execute_batch(
                "
                INSERT INTO vaults(id, display_name, base_currency, created_at)
                VALUES ('vault-1', 'Operation test vault', 'CNY', '2026-07-27T00:00:00.000Z');
                INSERT INTO accounts(
                  id, vault_id, institution_name, display_name, account_type,
                  currency, created_at
                ) VALUES
                  ('investment', 'vault-1', '测试机构', '投资账户', 'fund',
                   'CNY', '2026-07-27T00:00:00.000Z'),
                  ('cash', 'vault-1', '测试银行', '现金账户', 'cash',
                   'CNY', '2026-07-27T00:00:00.000Z');
                INSERT INTO ledger_events(
                  id, vault_id, account_id, event_type, delta_minor, currency,
                  occurred_at, status, idempotency_key, created_at
                ) VALUES
                  ('opening-investment', 'vault-1', 'investment', 'opening_balance',
                   10000000, 'CNY', '2026-07-27T00:00:00.000Z',
                   'confirmed', 'operation-opening-investment', '2026-07-27T00:00:00.000Z'),
                  ('opening-cash', 'vault-1', 'cash', 'opening_balance',
                   5000000, 'CNY', '2026-07-27T00:00:00.000Z',
                   'confirmed', 'operation-opening-cash', '2026-07-27T00:00:00.000Z');
                INSERT INTO draft_changes(
                  id, vault_id, source_type, source_fingerprint, status,
                  proposed_events_json, evidence_json, created_at, confirmed_at, confirmed_by
                ) VALUES (
                  'holding-fixture-draft', 'vault-1', 'manual_holding',
                  'holding-fixture-draft', 'confirmed', '{}', '[]',
                  '2026-07-27T00:00:00.000Z', '2026-07-27T00:00:00.000Z', 'test'
                );
                INSERT INTO holdings(
                  id, vault_id, account_id, name, product_type, currency, created_at
                ) VALUES (
                  'holding-1', 'vault-1', 'investment', '测试红利基金',
                  'fund', 'CNY', '2026-07-27T00:00:00.000Z'
                );
                INSERT INTO holding_valuations(
                  id, vault_id, holding_id, draft_id, units_micros,
                  cost_basis_minor, market_value_minor, as_of_date,
                  source_type, created_at
                ) VALUES (
                  'valuation-1', 'vault-1', 'holding-1', 'holding-fixture-draft',
                  1000000, 2000000, 2200000, '2026-07-27',
                  'manual', '2026-07-27T00:00:00.000Z'
                );
                ",
            )
            .expect("holding operation fixtures should insert");
        let runtime = VaultRuntime::default();
        runtime.install_test_session("vault-1", connection);
        (directory, runtime)
    }

    fn purchase_request(settlement_account_id: Option<&str>) -> CreateHoldingOperationDraftRequest {
        CreateHoldingOperationDraftRequest {
            holding_id: "holding-1".to_owned(),
            operation_kind: "purchase".to_owned(),
            settlement_account_id: settlement_account_id.map(str::to_owned),
            amount: "3000.00".to_owned(),
            occurred_on: "2026-07-28".to_owned(),
            description: "追加申购".to_owned(),
            notes: None,
            resulting_units: Some("1.500000".to_owned()),
            resulting_cost_basis: Some("23000.00".to_owned()),
            resulting_market_value: Some("25000.00".to_owned()),
            valuation_date: Some("2026-07-28".to_owned()),
        }
    }

    fn confirm(runtime: &VaultRuntime, draft_id: String) -> HoldingOperationConfirmationResponse {
        confirm_operation_draft_at(
            runtime,
            ConfirmHoldingOperationDraftRequest {
                draft_id,
                confirmed_by_user: true,
            },
        )
        .expect("holding operation should confirm")
    }

    #[test]
    fn internal_purchase_updates_only_the_holding_snapshot() {
        let (_directory, runtime) = runtime_with_holding();
        let draft = create_operation_draft_at(&runtime, purchase_request(None)).unwrap();
        assert_eq!(draft.balance_effect, "none");
        confirm(&runtime, draft.draft_id);
        runtime
            .with_unlocked_connection(|vault_id, connection| {
                let investment_balance: i64 = connection
                    .query_row(
                        "SELECT balance_minor FROM account_balances
                     WHERE vault_id = ?1 AND account_id = 'investment'",
                        [vault_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                let ledger_count: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM ledger_events WHERE vault_id = ?1",
                        [vault_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                let operation_count: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM holding_operations WHERE vault_id = ?1",
                        [vault_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                let valuation_count: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM holding_valuations WHERE vault_id = ?1",
                        [vault_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(investment_balance, 10_000_000);
                assert_eq!(ledger_count, 2);
                assert_eq!(operation_count, 1);
                assert_eq!(valuation_count, 2);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn external_purchase_and_cash_operations_balance_exactly() {
        let (_directory, runtime) = runtime_with_holding();
        let purchase = create_operation_draft_at(&runtime, purchase_request(Some("cash"))).unwrap();
        assert_eq!(purchase.balance_effect, "transfer");
        confirm(&runtime, purchase.draft_id);

        let dividend = create_operation_draft_at(
            &runtime,
            CreateHoldingOperationDraftRequest {
                holding_id: "holding-1".to_owned(),
                operation_kind: "dividend".to_owned(),
                settlement_account_id: Some("cash".to_owned()),
                amount: "500.00".to_owned(),
                occurred_on: "2026-07-29".to_owned(),
                description: "现金分红".to_owned(),
                notes: None,
                resulting_units: None,
                resulting_cost_basis: None,
                resulting_market_value: None,
                valuation_date: None,
            },
        )
        .unwrap();
        assert_eq!(dividend.balance_effect, "income");
        confirm(&runtime, dividend.draft_id);

        let fee = create_operation_draft_at(
            &runtime,
            CreateHoldingOperationDraftRequest {
                holding_id: "holding-1".to_owned(),
                operation_kind: "fee".to_owned(),
                settlement_account_id: Some("cash".to_owned()),
                amount: "100.00".to_owned(),
                occurred_on: "2026-07-29".to_owned(),
                description: "产品费用".to_owned(),
                notes: None,
                resulting_units: None,
                resulting_cost_basis: None,
                resulting_market_value: None,
                valuation_date: None,
            },
        )
        .unwrap();
        assert_eq!(fee.balance_effect, "expense");
        confirm(&runtime, fee.draft_id);

        runtime
            .with_unlocked_connection(|vault_id, connection| {
                let investment: i64 = connection
                    .query_row(
                        "SELECT balance_minor FROM account_balances
                     WHERE vault_id = ?1 AND account_id = 'investment'",
                        [vault_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                let cash: i64 = connection
                    .query_row(
                        "SELECT balance_minor FROM account_balances
                     WHERE vault_id = ?1 AND account_id = 'cash'",
                        [vault_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                let operations = holding_operation_snapshot(connection, vault_id)?;
                assert_eq!(investment, 10_300_000);
                assert_eq!(cash, 4_740_000);
                assert_eq!(investment + cash, 15_040_000);
                assert_eq!(operations.len(), 3);
                assert_eq!(operations[0]["balanceEffect"], "expense");
                assert_eq!(operations[1]["balanceEffect"], "income");
                assert_eq!(operations[2]["balanceEffect"], "transfer");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn stale_and_rejected_operation_drafts_are_inert() {
        let (_directory, runtime) = runtime_with_holding();
        let first = create_operation_draft_at(&runtime, purchase_request(None)).unwrap();
        let stale = create_operation_draft_at(&runtime, purchase_request(None)).unwrap();
        confirm(&runtime, first.draft_id);
        assert!(confirm_operation_draft_at(
            &runtime,
            ConfirmHoldingOperationDraftRequest {
                draft_id: stale.draft_id,
                confirmed_by_user: true,
            }
        )
        .is_err());

        let rejected = create_operation_draft_at(
            &runtime,
            CreateHoldingOperationDraftRequest {
                holding_id: "holding-1".to_owned(),
                operation_kind: "dividend".to_owned(),
                settlement_account_id: Some("cash".to_owned()),
                amount: "800.00".to_owned(),
                occurred_on: "2026-07-29".to_owned(),
                description: "拒绝的分红".to_owned(),
                notes: None,
                resulting_units: None,
                resulting_cost_basis: None,
                resulting_market_value: None,
                valuation_date: None,
            },
        )
        .unwrap();
        reject_operation_draft_at(
            &runtime,
            RejectHoldingOperationDraftRequest {
                draft_id: rejected.draft_id,
            },
        )
        .unwrap();
        runtime
            .with_unlocked_connection(|vault_id, connection| {
                let cash: i64 = connection
                    .query_row(
                        "SELECT balance_minor FROM account_balances
                     WHERE vault_id = ?1 AND account_id = 'cash'",
                        [vault_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                let operation_count: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM holding_operations WHERE vault_id = ?1",
                        [vault_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(cash, 5_000_000);
                assert_eq!(operation_count, 1);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn external_purchase_correction_restores_position_and_both_balances() {
        let (_directory, runtime) = runtime_with_holding();
        let purchase = create_operation_draft_at(&runtime, purchase_request(Some("cash"))).unwrap();
        let operation_id = confirm(&runtime, purchase.draft_id).operation_id;
        let correction = create_operation_correction_draft_at(
            &runtime,
            CreateHoldingOperationCorrectionDraftRequest {
                operation_id: operation_id.clone(),
                reason: "申购金额录入错误".to_owned(),
                occurred_on: "2026-07-29".to_owned(),
            },
        )
        .unwrap();
        assert_eq!(correction.action, "reverse");
        assert_eq!(correction.original_operation_kind, "purchase");
        assert_eq!(correction.compensating_operation_kind, "redeem");
        assert_eq!(correction.ledger_event_count, 2);
        assert_eq!(correction.restored_units_micros, Some(1_000_000));
        confirm_operation_correction_draft_at(
            &runtime,
            ConfirmHoldingOperationCorrectionDraftRequest {
                draft_id: correction.draft_id,
                confirmed_by_user: true,
            },
        )
        .unwrap();
        runtime
            .with_unlocked_connection(|vault_id, connection| {
                let investment: i64 = connection
                    .query_row(
                        "SELECT balance_minor FROM account_balances
                         WHERE vault_id = ?1 AND account_id = 'investment'",
                        [vault_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                let cash: i64 = connection
                    .query_row(
                        "SELECT balance_minor FROM account_balances
                         WHERE vault_id = ?1 AND account_id = 'cash'",
                        [vault_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                let latest: (i64, i64, i64) = connection
                    .query_row(
                        "SELECT units_micros, cost_basis_minor, market_value_minor
                         FROM holding_valuations
                         WHERE vault_id = ?1 AND holding_id = 'holding-1'
                         ORDER BY as_of_date DESC, created_at DESC, id DESC LIMIT 1",
                        [vault_id],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                    )
                    .unwrap();
                let operations = holding_operation_snapshot(connection, vault_id)?;
                assert_eq!(investment, 10_000_000);
                assert_eq!(cash, 5_000_000);
                assert_eq!(latest, (1_000_000, 2_000_000, 2_200_000));
                assert_eq!(operations.len(), 2);
                assert_eq!(operations[0]["isReversal"], true);
                assert_eq!(operations[0]["reversesOperationId"], operation_id);
                assert_eq!(operations[1]["reversed"], true);
                assert_eq!(operations[1]["reversedByOperationId"], operations[0]["id"]);
                Ok(())
            })
            .unwrap();
        assert!(create_operation_correction_draft_at(
            &runtime,
            CreateHoldingOperationCorrectionDraftRequest {
                operation_id,
                reason: "重复冲销".to_owned(),
                occurred_on: "2026-07-30".to_owned(),
            }
        )
        .is_err());
    }

    #[test]
    fn dividend_correction_is_compensating_and_does_not_touch_valuation() {
        let (_directory, runtime) = runtime_with_holding();
        let dividend = create_operation_draft_at(
            &runtime,
            CreateHoldingOperationDraftRequest {
                holding_id: "holding-1".to_owned(),
                operation_kind: "dividend".to_owned(),
                settlement_account_id: Some("cash".to_owned()),
                amount: "500.00".to_owned(),
                occurred_on: "2026-07-28".to_owned(),
                description: "现金分红".to_owned(),
                notes: None,
                resulting_units: None,
                resulting_cost_basis: None,
                resulting_market_value: None,
                valuation_date: None,
            },
        )
        .unwrap();
        let operation_id = confirm(&runtime, dividend.draft_id).operation_id;
        let correction = create_operation_correction_draft_at(
            &runtime,
            CreateHoldingOperationCorrectionDraftRequest {
                operation_id,
                reason: "分红重复记录".to_owned(),
                occurred_on: "2026-07-29".to_owned(),
            },
        )
        .unwrap();
        assert_eq!(correction.compensating_operation_kind, "fee");
        assert_eq!(correction.ledger_event_count, 1);
        assert!(correction.restored_units_micros.is_none());
        confirm_operation_correction_draft_at(
            &runtime,
            ConfirmHoldingOperationCorrectionDraftRequest {
                draft_id: correction.draft_id,
                confirmed_by_user: true,
            },
        )
        .unwrap();
        runtime
            .with_unlocked_connection(|vault_id, connection| {
                let state: (i64, i64, i64) = connection
                    .query_row(
                        "SELECT
                           (SELECT balance_minor FROM account_balances
                            WHERE vault_id = ?1 AND account_id = 'cash'),
                           (SELECT count(*) FROM holding_valuations WHERE vault_id = ?1),
                           (SELECT count(*) FROM holding_operation_corrections WHERE vault_id = ?1)",
                        [vault_id],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                    )
                    .unwrap();
                assert_eq!(state, (5_000_000, 1, 1));
                Ok(())
            })
            .unwrap();
    }
}
