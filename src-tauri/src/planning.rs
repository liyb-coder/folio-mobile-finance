use crate::vault::VaultRuntime;
use getrandom::fill;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::json;

const MAX_SAFE_MINOR: i128 = 9_000_000_000_000_000;
const ALLOCATION_CATEGORIES: [&str; 6] = ["cash", "stable", "equity", "gold", "insurance", "other"];

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningAllocation {
    category: String,
    target_bps: i64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningProfile {
    id: String,
    name: String,
    base_currency: String,
    cash_buffer_minor: i64,
    allocations: Vec<PlanningAllocation>,
    version_id: String,
    notes: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePlanningDraftRequest {
    name: String,
    cash_buffer: String,
    allocations: Vec<PlanningAllocation>,
    notes: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmPlanningDraftRequest {
    draft_id: String,
    confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectPlanningDraftRequest {
    draft_id: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanningDraftPayload {
    kind: String,
    action: String,
    profile_id: String,
    before: Option<PlanningProfile>,
    after: PlanningProfile,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningDraftResponse {
    draft_id: String,
    action: String,
    profile_id: String,
    name: String,
    base_currency: String,
    cash_buffer_minor: i64,
    allocations: Vec<PlanningAllocation>,
    notes: Option<String>,
    review_status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningConfirmationResponse {
    draft_id: String,
    profile_id: String,
    action: String,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningRejectionResponse {
    draft_id: String,
    status: &'static str,
}

fn random_id(prefix: &str) -> Result<String, String> {
    let mut bytes = [0_u8; 16];
    fill(&mut bytes).map_err(|_| "Unable to create a secure planning identifier.".to_owned())?;
    Ok(format!("{prefix}_{}", hex::encode(bytes)))
}

fn required_text(value: String, field: &str, maximum: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > maximum {
        return Err(format!("{field} must contain 1 to {maximum} characters."));
    }
    Ok(value.to_owned())
}

fn optional_text(value: Option<String>, maximum: usize) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.chars().count() > maximum {
        return Err(format!("Notes must not exceed {maximum} characters."));
    }
    Ok(Some(value.to_owned()))
}

fn parse_nonnegative_minor(value: String) -> Result<i64, String> {
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
        return Err(
            "Cash buffer must be a non-negative number with at most two decimal places.".to_owned(),
        );
    }
    let major: i128 = major
        .parse()
        .map_err(|_| "Cash buffer is outside the supported range.".to_owned())?;
    let fraction = match fraction.unwrap_or_default() {
        "" => 0,
        value if value.len() == 1 => value
            .parse::<i128>()
            .map(|number| number * 10)
            .map_err(|_| "Cash buffer is invalid.".to_owned())?,
        value => value
            .parse::<i128>()
            .map_err(|_| "Cash buffer is invalid.".to_owned())?,
    };
    let minor = major
        .checked_mul(100)
        .and_then(|number| number.checked_add(fraction))
        .ok_or_else(|| "Cash buffer is outside the supported range.".to_owned())?;
    if minor > MAX_SAFE_MINOR {
        return Err("Cash buffer is outside the supported range.".to_owned());
    }
    i64::try_from(minor).map_err(|_| "Cash buffer is outside the supported range.".to_owned())
}

fn normalize_allocations(
    allocations: Vec<PlanningAllocation>,
) -> Result<Vec<PlanningAllocation>, String> {
    if allocations.len() != ALLOCATION_CATEGORIES.len() {
        return Err("All six planning allocation categories are required.".to_owned());
    }
    let mut normalized = Vec::with_capacity(ALLOCATION_CATEGORIES.len());
    for category in ALLOCATION_CATEGORIES {
        let matching: Vec<&PlanningAllocation> = allocations
            .iter()
            .filter(|allocation| allocation.category.trim().eq_ignore_ascii_case(category))
            .collect();
        if matching.len() != 1 {
            return Err("Planning allocation categories must be unique and complete.".to_owned());
        }
        let target_bps = matching[0].target_bps;
        if !(0..=10_000).contains(&target_bps) {
            return Err("Each planning target must be between 0% and 100%.".to_owned());
        }
        normalized.push(PlanningAllocation {
            category: category.to_owned(),
            target_bps,
        });
    }
    if normalized
        .iter()
        .map(|allocation| allocation.target_bps)
        .sum::<i64>()
        != 10_000
    {
        return Err("Planning allocation targets must total exactly 100%.".to_owned());
    }
    Ok(normalized)
}

fn now(connection: &Connection) -> Result<String, String> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get(0)
        })
        .map_err(|_| "Unable to create a planning timestamp.".to_owned())
}

fn read_profile(
    connection: &Connection,
    vault_id: &str,
) -> Result<Option<PlanningProfile>, String> {
    connection
        .query_row(
            "SELECT
                id, name, base_currency, cash_buffer_minor, allocations_json,
                version_id, notes, created_at, updated_at
             FROM planning_profiles WHERE vault_id = ?1",
            [vault_id],
            |row| {
                let allocations_json: String = row.get(4)?;
                let allocations = serde_json::from_str(&allocations_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        4,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;
                Ok(PlanningProfile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    base_currency: row.get(2)?,
                    cash_buffer_minor: row.get(3)?,
                    allocations,
                    version_id: row.get(5)?,
                    notes: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(|_| "Unable to read the encrypted planning profile.".to_owned())
}

fn save_draft(
    connection: &Connection,
    vault_id: &str,
    payload: PlanningDraftPayload,
) -> Result<PlanningDraftResponse, String> {
    let draft_id = random_id("draft")?;
    let proposed = serde_json::to_string(&payload)
        .map_err(|_| "Unable to serialize the planning review draft.".to_owned())?;
    connection
        .execute(
            "INSERT INTO draft_changes(
                id, vault_id, source_type, source_fingerprint, status,
                proposed_events_json, evidence_json, created_at
             ) VALUES (
                ?1, ?2, 'manual_planning', ?1, 'needs_review',
                ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![
                draft_id,
                vault_id,
                proposed,
                json!([{
                    "source": "manual_entry",
                    "reviewRequired": true,
                    "action": payload.action
                }])
                .to_string()
            ],
        )
        .map_err(|_| "Unable to save the planning review draft.".to_owned())?;
    Ok(PlanningDraftResponse {
        draft_id,
        action: payload.action,
        profile_id: payload.profile_id,
        name: payload.after.name,
        base_currency: payload.after.base_currency,
        cash_buffer_minor: payload.after.cash_buffer_minor,
        allocations: payload.after.allocations,
        notes: payload.after.notes,
        review_status: "needs_review",
    })
}

pub(crate) fn save_planning_draft_at(
    runtime: &VaultRuntime,
    request: SavePlanningDraftRequest,
) -> Result<PlanningDraftResponse, String> {
    runtime.with_unlocked_connection(|vault_id, connection| {
        let before = read_profile(connection, vault_id)?;
        let timestamp = now(connection)?;
        let profile_id = before
            .as_ref()
            .map(|profile| profile.id.clone())
            .unwrap_or(random_id("planning")?);
        let created_at = before
            .as_ref()
            .map(|profile| profile.created_at.clone())
            .unwrap_or_else(|| timestamp.clone());
        let base_currency: String = connection
            .query_row(
                "SELECT base_currency FROM vaults WHERE id = ?1",
                [vault_id],
                |row| row.get(0),
            )
            .map_err(|_| "Unable to read the planning base currency.".to_owned())?;
        let after = PlanningProfile {
            id: profile_id.clone(),
            name: required_text(request.name, "Planning profile name", 80)?,
            base_currency,
            cash_buffer_minor: parse_nonnegative_minor(request.cash_buffer)?,
            allocations: normalize_allocations(request.allocations)?,
            version_id: random_id("planning_version")?,
            notes: optional_text(request.notes, 1000)?,
            created_at,
            updated_at: timestamp,
        };
        save_draft(
            connection,
            vault_id,
            PlanningDraftPayload {
                kind: "planning.save".to_owned(),
                action: if before.is_some() { "update" } else { "create" }.to_owned(),
                profile_id,
                before,
                after,
            },
        )
    })
}

pub(crate) fn confirm_planning_draft_at(
    runtime: &VaultRuntime,
    request: ConfirmPlanningDraftRequest,
) -> Result<PlanningConfirmationResponse, String> {
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
                   AND source_type = 'manual_planning'",
                params![draft_id, vault_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| "Unable to read the planning review draft.".to_owned())?;
        let (status, proposed) =
            row.ok_or_else(|| "The planning review draft does not exist.".to_owned())?;
        let payload: PlanningDraftPayload = serde_json::from_str(&proposed)
            .map_err(|_| "The planning review draft is invalid.".to_owned())?;
        if status == "confirmed" {
            return Ok(PlanningConfirmationResponse {
                draft_id,
                profile_id: payload.profile_id,
                action: payload.action,
                status: "confirmed",
            });
        }
        if status != "needs_review" {
            return Err("Only a pending planning draft can be confirmed.".to_owned());
        }

        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "Unable to start the planning confirmation transaction.".to_owned())?;
        let current = read_profile(&transaction, vault_id)?;
        if current != payload.before {
            return Err(
                "The planning profile changed after review. Create a new review draft.".to_owned(),
            );
        }
        let allocations_json = serde_json::to_string(&payload.after.allocations)
            .map_err(|_| "Unable to serialize the planning targets.".to_owned())?;
        if payload.action == "create" {
            transaction
                .execute(
                    "INSERT INTO planning_profiles(
                        id, vault_id, name, base_currency, cash_buffer_minor,
                        allocations_json, version_id, notes, created_at, updated_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        payload.after.id,
                        vault_id,
                        payload.after.name,
                        payload.after.base_currency,
                        payload.after.cash_buffer_minor,
                        allocations_json,
                        payload.after.version_id,
                        payload.after.notes,
                        payload.after.created_at,
                        payload.after.updated_at
                    ],
                )
                .map_err(|_| "Unable to create the encrypted planning profile.".to_owned())?;
        } else if payload.action == "update" {
            let updated = transaction
                .execute(
                    "UPDATE planning_profiles
                     SET name = ?1, cash_buffer_minor = ?2, allocations_json = ?3,
                         version_id = ?4, notes = ?5, updated_at = ?6
                     WHERE id = ?7 AND vault_id = ?8 AND version_id = ?9",
                    params![
                        payload.after.name,
                        payload.after.cash_buffer_minor,
                        allocations_json,
                        payload.after.version_id,
                        payload.after.notes,
                        payload.after.updated_at,
                        payload.after.id,
                        vault_id,
                        payload.before.as_ref().map(|profile| &profile.version_id)
                    ],
                )
                .map_err(|_| "Unable to update the encrypted planning profile.".to_owned())?;
            if updated != 1 {
                return Err(
                    "The planning profile changed after review. Create a new review draft."
                        .to_owned(),
                );
            }
        } else {
            return Err("Planning draft action is not supported.".to_owned());
        }

        transaction
            .execute(
                "INSERT INTO planning_events(
                    id, vault_id, profile_id, draft_id, action,
                    before_json, after_json, occurred_at
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![
                    random_id("planning_event")?,
                    vault_id,
                    payload.profile_id,
                    draft_id,
                    if payload.action == "create" {
                        "created"
                    } else {
                        "updated"
                    },
                    payload
                        .before
                        .as_ref()
                        .map(serde_json::to_string)
                        .transpose()
                        .map_err(|_| "Unable to serialize prior planning state.".to_owned())?,
                    serde_json::to_string(&payload.after)
                        .map_err(|_| "Unable to serialize confirmed planning state.".to_owned())?
                ],
            )
            .map_err(|_| "Unable to append the planning history event.".to_owned())?;
        transaction
            .execute(
                "UPDATE draft_changes
                 SET status = 'confirmed',
                     confirmed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                     confirmed_by = 'local_user'
                 WHERE id = ?1 AND vault_id = ?2 AND status = 'needs_review'",
                params![draft_id, vault_id],
            )
            .map_err(|_| "Unable to confirm the planning review draft.".to_owned())?;
        transaction
            .execute(
                "INSERT INTO audit_events(
                    id, vault_id, category, action, actor_id,
                    object_type, object_id, metadata_json, occurred_at
                 ) VALUES (
                    ?1, ?2, 'data', ?3, 'local_user',
                    'planning_profile', ?4, ?5,
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![
                    random_id("audit")?,
                    vault_id,
                    format!("planning_{}", payload.action),
                    payload.profile_id,
                    json!({
                        "draftId": draft_id,
                        "versionId": payload.after.version_id
                    })
                    .to_string()
                ],
            )
            .map_err(|_| "Unable to append the planning audit event.".to_owned())?;
        transaction
            .commit()
            .map_err(|_| "Unable to commit the planning change.".to_owned())?;
        Ok(PlanningConfirmationResponse {
            draft_id,
            profile_id: payload.profile_id,
            action: payload.action,
            status: "confirmed",
        })
    })
}

fn reject_planning_draft_at(
    runtime: &VaultRuntime,
    request: RejectPlanningDraftRequest,
) -> Result<PlanningRejectionResponse, String> {
    let draft_id = required_text(request.draft_id, "Draft identifier", 96)?;
    runtime.with_unlocked_connection(|vault_id, connection| {
        let status: Option<String> = connection
            .query_row(
                "SELECT status FROM draft_changes
                 WHERE id = ?1 AND vault_id = ?2
                   AND source_type = 'manual_planning'",
                params![draft_id, vault_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| "Unable to read the planning review draft.".to_owned())?;
        let status =
            status.ok_or_else(|| "The planning review draft does not exist.".to_owned())?;
        if status == "rejected" {
            return Ok(PlanningRejectionResponse {
                draft_id,
                status: "rejected",
            });
        }
        if status != "needs_review" {
            return Err("Only a pending planning draft can be rejected.".to_owned());
        }
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "Unable to start the planning draft rejection.".to_owned())?;
        transaction
            .execute(
                "UPDATE draft_changes
                 SET status = 'rejected',
                     rejected_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                     rejection_reason = 'cancelled_by_user'
                 WHERE id = ?1 AND vault_id = ?2 AND status = 'needs_review'",
                params![draft_id, vault_id],
            )
            .map_err(|_| "Unable to reject the planning review draft.".to_owned())?;
        transaction
            .execute(
                "INSERT INTO audit_events(
                    id, vault_id, category, action, actor_id,
                    object_type, object_id, metadata_json, occurred_at
                 ) VALUES (
                    ?1, ?2, 'data', 'planning_draft_rejected', 'local_user',
                    'draft_change', ?3, '{}',
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )",
                params![random_id("audit")?, vault_id, draft_id],
            )
            .map_err(|_| "Unable to append the planning rejection audit.".to_owned())?;
        transaction
            .commit()
            .map_err(|_| "Unable to commit the planning draft rejection.".to_owned())?;
        Ok(PlanningRejectionResponse {
            draft_id,
            status: "rejected",
        })
    })
}

pub(crate) fn planning_snapshot(
    connection: &Connection,
    vault_id: &str,
) -> Result<Option<PlanningProfile>, String> {
    read_profile(connection, vault_id)
}

#[tauri::command]
pub fn planning_profile_save_draft(
    state: tauri::State<'_, VaultRuntime>,
    request: SavePlanningDraftRequest,
) -> Result<PlanningDraftResponse, String> {
    save_planning_draft_at(&state, request)
}

#[tauri::command]
pub fn planning_profile_confirm_draft(
    state: tauri::State<'_, VaultRuntime>,
    request: ConfirmPlanningDraftRequest,
) -> Result<PlanningConfirmationResponse, String> {
    confirm_planning_draft_at(&state, request)
}

#[tauri::command]
pub fn planning_profile_reject_draft(
    state: tauri::State<'_, VaultRuntime>,
    request: RejectPlanningDraftRequest,
) -> Result<PlanningRejectionResponse, String> {
    reject_planning_draft_at(&state, request)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime() -> VaultRuntime {
        let connection = Connection::open_in_memory().expect("database should open");
        connection
            .execute_batch(include_str!("../../db/schema.sql"))
            .expect("schema should apply");
        connection
            .execute(
                "INSERT INTO vaults(id, display_name, base_currency, created_at)
                 VALUES ('vault-1', 'Private', 'CNY', '2026-07-27T00:00:00.000Z')",
                [],
            )
            .expect("vault should insert");
        let runtime = VaultRuntime::default();
        runtime.install_test_session("vault-1", connection);
        runtime
    }

    fn request() -> SavePlanningDraftRequest {
        SavePlanningDraftRequest {
            name: "长期资产规划".to_owned(),
            cash_buffer: "80000".to_owned(),
            allocations: vec![
                PlanningAllocation {
                    category: "cash".to_owned(),
                    target_bps: 2000,
                },
                PlanningAllocation {
                    category: "stable".to_owned(),
                    target_bps: 3000,
                },
                PlanningAllocation {
                    category: "equity".to_owned(),
                    target_bps: 2000,
                },
                PlanningAllocation {
                    category: "gold".to_owned(),
                    target_bps: 1000,
                },
                PlanningAllocation {
                    category: "insurance".to_owned(),
                    target_bps: 1500,
                },
                PlanningAllocation {
                    category: "other".to_owned(),
                    target_bps: 500,
                },
            ],
            notes: Some("仅作为规划目标".to_owned()),
        }
    }

    #[test]
    fn planning_requires_complete_exact_allocation() {
        let runtime = runtime();
        let mut invalid = request();
        invalid.allocations[0].target_bps = 1900;
        assert!(save_planning_draft_at(&runtime, invalid).is_err());
        runtime
            .with_unlocked_connection(|vault_id, connection| {
                assert!(planning_snapshot(connection, vault_id)?.is_none());
                Ok(())
            })
            .expect("snapshot should read");
    }

    #[test]
    fn planning_only_changes_after_explicit_confirmation() {
        let runtime = runtime();
        let draft = save_planning_draft_at(&runtime, request()).expect("draft should save");
        assert_eq!(draft.review_status, "needs_review");
        assert!(confirm_planning_draft_at(
            &runtime,
            ConfirmPlanningDraftRequest {
                draft_id: draft.draft_id.clone(),
                confirmed_by_user: false,
            }
        )
        .is_err());
        let result = confirm_planning_draft_at(
            &runtime,
            ConfirmPlanningDraftRequest {
                draft_id: draft.draft_id,
                confirmed_by_user: true,
            },
        )
        .expect("draft should confirm");
        assert_eq!(result.status, "confirmed");
        runtime
            .with_unlocked_connection(|vault_id, connection| {
                let profile = planning_snapshot(connection, vault_id)?.expect("profile");
                assert_eq!(profile.cash_buffer_minor, 8_000_000);
                let event_count: i64 = connection
                    .query_row("SELECT count(*) FROM planning_events", [], |row| row.get(0))
                    .expect("events should count");
                assert_eq!(event_count, 1);
                Ok(())
            })
            .expect("snapshot should read");
    }

    #[test]
    fn stale_planning_draft_is_rejected() {
        let runtime = runtime();
        let first = save_planning_draft_at(&runtime, request()).expect("draft");
        confirm_planning_draft_at(
            &runtime,
            ConfirmPlanningDraftRequest {
                draft_id: first.draft_id,
                confirmed_by_user: true,
            },
        )
        .expect("first confirm");
        let draft_a = save_planning_draft_at(&runtime, request()).expect("draft a");
        let mut changed = request();
        changed.cash_buffer = "90000".to_owned();
        let draft_b = save_planning_draft_at(&runtime, changed).expect("draft b");
        confirm_planning_draft_at(
            &runtime,
            ConfirmPlanningDraftRequest {
                draft_id: draft_b.draft_id,
                confirmed_by_user: true,
            },
        )
        .expect("draft b confirm");
        assert!(confirm_planning_draft_at(
            &runtime,
            ConfirmPlanningDraftRequest {
                draft_id: draft_a.draft_id,
                confirmed_by_user: true,
            }
        )
        .is_err());
    }
}
