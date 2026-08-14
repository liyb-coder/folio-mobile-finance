use crate::{
    database::cipher_integrity_check,
    vault::{vault_root, verify_vault_password_at, VaultRuntime},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{Cursor, Write},
    path::{Path, PathBuf},
};
use tauri_plugin_dialog::DialogExt;
use zeroize::Zeroizing;
use zip::{write::SimpleFileOptions, ZipWriter};

const EXPORT_FORMAT_VERSION: u8 = 1;
const MAX_EXPORT_BYTES: usize = 128 * 1024 * 1024;
const MAX_MARKDOWN_EXPORT_BYTES: usize = 5 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMarkdownExportRequest {
    content: String,
    file_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMarkdownExportResponse {
    status: &'static str,
    file_name: Option<String>,
    byte_count: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDataExportRequest {
    current_password: String,
    include_audit_log: bool,
    confirmed_by_user: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDataExportResponse {
    status: &'static str,
    file_name: Option<String>,
    byte_count: Option<usize>,
    exported_at: Option<String>,
    fingerprint: Option<String>,
    account_count: Option<i64>,
    holding_count: Option<i64>,
    holding_valuation_count: Option<i64>,
    holding_operation_count: Option<i64>,
    ledger_event_count: Option<i64>,
    reminder_count: Option<i64>,
    audit_event_count: Option<i64>,
}

struct ExportArtifact {
    bytes: Zeroizing<Vec<u8>>,
    exported_at: String,
    fingerprint: String,
    account_count: i64,
    holding_count: i64,
    holding_valuation_count: i64,
    holding_operation_count: i64,
    ledger_event_count: i64,
    reminder_count: i64,
    audit_event_count: i64,
}

fn random_suffix() -> Result<String, String> {
    let mut bytes = [0_u8; 12];
    getrandom::fill(&mut bytes)
        .map_err(|_| "Unable to create a secure export file identifier.".to_owned())?;
    Ok(hex::encode(bytes))
}

fn csv_text(value: Option<String>) -> String {
    let mut value = value.unwrap_or_default().replace('\0', "");
    if value
        .chars()
        .next()
        .is_some_and(|character| matches!(character, '=' | '+' | '-' | '@'))
    {
        value.insert(0, '\'');
    }
    value
}

fn minor_decimal(value: i64) -> String {
    let value = i128::from(value);
    let sign = if value < 0 { "-" } else { "" };
    let absolute = value.abs();
    format!("{sign}{}.{:02}", absolute / 100, absolute % 100)
}

fn csv_bytes(headers: &[&str], rows: Vec<Vec<String>>) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"\xEF\xBB\xBF");
    {
        let mut writer = csv::WriterBuilder::new()
            .has_headers(false)
            .from_writer(&mut bytes);
        writer
            .write_record(headers)
            .map_err(|_| "Unable to write export CSV headers.".to_owned())?;
        for row in rows {
            writer
                .write_record(row)
                .map_err(|_| "Unable to write export CSV data.".to_owned())?;
        }
        writer
            .flush()
            .map_err(|_| "Unable to finalize export CSV data.".to_owned())?;
    }
    Ok(bytes)
}

fn add_archive_file(
    archive: &mut ZipWriter<Cursor<Vec<u8>>>,
    name: &str,
    bytes: &[u8],
) -> Result<(), String> {
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o600);
    archive
        .start_file(name, options)
        .map_err(|_| "Unable to create a data export entry.".to_owned())?;
    archive
        .write_all(bytes)
        .map_err(|_| "Unable to write a data export entry.".to_owned())
}

fn query_rows(
    connection: &Connection,
    sql: &str,
    vault_id: &str,
    map: impl Fn(&rusqlite::Row<'_>) -> rusqlite::Result<Vec<String>>,
) -> Result<Vec<Vec<String>>, String> {
    let mut statement = connection
        .prepare(sql)
        .map_err(|_| "Unable to prepare encrypted data for export.".to_owned())?;
    let rows = statement
        .query_map([vault_id], map)
        .map_err(|_| "Unable to read encrypted data for export.".to_owned())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Unable to decode encrypted data for export.".to_owned())
}

fn build_export_archive(
    connection: &Connection,
    vault_id: &str,
    include_audit_log: bool,
) -> Result<ExportArtifact, String> {
    cipher_integrity_check(connection)?;
    let (display_name, base_currency): (String, String) = connection
        .query_row(
            "SELECT display_name, base_currency FROM vaults WHERE id = ?1",
            [vault_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| "Unable to read the encrypted vault for export.".to_owned())?;
    let exported_at: String = connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get(0)
        })
        .map_err(|_| "Unable to create an export timestamp.".to_owned())?;

    let account_rows = query_rows(
        connection,
        "SELECT
            id, institution_name, display_name, account_type, currency,
            masked_identifier, notes, created_at, archived_at
         FROM accounts WHERE vault_id = ?1 ORDER BY created_at, id",
        vault_id,
        |row| {
            Ok(vec![
                row.get(0)?,
                csv_text(row.get(1)?),
                csv_text(row.get(2)?),
                row.get(3)?,
                row.get(4)?,
                csv_text(row.get(5)?),
                csv_text(row.get(6)?),
                row.get(7)?,
                row.get::<_, Option<String>>(8)?.unwrap_or_default(),
            ])
        },
    )?;
    let account_count = account_rows.len() as i64;

    let holding_rows = query_rows(
        connection,
        "SELECT
            h.id, h.account_id, a.display_name, h.name, h.product_type,
            h.currency, h.masked_identifier, h.notes, h.created_at, h.archived_at
         FROM holdings h
         JOIN accounts a ON a.id = h.account_id AND a.vault_id = h.vault_id
         WHERE h.vault_id = ?1
         ORDER BY h.created_at, h.id",
        vault_id,
        |row| {
            Ok(vec![
                row.get(0)?,
                row.get(1)?,
                csv_text(row.get(2)?),
                csv_text(row.get(3)?),
                row.get(4)?,
                row.get(5)?,
                csv_text(row.get(6)?),
                csv_text(row.get(7)?),
                row.get(8)?,
                row.get::<_, Option<String>>(9)?.unwrap_or_default(),
            ])
        },
    )?;
    let holding_count = holding_rows.len() as i64;

    let holding_valuation_rows = query_rows(
        connection,
        "SELECT
            v.id, v.holding_id, h.name, v.draft_id, v.units_micros,
            v.cost_basis_minor, v.market_value_minor, v.as_of_date,
            v.source_type, v.created_at
         FROM holding_valuations v
         JOIN holdings h ON h.id = v.holding_id AND h.vault_id = v.vault_id
         WHERE v.vault_id = ?1
         ORDER BY v.as_of_date, v.created_at, v.id",
        vault_id,
        |row| {
            let cost_basis_minor: i64 = row.get(5)?;
            let market_value_minor: i64 = row.get(6)?;
            Ok(vec![
                row.get(0)?,
                row.get(1)?,
                csv_text(row.get(2)?),
                row.get(3)?,
                row.get::<_, i64>(4)?.to_string(),
                cost_basis_minor.to_string(),
                minor_decimal(cost_basis_minor),
                market_value_minor.to_string(),
                minor_decimal(market_value_minor),
                row.get(7)?,
                row.get(8)?,
                row.get(9)?,
            ])
        },
    )?;
    let holding_valuation_count = holding_valuation_rows.len() as i64;

    let holding_operation_rows = query_rows(
        connection,
        "SELECT
            o.id, o.holding_id, h.name, o.operation_kind, o.amount_minor,
            o.currency, o.units_delta_micros, o.before_valuation_id,
            o.after_valuation_id, o.settlement_account_id, a.display_name,
            o.ledger_link_id, o.primary_ledger_event_id,
            o.secondary_ledger_event_id, o.occurred_on, o.description,
            o.notes, o.created_at,
            original_correction.compensating_operation_id,
            reversal_correction.original_operation_id,
            COALESCE(original_correction.reason, reversal_correction.reason)
         FROM holding_operations o
         JOIN holdings h ON h.id = o.holding_id AND h.vault_id = o.vault_id
         LEFT JOIN accounts a
           ON a.id = o.settlement_account_id AND a.vault_id = o.vault_id
         LEFT JOIN holding_operation_corrections original_correction
           ON original_correction.original_operation_id = o.id
          AND original_correction.vault_id = o.vault_id
         LEFT JOIN holding_operation_corrections reversal_correction
           ON reversal_correction.compensating_operation_id = o.id
          AND reversal_correction.vault_id = o.vault_id
         WHERE o.vault_id = ?1
         ORDER BY o.occurred_on, o.created_at, o.id",
        vault_id,
        |row| {
            let amount_minor: i64 = row.get(4)?;
            Ok(vec![
                row.get(0)?,
                row.get(1)?,
                csv_text(row.get(2)?),
                row.get(3)?,
                amount_minor.to_string(),
                minor_decimal(amount_minor),
                row.get(5)?,
                row.get::<_, i64>(6)?.to_string(),
                row.get(7)?,
                row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                row.get::<_, Option<String>>(9)?.unwrap_or_default(),
                csv_text(row.get(10)?),
                row.get::<_, Option<String>>(11)?.unwrap_or_default(),
                row.get::<_, Option<String>>(12)?.unwrap_or_default(),
                row.get::<_, Option<String>>(13)?.unwrap_or_default(),
                row.get(14)?,
                csv_text(row.get(15)?),
                csv_text(row.get(16)?),
                row.get(17)?,
                row.get::<_, Option<String>>(18)?.unwrap_or_default(),
                row.get::<_, Option<String>>(19)?.unwrap_or_default(),
                csv_text(row.get(20)?),
            ])
        },
    )?;
    let holding_operation_count = holding_operation_rows.len() as i64;

    let ledger_rows = query_rows(
        connection,
        "SELECT
            e.id, e.account_id, a.display_name, e.event_type, e.delta_minor,
            e.currency, e.occurred_at, e.status, e.idempotency_key, e.link_id,
            e.reverses_event_id, e.metadata_json, e.created_at
         FROM ledger_events e
         JOIN accounts a ON a.id = e.account_id AND a.vault_id = e.vault_id
         WHERE e.vault_id = ?1
         ORDER BY e.occurred_at, e.id",
        vault_id,
        |row| {
            let delta_minor: i64 = row.get(4)?;
            Ok(vec![
                row.get(0)?,
                row.get(1)?,
                csv_text(row.get(2)?),
                row.get(3)?,
                delta_minor.to_string(),
                minor_decimal(delta_minor),
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
                row.get::<_, Option<String>>(9)?.unwrap_or_default(),
                row.get::<_, Option<String>>(10)?.unwrap_or_default(),
                row.get(11)?,
                row.get(12)?,
            ])
        },
    )?;
    let ledger_event_count = ledger_rows.len() as i64;

    let reminder_rows = query_rows(
        connection,
        "SELECT
            r.id, r.title, r.category, r.linked_account_id, a.display_name,
            r.amount_minor, r.currency, r.due_at, r.advance_seconds,
            r.recurrence_rule, r.recurrence_anchor_month,
            r.recurrence_anchor_day, r.status, r.notes, r.created_at,
            r.updated_at, r.archived_at
         FROM reminders r
         LEFT JOIN accounts a
           ON a.id = r.linked_account_id AND a.vault_id = r.vault_id
         WHERE r.vault_id = ?1
         ORDER BY r.due_at, r.id",
        vault_id,
        |row| {
            let amount_minor: Option<i64> = row.get(5)?;
            Ok(vec![
                row.get(0)?,
                csv_text(row.get(1)?),
                row.get(2)?,
                row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                csv_text(row.get(4)?),
                amount_minor
                    .map(|value| value.to_string())
                    .unwrap_or_default(),
                amount_minor.map(minor_decimal).unwrap_or_default(),
                row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                row.get(7)?,
                row.get::<_, i64>(8)?.to_string(),
                row.get::<_, Option<String>>(9)?.unwrap_or_default(),
                row.get::<_, Option<i64>>(10)?
                    .map(|value| value.to_string())
                    .unwrap_or_default(),
                row.get::<_, Option<i64>>(11)?
                    .map(|value| value.to_string())
                    .unwrap_or_default(),
                row.get(12)?,
                csv_text(row.get(13)?),
                row.get(14)?,
                row.get(15)?,
                row.get::<_, Option<String>>(16)?.unwrap_or_default(),
            ])
        },
    )?;
    let reminder_count = reminder_rows.len() as i64;
    let reminder_occurrence_rows = query_rows(
        connection,
        "SELECT
            occurrence.id, occurrence.reminder_id, occurrence.due_on,
            occurrence.completed_at, occurrence.next_due_on,
            occurrence.confirmation_draft_id, occurrence.created_at
         FROM reminder_occurrences occurrence
         JOIN reminders reminder ON reminder.id = occurrence.reminder_id
         WHERE reminder.vault_id = ?1
         ORDER BY occurrence.due_on, occurrence.id",
        vault_id,
        |row| {
            Ok(vec![
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                row.get(5)?,
                row.get(6)?,
            ])
        },
    )?;
    let reminder_occurrence_count = reminder_occurrence_rows.len() as i64;

    let import_rows = query_rows(
        connection,
        "SELECT
            id, source_type, source_name, source_fingerprint, parser_version,
            status, row_count, error_count, created_at, confirmed_at
         FROM import_batches WHERE vault_id = ?1 ORDER BY created_at, id",
        vault_id,
        |row| {
            Ok(vec![
                row.get(0)?,
                row.get(1)?,
                csv_text(row.get(2)?),
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get::<_, i64>(6)?.to_string(),
                row.get::<_, i64>(7)?.to_string(),
                row.get(8)?,
                row.get::<_, Option<String>>(9)?.unwrap_or_default(),
            ])
        },
    )?;

    let planning: Option<(String, String, i64, String, Option<String>, String, String)> =
        connection
            .query_row(
                "SELECT
                id, name, cash_buffer_minor, allocations_json, notes,
                created_at, updated_at
             FROM planning_profiles WHERE vault_id = ?1",
                [vault_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| "Unable to read the encrypted planning profile for export.".to_owned())?;
    let mut planning_rows = Vec::new();
    if let Some((id, name, cash_buffer_minor, allocations_json, notes, created_at, updated_at)) =
        planning
    {
        let allocations: Vec<serde_json::Value> = serde_json::from_str(&allocations_json)
            .map_err(|_| "Encrypted planning allocations are invalid.".to_owned())?;
        for allocation in allocations {
            planning_rows.push(vec![
                id.clone(),
                csv_text(Some(name.clone())),
                base_currency.clone(),
                cash_buffer_minor.to_string(),
                minor_decimal(cash_buffer_minor),
                allocation
                    .get("category")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                allocation
                    .get("targetBps")
                    .and_then(serde_json::Value::as_i64)
                    .unwrap_or_default()
                    .to_string(),
                csv_text(notes.clone()),
                created_at.clone(),
                updated_at.clone(),
            ]);
        }
    }

    let audit_rows = if include_audit_log {
        query_rows(
            connection,
            "SELECT
                id, category, action, actor_id, object_type, object_id,
                metadata_json, occurred_at
             FROM audit_events
             WHERE vault_id = ?1
             ORDER BY occurred_at, id",
            vault_id,
            |row| {
                Ok(vec![
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    csv_text(row.get(3)?),
                    row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                    row.get(6)?,
                    row.get(7)?,
                ])
            },
        )?
    } else {
        Vec::new()
    };
    let audit_event_count = audit_rows.len() as i64;

    let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
    add_archive_file(
        &mut archive,
        "accounts.csv",
        &csv_bytes(
            &[
                "account_id",
                "institution_name",
                "display_name",
                "account_type",
                "currency",
                "masked_identifier",
                "notes",
                "created_at",
                "archived_at",
            ],
            account_rows,
        )?,
    )?;
    add_archive_file(
        &mut archive,
        "holdings.csv",
        &csv_bytes(
            &[
                "holding_id",
                "account_id",
                "account_name",
                "name",
                "product_type",
                "currency",
                "masked_identifier",
                "notes",
                "created_at",
                "archived_at",
            ],
            holding_rows,
        )?,
    )?;
    add_archive_file(
        &mut archive,
        "holding_valuations.csv",
        &csv_bytes(
            &[
                "valuation_id",
                "holding_id",
                "holding_name",
                "draft_id",
                "units_micros",
                "cost_basis_minor",
                "cost_basis_decimal",
                "market_value_minor",
                "market_value_decimal",
                "as_of_date",
                "source_type",
                "created_at",
            ],
            holding_valuation_rows,
        )?,
    )?;
    add_archive_file(
        &mut archive,
        "holding_operations.csv",
        &csv_bytes(
            &[
                "operation_id",
                "holding_id",
                "holding_name",
                "operation_kind",
                "amount_minor",
                "amount_decimal",
                "currency",
                "units_delta_micros",
                "before_valuation_id",
                "after_valuation_id",
                "settlement_account_id",
                "settlement_account_name",
                "ledger_link_id",
                "primary_ledger_event_id",
                "secondary_ledger_event_id",
                "occurred_on",
                "description",
                "notes",
                "created_at",
                "reversed_by_operation_id",
                "reverses_operation_id",
                "correction_reason",
            ],
            holding_operation_rows,
        )?,
    )?;
    add_archive_file(
        &mut archive,
        "ledger_events.csv",
        &csv_bytes(
            &[
                "event_id",
                "account_id",
                "account_name",
                "event_type",
                "delta_minor",
                "amount_decimal",
                "currency",
                "occurred_at",
                "status",
                "idempotency_key",
                "link_id",
                "reverses_event_id",
                "metadata_json",
                "created_at",
            ],
            ledger_rows,
        )?,
    )?;
    add_archive_file(
        &mut archive,
        "reminders.csv",
        &csv_bytes(
            &[
                "reminder_id",
                "title",
                "category",
                "linked_account_id",
                "linked_account_name",
                "amount_minor",
                "amount_decimal",
                "currency",
                "due_on",
                "advance_seconds",
                "recurrence_rule",
                "recurrence_anchor_month",
                "recurrence_anchor_day",
                "status",
                "notes",
                "created_at",
                "updated_at",
                "archived_at",
            ],
            reminder_rows,
        )?,
    )?;
    add_archive_file(
        &mut archive,
        "reminder_occurrences.csv",
        &csv_bytes(
            &[
                "occurrence_id",
                "reminder_id",
                "due_on",
                "completed_at",
                "next_due_on",
                "confirmation_draft_id",
                "created_at",
            ],
            reminder_occurrence_rows,
        )?,
    )?;
    add_archive_file(
        &mut archive,
        "planning.csv",
        &csv_bytes(
            &[
                "profile_id",
                "name",
                "base_currency",
                "cash_buffer_minor",
                "cash_buffer_decimal",
                "allocation_category",
                "target_bps",
                "notes",
                "created_at",
                "updated_at",
            ],
            planning_rows,
        )?,
    )?;
    add_archive_file(
        &mut archive,
        "imports.csv",
        &csv_bytes(
            &[
                "import_batch_id",
                "source_type",
                "source_name",
                "source_fingerprint",
                "parser_version",
                "status",
                "row_count",
                "error_count",
                "created_at",
                "confirmed_at",
            ],
            import_rows,
        )?,
    )?;
    if include_audit_log {
        add_archive_file(
            &mut archive,
            "audit_events.csv",
            &csv_bytes(
                &[
                    "audit_event_id",
                    "category",
                    "action",
                    "actor_id",
                    "object_type",
                    "object_id",
                    "metadata_json",
                    "occurred_at",
                ],
                audit_rows,
            )?,
        )?;
    }
    let manifest = serde_json::to_vec_pretty(&json!({
        "format": "folio-portable-data-export",
        "formatVersion": EXPORT_FORMAT_VERSION,
        "exportedAt": exported_at,
        "vaultDisplayName": csv_text(Some(display_name)),
        "baseCurrency": base_currency,
        "plaintextWarning": "This archive contains plaintext financial data. Store it securely.",
        "includesAuditLog": include_audit_log,
        "counts": {
            "accounts": account_count,
            "holdings": holding_count,
            "holdingValuations": holding_valuation_count,
            "holdingOperations": holding_operation_count,
            "ledgerEvents": ledger_event_count,
            "reminders": reminder_count,
            "reminderOccurrences": reminder_occurrence_count,
            "auditEvents": audit_event_count
        }
    }))
    .map_err(|_| "Unable to serialize the data export manifest.".to_owned())?;
    add_archive_file(&mut archive, "manifest.json", &manifest)?;
    let cursor = archive
        .finish()
        .map_err(|_| "Unable to finalize the portable data export.".to_owned())?;
    let bytes = Zeroizing::new(cursor.into_inner());
    if bytes.is_empty() || bytes.len() > MAX_EXPORT_BYTES {
        return Err("Portable data export exceeds the supported size.".to_owned());
    }
    let fingerprint = hex::encode(Sha256::digest(bytes.as_slice()));
    Ok(ExportArtifact {
        bytes,
        exported_at,
        fingerprint,
        account_count,
        holding_count,
        holding_valuation_count,
        holding_operation_count,
        ledger_event_count,
        reminder_count,
        audit_event_count,
    })
}

fn write_export_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if path.exists() {
        return Err("A file already exists at the selected destination.".to_owned());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "Selected export destination is invalid.".to_owned())?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Selected export destination is invalid.".to_owned())?;
    let temporary = parent.join(format!(".{file_name}.{}.tmp", random_suffix()?));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|_| "Unable to create the portable data export.".to_owned())?;
        file.write_all(bytes)
            .map_err(|_| "Unable to write the portable data export.".to_owned())?;
        file.sync_all()
            .map_err(|_| "Unable to finalize the portable data export.".to_owned())?;
        drop(file);
        fs::rename(&temporary, path)
            .map_err(|_| "Unable to install the portable data export.".to_owned())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn ensure_export_extension(mut path: PathBuf) -> PathBuf {
    if path.extension().and_then(|value| value.to_str()) != Some("zip") {
        path.set_extension("zip");
    }
    path
}

fn append_export_audit(
    connection: &Connection,
    vault_id: &str,
    artifact: &ExportArtifact,
    include_audit_log: bool,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO audit_events(
                id, vault_id, category, action, actor_id, object_type,
                object_id, metadata_json, occurred_at
             ) VALUES (
                ?1, ?2, 'export', 'plaintext_portable_exported', 'local_user',
                'vault', ?2, ?3,
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )",
            params![
                format!("audit_{}", random_suffix()?),
                vault_id,
                json!({
                    "fingerprint": artifact.fingerprint,
                    "byteCount": artifact.bytes.len(),
                    "includesAuditLog": include_audit_log,
                    "accountCount": artifact.account_count,
                    "holdingCount": artifact.holding_count,
                    "holdingValuationCount": artifact.holding_valuation_count,
                    "holdingOperationCount": artifact.holding_operation_count,
                    "ledgerEventCount": artifact.ledger_event_count,
                    "reminderCount": artifact.reminder_count
                })
                .to_string()
            ],
        )
        .map_err(|_| "Unable to record the portable data export audit.".to_owned())?;
    Ok(())
}

fn create_export_at(
    runtime: &VaultRuntime,
    root: &Path,
    path: &Path,
    mut request: CreateDataExportRequest,
) -> Result<CreateDataExportResponse, String> {
    if !request.confirmed_by_user {
        return Err("Portable data export requires explicit confirmation.".to_owned());
    }
    let current_password = Zeroizing::new(std::mem::take(&mut request.current_password));
    runtime.with_unlocked_connection(|vault_id, connection| {
        verify_vault_password_at(root, vault_id, current_password.as_str())?;
        let artifact = build_export_archive(connection, vault_id, request.include_audit_log)?;
        write_export_atomically(path, artifact.bytes.as_slice())?;
        append_export_audit(connection, vault_id, &artifact, request.include_audit_log)?;
        Ok(CreateDataExportResponse {
            status: "exported",
            file_name: path
                .file_name()
                .and_then(|value| value.to_str())
                .map(str::to_owned),
            byte_count: Some(artifact.bytes.len()),
            exported_at: Some(artifact.exported_at),
            fingerprint: Some(artifact.fingerprint),
            account_count: Some(artifact.account_count),
            holding_count: Some(artifact.holding_count),
            holding_valuation_count: Some(artifact.holding_valuation_count),
            holding_operation_count: Some(artifact.holding_operation_count),
            ledger_event_count: Some(artifact.ledger_event_count),
            reminder_count: Some(artifact.reminder_count),
            audit_event_count: Some(artifact.audit_event_count),
        })
    })
}

#[tauri::command]
pub async fn vault_data_export_create(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, VaultRuntime>,
    request: CreateDataExportRequest,
) -> Result<CreateDataExportResponse, String> {
    if !request.confirmed_by_user {
        return Err("Portable data export requires explicit confirmation.".to_owned());
    }
    let selected = app
        .dialog()
        .file()
        .add_filter("Folio portable data export", &["zip"])
        .set_file_name("Folio-portable-data.folio-export.zip")
        .blocking_save_file();
    let Some(selected) = selected else {
        return Ok(CreateDataExportResponse {
            status: "cancelled",
            file_name: None,
            byte_count: None,
            exported_at: None,
            fingerprint: None,
            account_count: None,
            holding_count: None,
            holding_valuation_count: None,
            holding_operation_count: None,
            ledger_event_count: None,
            reminder_count: None,
            audit_event_count: None,
        });
    };
    let path = ensure_export_extension(
        selected
            .into_path()
            .map_err(|_| "Selected export destination is not a local file path.".to_owned())?,
    );
    let root = vault_root(&app)?;
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || create_export_at(&runtime, &root, &path, request))
        .await
        .map_err(|_| "Portable data export task failed.".to_owned())?
}

#[tauri::command]
pub async fn markdown_export_save(
    app: tauri::AppHandle,
    request: SaveMarkdownExportRequest,
) -> Result<SaveMarkdownExportResponse, String> {
    let bytes = request.content.as_bytes();
    if bytes.is_empty() || bytes.len() > MAX_MARKDOWN_EXPORT_BYTES {
        return Err("Markdown export must contain between 1 byte and 5 MiB.".to_owned());
    }
    if request.content.contains('\0') {
        return Err("Markdown export contains unsupported null bytes.".to_owned());
    }
    let suggested_name = if request.file_name.to_ascii_lowercase().ends_with(".md") {
        request.file_name
    } else {
        format!("{}.md", request.file_name)
    };
    let selected = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md"])
        .set_file_name(suggested_name)
        .blocking_save_file();
    let Some(selected) = selected else {
        return Ok(SaveMarkdownExportResponse {
            status: "cancelled",
            file_name: None,
            byte_count: None,
        });
    };
    let mut path = selected
        .into_path()
        .map_err(|_| "Selected Markdown destination is not a local file path.".to_owned())?;
    if path.extension().and_then(|value| value.to_str()) != Some("md") {
        path.set_extension("md");
    }
    fs::write(&path, bytes).map_err(|_| "Unable to save the Markdown export.".to_owned())?;
    Ok(SaveMarkdownExportResponse {
        status: "exported",
        file_name: path.file_name().and_then(|value| value.to_str()).map(str::to_owned),
        byte_count: Some(bytes.len()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().expect("database should open");
        connection
            .execute_batch(include_str!("../../db/schema.sql"))
            .expect("schema should apply");
        connection
            .execute_batch(
                "
                INSERT INTO vaults(id, display_name, base_currency, created_at)
                VALUES ('vault-1', 'Private', 'CNY', '2026-07-27T00:00:00.000Z');
                INSERT INTO accounts(
                  id, vault_id, institution_name, display_name, account_type,
                  currency, notes, created_at
                ) VALUES (
                  'account-1', 'vault-1', '=FORMULA', '工资账户', 'cash',
                  'CNY', '+sensitive', '2026-07-27T00:00:00.000Z'
                );
                INSERT INTO ledger_events(
                  id, vault_id, account_id, event_type, delta_minor, currency,
                  occurred_at, status, idempotency_key, metadata_json, created_at
                ) VALUES (
                  'event-1', 'vault-1', 'account-1', 'income', 12345, 'CNY',
                  '2026-07-27T00:00:00.000Z', 'confirmed', 'export-test:1',
                  '{}', '2026-07-27T00:00:00.000Z'
                );
                INSERT INTO draft_changes(
                  id, vault_id, source_type, status, proposed_events_json,
                  evidence_json, created_at, confirmed_at, confirmed_by
                ) VALUES (
                  'draft-holding', 'vault-1', 'manual_holding', 'confirmed',
                  '{\"kind\":\"holding.create\"}', '[]',
                  '2026-07-27T00:00:00.000Z',
                  '2026-07-27T00:00:00.000Z', 'local_user'
                );
                INSERT INTO holdings(
                  id, vault_id, account_id, name, product_type, currency,
                  masked_identifier, notes, created_at
                ) VALUES (
                  'holding-1', 'vault-1', 'account-1', '=HOLDING',
                  'fund', 'CNY', 'FUND-1028', '+private holding',
                  '2026-07-27T00:00:00.000Z'
                );
                INSERT INTO holding_valuations(
                  id, vault_id, holding_id, draft_id, units_micros,
                  cost_basis_minor, market_value_minor, as_of_date,
                  source_type, created_at
                ) VALUES (
                  'valuation-1', 'vault-1', 'holding-1', 'draft-holding',
                  1234567890, 5000000, 5188032, '2026-07-27',
                  'manual', '2026-07-27T00:00:00.000Z'
                );
                INSERT INTO holding_operations(
                  id, vault_id, holding_id, draft_id, operation_kind,
                  amount_minor, currency, units_delta_micros,
                  before_valuation_id, primary_ledger_event_id,
                  occurred_on, description, notes, created_at
                ) VALUES (
                  'holding-operation-1', 'vault-1', 'holding-1', 'draft-holding',
                  'dividend', 12345, 'CNY', 0, 'valuation-1', 'event-1',
                  '2026-07-27', '=DIVIDEND', '+operation note',
                  '2026-07-27T00:00:00.000Z'
                );
                INSERT INTO draft_changes(
                  id, vault_id, source_type, status, proposed_events_json,
                  evidence_json, created_at, confirmed_at, confirmed_by
                ) VALUES (
                  'draft-holding-correction', 'vault-1',
                  'holding_operation_correction', 'confirmed',
                  '{\"kind\":\"holding_operation.correction\"}', '[]',
                  '2026-07-27T01:00:00.000Z',
                  '2026-07-27T01:00:00.000Z', 'local_user'
                );
                INSERT INTO holding_operations(
                  id, vault_id, holding_id, draft_id, operation_kind,
                  amount_minor, currency, units_delta_micros,
                  before_valuation_id, primary_ledger_event_id,
                  occurred_on, description, notes, created_at
                ) VALUES (
                  'holding-operation-2', 'vault-1', 'holding-1',
                  'draft-holding-correction', 'fee', 12345, 'CNY', 0,
                  'valuation-1', NULL, '2026-07-27', '冲销分红', NULL,
                  '2026-07-27T01:00:00.000Z'
                );
                INSERT INTO holding_operation_corrections(
                  id, vault_id, draft_id, original_operation_id,
                  compensating_operation_id, reason, created_at
                ) VALUES (
                  'holding-correction-1', 'vault-1',
                  'draft-holding-correction', 'holding-operation-1',
                  'holding-operation-2', '重复分红',
                  '2026-07-27T01:00:00.000Z'
                );
                INSERT INTO reminders(
                  id, vault_id, category, title, due_at, recurrence_rule,
                  recurrence_anchor_month, recurrence_anchor_day, status,
                  created_at, updated_at
                ) VALUES (
                  'reminder-1', 'vault-1', 'insurance', '保险复核',
                  '2027-08-02', 'yearly', 8, 2, 'active',
                  '2026-07-27T00:00:00.000Z', '2026-07-27T00:00:00.000Z'
                );
                INSERT INTO reminder_occurrences(
                  id, reminder_id, due_on, completed_at, next_due_on,
                  confirmation_draft_id, created_at
                ) VALUES (
                  'occurrence-1', 'reminder-1', '2026-08-02',
                  '2026-07-27T00:00:00.000Z', '2027-08-02',
                  'draft-1', '2026-07-27T00:00:00.000Z'
                );
                ",
            )
            .expect("fixtures should insert");
        connection
    }

    #[test]
    fn portable_export_contains_standard_csv_and_sanitizes_formula_cells() {
        let connection = connection();
        let artifact =
            build_export_archive(&connection, "vault-1", true).expect("archive should build");
        let cursor = Cursor::new(artifact.bytes.to_vec());
        let mut archive = zip::ZipArchive::new(cursor).expect("archive should open");
        for name in [
            "accounts.csv",
            "holdings.csv",
            "holding_valuations.csv",
            "holding_operations.csv",
            "ledger_events.csv",
            "reminders.csv",
            "reminder_occurrences.csv",
            "planning.csv",
            "imports.csv",
            "audit_events.csv",
            "manifest.json",
        ] {
            assert!(archive.by_name(name).is_ok(), "{name} should exist");
        }
        let mut accounts = String::new();
        archive
            .by_name("accounts.csv")
            .expect("accounts should exist")
            .read_to_string(&mut accounts)
            .expect("accounts should read");
        assert!(accounts.contains("'=FORMULA"));
        assert!(accounts.contains("'+sensitive"));
        let mut holdings = String::new();
        archive
            .by_name("holdings.csv")
            .expect("holdings should exist")
            .read_to_string(&mut holdings)
            .expect("holdings should read");
        assert!(holdings.contains("'=HOLDING"));
        assert!(holdings.contains("'+private holding"));
        let mut valuations = String::new();
        archive
            .by_name("holding_valuations.csv")
            .expect("holding valuations should exist")
            .read_to_string(&mut valuations)
            .expect("holding valuations should read");
        assert!(valuations.contains("1234567890,5000000,50000.00,5188032,51880.32"));
        let mut operations = String::new();
        archive
            .by_name("holding_operations.csv")
            .expect("holding operations should exist")
            .read_to_string(&mut operations)
            .expect("holding operations should read");
        assert!(operations.contains("dividend,12345,123.45,CNY"));
        assert!(operations.contains("'=DIVIDEND"));
        assert!(operations.contains("'+operation note"));
        assert!(operations.contains("holding-operation-2"));
        assert!(operations.contains("holding-operation-1"));
        assert!(operations.contains("重复分红"));
        let mut ledger = String::new();
        archive
            .by_name("ledger_events.csv")
            .expect("ledger should exist")
            .read_to_string(&mut ledger)
            .expect("ledger should read");
        assert!(ledger.contains("12345,123.45,CNY"));
        let mut occurrences = String::new();
        archive
            .by_name("reminder_occurrences.csv")
            .expect("reminder occurrences should exist")
            .read_to_string(&mut occurrences)
            .expect("reminder occurrences should read");
        assert!(occurrences.contains("2026-08-02"));
        assert!(occurrences.contains("2027-08-02"));
    }

    #[test]
    fn atomic_export_refuses_to_overwrite_existing_plaintext() {
        let directory = tempfile::tempdir().expect("directory");
        let path = directory.path().join("export.zip");
        write_export_atomically(&path, b"first").expect("first export should write");
        assert!(write_export_atomically(&path, b"second").is_err());
        assert_eq!(fs::read(path).expect("file should read"), b"first");
    }
}
