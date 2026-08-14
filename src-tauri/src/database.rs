use rusqlite::{Connection, OpenFlags, OptionalExtension};
use std::path::Path;
use zeroize::Zeroizing;

const SCHEMA: &str = include_str!("../../db/schema.sql");

pub(crate) fn ensure_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(SCHEMA)
        .map_err(|_| "Unable to migrate encrypted vault schema.".to_owned())?;
    migrate_schema(connection)
}

fn migrate_holding_sync_event_kinds(connection: &Connection) -> Result<(), String> {
    let outbox_sql: Option<String> = connection
        .query_row(
            "SELECT sql FROM sqlite_master
             WHERE type = 'table' AND name = 'sync_outbox_events'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "Unable to inspect encrypted holding sync schema.".to_owned())?;
    if outbox_sql
        .as_deref()
        .is_none_or(|sql| sql.contains("'holding_operation_correction'"))
    {
        return Ok(());
    }
    let migration = connection.execute_batch(
        "
        PRAGMA foreign_keys = OFF;
        BEGIN IMMEDIATE;
        DROP TRIGGER IF EXISTS sync_outbox_no_update;
        DROP TRIGGER IF EXISTS sync_outbox_no_delete;
        DROP TRIGGER IF EXISTS sync_inbox_no_update;
        DROP TRIGGER IF EXISTS sync_inbox_no_delete;

        CREATE TABLE sync_outbox_events_v14 (
          cloud_event_id TEXT PRIMARY KEY,
          local_vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
          event_kind TEXT NOT NULL CHECK (
            event_kind IN (
              'account_snapshot', 'holding_snapshot', 'holding_valuation',
              'ledger_event', 'holding_operation',
              'holding_operation_correction', 'reminder_snapshot'
            )
          ),
          source_id TEXT NOT NULL,
          source_version_id TEXT NOT NULL,
          device_id TEXT NOT NULL,
          logical_clock INTEGER NOT NULL CHECK (logical_clock > 0),
          idempotency_key TEXT NOT NULL,
          event_hash BLOB NOT NULL CHECK (length(event_hash) = 32),
          previous_event_hash BLOB CHECK (
            previous_event_hash IS NULL OR length(previous_event_hash) = 32
          ),
          payload_nonce BLOB NOT NULL CHECK (length(payload_nonce) = 24),
          payload_ciphertext BLOB NOT NULL CHECK (length(payload_ciphertext) >= 17),
          aad_version INTEGER NOT NULL DEFAULT 2 CHECK (aad_version = 2),
          occurred_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE (local_vault_id, event_kind, source_version_id),
          UNIQUE (local_vault_id, logical_clock),
          UNIQUE (local_vault_id, idempotency_key),
          UNIQUE (local_vault_id, event_hash)
        );
        INSERT INTO sync_outbox_events_v14
        SELECT * FROM sync_outbox_events;
        DROP TABLE sync_outbox_events;
        ALTER TABLE sync_outbox_events_v14 RENAME TO sync_outbox_events;
        CREATE INDEX sync_outbox_vault_clock
          ON sync_outbox_events(local_vault_id, logical_clock, cloud_event_id);
        CREATE TRIGGER sync_outbox_no_update
        BEFORE UPDATE ON sync_outbox_events
        BEGIN
          SELECT RAISE(ABORT, 'sync outbox envelopes are immutable');
        END;
        CREATE TRIGGER sync_outbox_no_delete
        BEFORE DELETE ON sync_outbox_events
        BEGIN
          SELECT RAISE(ABORT, 'sync outbox envelopes are immutable');
        END;

        CREATE TABLE sync_inbox_events_v14 (
          cloud_event_id TEXT PRIMARY KEY,
          local_vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
          event_kind TEXT NOT NULL CHECK (
            event_kind IN (
              'account_snapshot', 'holding_snapshot', 'holding_valuation',
              'ledger_event', 'holding_operation',
              'holding_operation_correction', 'reminder_snapshot'
            )
          ),
          device_id TEXT NOT NULL,
          logical_clock INTEGER NOT NULL CHECK (logical_clock > 0),
          idempotency_key TEXT NOT NULL,
          event_hash BLOB NOT NULL CHECK (length(event_hash) = 32),
          previous_event_hash BLOB CHECK (
            previous_event_hash IS NULL OR length(previous_event_hash) = 32
          ),
          payload_nonce BLOB NOT NULL CHECK (length(payload_nonce) = 24),
          payload_ciphertext BLOB NOT NULL CHECK (length(payload_ciphertext) >= 17),
          aad_version INTEGER NOT NULL DEFAULT 2 CHECK (aad_version = 2),
          occurred_at TEXT NOT NULL,
          received_at TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          UNIQUE (local_vault_id, idempotency_key),
          UNIQUE (local_vault_id, event_hash)
        );
        INSERT INTO sync_inbox_events_v14
        SELECT * FROM sync_inbox_events;
        DROP TABLE sync_inbox_events;
        ALTER TABLE sync_inbox_events_v14 RENAME TO sync_inbox_events;
        CREATE TRIGGER sync_inbox_no_update
        BEFORE UPDATE ON sync_inbox_events
        BEGIN
          SELECT RAISE(ABORT, 'sync inbox envelopes are immutable');
        END;
        CREATE TRIGGER sync_inbox_no_delete
        BEFORE DELETE ON sync_inbox_events
        BEGIN
          SELECT RAISE(ABORT, 'sync inbox envelopes are immutable');
        END;

        CREATE TABLE sync_entity_versions_v14 (
          local_vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
          event_kind TEXT NOT NULL CHECK (
            event_kind IN (
              'account_snapshot', 'holding_snapshot', 'reminder_snapshot'
            )
          ),
          source_id TEXT NOT NULL,
          device_id TEXT NOT NULL,
          logical_clock INTEGER NOT NULL CHECK (logical_clock > 0),
          event_hash BLOB NOT NULL CHECK (length(event_hash) = 32),
          cloud_event_id TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (local_vault_id, event_kind, source_id)
        );
        INSERT INTO sync_entity_versions_v14
        SELECT * FROM sync_entity_versions;
        DROP TABLE sync_entity_versions;
        ALTER TABLE sync_entity_versions_v14 RENAME TO sync_entity_versions;
        COMMIT;
        PRAGMA foreign_keys = ON;
        ",
    );
    if migration.is_err() {
        let _ = connection.execute_batch("ROLLBACK; PRAGMA foreign_keys = ON;");
        return Err("Unable to migrate encrypted holding sync event kinds.".to_owned());
    }
    let foreign_key_issues: i64 = connection
        .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })
        .map_err(|_| "Unable to verify encrypted holding sync migration.".to_owned())?;
    if foreign_key_issues != 0 {
        return Err("Encrypted holding sync migration failed integrity checks.".to_owned());
    }
    Ok(())
}

fn migrate_schema(connection: &Connection) -> Result<(), String> {
    let has_account_notes: bool = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM pragma_table_info('accounts') WHERE name = 'notes'
            )",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to inspect encrypted vault schema.".to_owned())?;
    if !has_account_notes {
        connection
            .execute("ALTER TABLE accounts ADD COLUMN notes TEXT", [])
            .map_err(|_| "Unable to migrate encrypted account data.".to_owned())?;
    }
    connection
        .execute(
            "INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
             VALUES (2, 'account_notes_and_manual_account_flow',
                     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            [],
        )
        .map_err(|_| "Unable to record encrypted schema migration.".to_owned())?;

    let has_reminder_notes: bool = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM pragma_table_info('reminders') WHERE name = 'notes'
            )",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to inspect encrypted reminder schema.".to_owned())?;
    if !has_reminder_notes {
        connection
            .execute("ALTER TABLE reminders ADD COLUMN notes TEXT", [])
            .map_err(|_| "Unable to migrate encrypted reminder notes.".to_owned())?;
    }
    let has_reminder_archive: bool = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM pragma_table_info('reminders') WHERE name = 'archived_at'
            )",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to inspect encrypted reminder lifecycle schema.".to_owned())?;
    if !has_reminder_archive {
        connection
            .execute("ALTER TABLE reminders ADD COLUMN archived_at TEXT", [])
            .map_err(|_| "Unable to migrate encrypted reminder lifecycle data.".to_owned())?;
    }

    let reminder_events_sql: Option<String> = connection
        .query_row(
            "SELECT sql FROM sqlite_master
             WHERE type = 'table' AND name = 'reminder_events'",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to inspect encrypted reminder event schema.".to_owned())?;
    if reminder_events_sql
        .as_deref()
        .is_some_and(|sql| !sql.contains("'updated'"))
    {
        connection
            .execute_batch(
                "
                ALTER TABLE reminder_events RENAME TO reminder_events_legacy;
                CREATE TABLE reminder_events (
                  id TEXT PRIMARY KEY,
                  reminder_id TEXT NOT NULL REFERENCES reminders(id) ON DELETE RESTRICT,
                  action TEXT NOT NULL CHECK (
                    action IN (
                      'created', 'updated', 'completed', 'snoozed',
                      'ignored', 'archived', 'restored', 'notified'
                    )
                  ),
                  occurred_at TEXT NOT NULL,
                  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json))
                );
                INSERT INTO reminder_events(
                  id, reminder_id, action, occurred_at, metadata_json
                )
                SELECT id, reminder_id, action, occurred_at, metadata_json
                FROM reminder_events_legacy;
                DROP TABLE reminder_events_legacy;
                ",
            )
            .map_err(|_| "Unable to migrate encrypted reminder event history.".to_owned())?;
    }
    connection
        .execute(
            "INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
             VALUES (3, 'reminder_lifecycle_and_audit',
                     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            [],
        )
        .map_err(|_| "Unable to record encrypted reminder migration.".to_owned())?;

    let has_sync_outbox_table: bool = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM sqlite_master
                WHERE type = 'table' AND name = 'sync_outbox_events'
            )",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to inspect encrypted sync tables.".to_owned())?;
    let has_domain_event_kind: bool = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM pragma_table_info('sync_outbox_events')
                WHERE name = 'event_kind'
            )",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to inspect encrypted sync outbox schema.".to_owned())?;
    if has_sync_outbox_table && !has_domain_event_kind {
        // Outbox rows are derived encrypted envelopes, never the system of record.
        // Rebuild them for AAD v2 so event_kind is authenticated and old ledger-only
        // envelopes cannot be uploaded under the new protocol.
        connection
            .execute_batch(
                "
                DROP TRIGGER IF EXISTS sync_delivery_attempts_no_update;
                DROP TRIGGER IF EXISTS sync_delivery_attempts_no_delete;
                DROP TRIGGER IF EXISTS sync_outbox_no_update;
                DROP TRIGGER IF EXISTS sync_outbox_no_delete;
                DELETE FROM sync_delivery_attempts;
                DELETE FROM sync_delivery_state;
                DELETE FROM sync_outbox_events;
                DROP TABLE sync_delivery_attempts;
                DROP TABLE sync_delivery_state;
                DROP TABLE sync_outbox_events;

                CREATE TABLE sync_outbox_events (
                  cloud_event_id TEXT PRIMARY KEY,
                  local_vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
                  event_kind TEXT NOT NULL CHECK (
                    event_kind IN ('account_snapshot', 'ledger_event', 'reminder_snapshot')
                  ),
                  source_id TEXT NOT NULL,
                  source_version_id TEXT NOT NULL,
                  device_id TEXT NOT NULL,
                  logical_clock INTEGER NOT NULL CHECK (logical_clock > 0),
                  idempotency_key TEXT NOT NULL,
                  event_hash BLOB NOT NULL CHECK (length(event_hash) = 32),
                  previous_event_hash BLOB CHECK (
                    previous_event_hash IS NULL OR length(previous_event_hash) = 32
                  ),
                  payload_nonce BLOB NOT NULL CHECK (length(payload_nonce) = 24),
                  payload_ciphertext BLOB NOT NULL CHECK (length(payload_ciphertext) >= 17),
                  aad_version INTEGER NOT NULL DEFAULT 2 CHECK (aad_version = 2),
                  occurred_at TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  UNIQUE (local_vault_id, event_kind, source_version_id),
                  UNIQUE (local_vault_id, logical_clock),
                  UNIQUE (local_vault_id, idempotency_key),
                  UNIQUE (local_vault_id, event_hash)
                );
                CREATE INDEX sync_outbox_vault_clock
                  ON sync_outbox_events(local_vault_id, logical_clock, cloud_event_id);
                CREATE TRIGGER sync_outbox_no_update
                BEFORE UPDATE ON sync_outbox_events
                BEGIN
                  SELECT RAISE(ABORT, 'sync outbox envelopes are immutable');
                END;
                CREATE TRIGGER sync_outbox_no_delete
                BEFORE DELETE ON sync_outbox_events
                BEGIN
                  SELECT RAISE(ABORT, 'sync outbox envelopes are immutable');
                END;

                CREATE TABLE sync_delivery_state (
                  cloud_event_id TEXT PRIMARY KEY REFERENCES sync_outbox_events(cloud_event_id)
                    ON DELETE RESTRICT,
                  status TEXT NOT NULL CHECK (
                    status IN ('pending', 'synced', 'needs_reconciliation')
                  ),
                  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
                  last_error_code TEXT,
                  remote_received_at TEXT,
                  updated_at TEXT NOT NULL
                );
                CREATE INDEX sync_delivery_pending
                  ON sync_delivery_state(status, updated_at)
                  WHERE status = 'pending';
                CREATE TABLE sync_delivery_attempts (
                  id TEXT PRIMARY KEY,
                  cloud_event_id TEXT NOT NULL REFERENCES sync_outbox_events(cloud_event_id)
                    ON DELETE RESTRICT,
                  outcome TEXT NOT NULL CHECK (
                    outcome IN ('synced', 'retry', 'needs_reconciliation')
                  ),
                  error_code TEXT,
                  occurred_at TEXT NOT NULL
                );
                CREATE TRIGGER sync_delivery_attempts_no_update
                BEFORE UPDATE ON sync_delivery_attempts
                BEGIN
                  SELECT RAISE(ABORT, 'sync delivery attempts are immutable');
                END;
                CREATE TRIGGER sync_delivery_attempts_no_delete
                BEFORE DELETE ON sync_delivery_attempts
                BEGIN
                  SELECT RAISE(ABORT, 'sync delivery attempts are immutable');
                END;
                ",
            )
            .map_err(|_| "Unable to migrate encrypted domain sync outbox.".to_owned())?;
    }

    let has_sync_config_table: bool = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM sqlite_master
                WHERE type = 'table' AND name = 'sync_config'
            )",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to inspect encrypted sync configuration table.".to_owned())?;
    for column in ["last_inbound_received_at", "last_inbound_event_id"] {
        let exists: bool = connection
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM pragma_table_info('sync_config') WHERE name = ?1
                )",
                [column],
                |row| row.get(0),
            )
            .map_err(|_| "Unable to inspect encrypted sync cursor schema.".to_owned())?;
        if has_sync_config_table && !exists {
            connection
                .execute(
                    &format!("ALTER TABLE sync_config ADD COLUMN {column} TEXT"),
                    [],
                )
                .map_err(|_| "Unable to migrate encrypted sync cursor.".to_owned())?;
        }
    }
    let inbox_conflicts_sql: Option<String> = connection
        .query_row(
            "SELECT sql FROM sqlite_master
             WHERE type = 'table' AND name = 'sync_inbox_conflicts'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "Unable to inspect encrypted inbox conflict schema.".to_owned())?;
    if inbox_conflicts_sql
        .as_deref()
        .is_some_and(|sql| !sql.contains("'hash_gap'"))
    {
        connection
            .execute_batch(
                "
                DROP TRIGGER IF EXISTS sync_inbox_conflicts_no_update;
                DROP TRIGGER IF EXISTS sync_inbox_conflicts_no_delete;
                ALTER TABLE sync_inbox_conflicts RENAME TO sync_inbox_conflicts_legacy;
                CREATE TABLE sync_inbox_conflicts (
                  id TEXT PRIMARY KEY,
                  local_vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
                  cloud_event_id TEXT NOT NULL REFERENCES sync_inbox_events(cloud_event_id)
                    ON DELETE RESTRICT,
                  event_kind TEXT NOT NULL,
                  source_id TEXT,
                  reason_code TEXT NOT NULL CHECK (
                    reason_code IN (
                      'event_id_collision', 'idempotency_collision', 'concurrent_edit',
                      'missing_dependency', 'invalid_payload', 'hash_gap'
                    )
                  ),
                  details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
                  occurred_at TEXT NOT NULL,
                  UNIQUE (local_vault_id, cloud_event_id, reason_code)
                );
                INSERT INTO sync_inbox_conflicts(
                  id, local_vault_id, cloud_event_id, event_kind, source_id,
                  reason_code, details_json, occurred_at
                )
                SELECT id, local_vault_id, cloud_event_id, event_kind, source_id,
                       reason_code, details_json, occurred_at
                FROM sync_inbox_conflicts_legacy;
                DROP TABLE sync_inbox_conflicts_legacy;
                CREATE TRIGGER sync_inbox_conflicts_no_update
                BEFORE UPDATE ON sync_inbox_conflicts
                BEGIN
                  SELECT RAISE(ABORT, 'sync inbox conflicts are immutable');
                END;
                CREATE TRIGGER sync_inbox_conflicts_no_delete
                BEFORE DELETE ON sync_inbox_conflicts
                BEGIN
                  SELECT RAISE(ABORT, 'sync inbox conflicts are immutable');
                END;
                ",
            )
            .map_err(|_| "Unable to migrate encrypted inbox conflict reasons.".to_owned())?;
    }
    connection
        .execute(
            "INSERT OR REPLACE INTO schema_migrations(version, name, applied_at)
             VALUES (5, 'encrypted_domain_sync_and_inbox',
                     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            [],
        )
        .map_err(|_| "Unable to record encrypted domain sync migration.".to_owned())?;
    migrate_holding_sync_event_kinds(connection)?;
    connection
        .execute(
            "INSERT OR REPLACE INTO schema_migrations(version, name, applied_at)
             VALUES (14, 'encrypted_holding_domain_sync',
                     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            [],
        )
        .map_err(|_| "Unable to record encrypted holding sync migration.".to_owned())?;
    connection
        .execute(
            "INSERT OR REPLACE INTO schema_migrations(version, name, applied_at)
             VALUES (15, 'immutable_sync_conflict_resolutions',
                     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            [],
        )
        .map_err(|_| "Unable to record encrypted sync conflict resolution migration.".to_owned())?;

    let ai_proposals_sql: Option<String> = connection
        .query_row(
            "SELECT sql FROM sqlite_master
             WHERE type = 'table' AND name = 'ai_proposals'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "Unable to inspect encrypted AI proposal schema.".to_owned())?;
    if ai_proposals_sql
        .as_deref()
        .is_some_and(|sql| !sql.contains("'planning'") || !sql.contains("'holding_operation'"))
    {
        connection
            .execute_batch(
                "
                DROP TRIGGER IF EXISTS ai_proposals_no_update;
                DROP TRIGGER IF EXISTS ai_proposals_no_delete;
                ALTER TABLE ai_proposals RENAME TO ai_proposals_legacy;
                CREATE TABLE ai_proposals (
                  id TEXT PRIMARY KEY,
                  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
                  domain_draft_id TEXT NOT NULL UNIQUE
                    REFERENCES draft_changes(id) ON DELETE RESTRICT,
                  input_kind TEXT NOT NULL CHECK (input_kind IN ('text', 'voice', 'file')),
                  proposal_kind TEXT NOT NULL CHECK (
                    proposal_kind IN (
                      'account', 'holding_operation', 'transaction', 'reminder', 'planning'
                    )
                  ),
                  module_context TEXT NOT NULL CHECK (
                    module_context IN (
                      'overview', 'assets', 'cashflow', 'planning',
                      'reminders', 'assistant', 'sources', 'settings'
                    )
                  ),
                  provider_id TEXT NOT NULL,
                  parser_version TEXT NOT NULL,
                  transcript TEXT NOT NULL CHECK (length(transcript) BETWEEN 1 AND 4000),
                  transcript_hash BLOB NOT NULL CHECK (length(transcript_hash) = 32),
                  confidence_bps INTEGER NOT NULL CHECK (confidence_bps BETWEEN 0 AND 10000),
                  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
                  created_at TEXT NOT NULL
                );
                INSERT INTO ai_proposals(
                  id, vault_id, domain_draft_id, input_kind, proposal_kind,
                  module_context, provider_id, parser_version, transcript,
                  transcript_hash, confidence_bps, evidence_json, created_at
                )
                SELECT
                  id, vault_id, domain_draft_id, input_kind, proposal_kind,
                  module_context, provider_id, parser_version, transcript,
                  transcript_hash, confidence_bps, evidence_json, created_at
                FROM ai_proposals_legacy;
                DROP TABLE ai_proposals_legacy;
                CREATE INDEX ai_proposals_vault_time
                  ON ai_proposals(vault_id, created_at, id);
                CREATE TRIGGER ai_proposals_no_update
                BEFORE UPDATE ON ai_proposals
                BEGIN
                  SELECT RAISE(ABORT, 'AI proposals are immutable');
                END;
                CREATE TRIGGER ai_proposals_no_delete
                BEFORE DELETE ON ai_proposals
                BEGIN
                  SELECT RAISE(ABORT, 'AI proposals are immutable');
                END;
                ",
            )
            .map_err(|_| "Unable to migrate encrypted domain AI proposals.".to_owned())?;
    }
    connection
        .execute(
            "INSERT OR REPLACE INTO schema_migrations(version, name, applied_at)
             VALUES (7, 'encrypted_planning_profile_and_events',
                     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            [],
        )
        .map_err(|_| "Unable to record encrypted planning migration.".to_owned())?;
    connection
        .execute(
            "INSERT OR REPLACE INTO schema_migrations(version, name, applied_at)
             VALUES (13, 'holding_operation_ai_proposals',
                     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            [],
        )
        .map_err(|_| "Unable to record holding operation AI proposal migration.".to_owned())?;
    connection
        .execute(
            "INSERT OR REPLACE INTO schema_migrations(version, name, applied_at)
             VALUES (8, 'private_local_notification_schedule',
                     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            [],
        )
        .map_err(|_| "Unable to record notification schedule migration.".to_owned())?;

    for column in ["recurrence_anchor_month", "recurrence_anchor_day"] {
        let exists: bool = connection
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM pragma_table_info('reminders') WHERE name = ?1
                )",
                [column],
                |row| row.get(0),
            )
            .map_err(|_| "Unable to inspect recurring reminder schema.".to_owned())?;
        if !exists {
            let constraint = if column == "recurrence_anchor_month" {
                "CHECK (recurrence_anchor_month IS NULL OR recurrence_anchor_month BETWEEN 1 AND 12)"
            } else {
                "CHECK (recurrence_anchor_day IS NULL OR recurrence_anchor_day BETWEEN 1 AND 31)"
            };
            connection
                .execute(
                    &format!("ALTER TABLE reminders ADD COLUMN {column} INTEGER {constraint}"),
                    [],
                )
                .map_err(|_| "Unable to migrate recurring reminder anchors.".to_owned())?;
        }
    }
    let has_recurrence_fields: bool = connection
        .query_row(
            "SELECT
               EXISTS(SELECT 1 FROM pragma_table_info('reminders') WHERE name = 'due_at')
               AND EXISTS(
                 SELECT 1 FROM pragma_table_info('reminders') WHERE name = 'recurrence_rule'
               )",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "Unable to inspect recurring reminder fields.".to_owned())?;
    if has_recurrence_fields {
        connection
            .execute(
                "UPDATE reminders
                 SET recurrence_anchor_month =
                       CAST(strftime('%m', due_at) AS INTEGER),
                     recurrence_anchor_day =
                       CAST(strftime('%d', due_at) AS INTEGER)
                 WHERE recurrence_rule IS NOT NULL
                   AND (recurrence_anchor_month IS NULL OR recurrence_anchor_day IS NULL)",
                [],
            )
            .map_err(|_| "Unable to backfill recurring reminder anchors.".to_owned())?;
    }
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS reminder_occurrences (
              id TEXT PRIMARY KEY,
              reminder_id TEXT NOT NULL REFERENCES reminders(id) ON DELETE RESTRICT,
              due_on TEXT NOT NULL,
              completed_at TEXT NOT NULL,
              next_due_on TEXT,
              confirmation_draft_id TEXT NOT NULL,
              created_at TEXT NOT NULL,
              UNIQUE (reminder_id, due_on)
            );
            CREATE INDEX IF NOT EXISTS reminder_occurrences_history
              ON reminder_occurrences(reminder_id, due_on DESC, id);
            CREATE TRIGGER IF NOT EXISTS reminder_occurrences_no_update
            BEFORE UPDATE ON reminder_occurrences
            BEGIN
              SELECT RAISE(ABORT, 'reminder occurrences are immutable');
            END;
            CREATE TRIGGER IF NOT EXISTS reminder_occurrences_no_delete
            BEFORE DELETE ON reminder_occurrences
            BEGIN
              SELECT RAISE(ABORT, 'reminder occurrences are immutable');
            END;
            ",
        )
        .map_err(|_| "Unable to migrate recurring reminder occurrences.".to_owned())?;
    connection
        .execute(
            "INSERT OR REPLACE INTO schema_migrations(version, name, applied_at)
             VALUES (9, 'immutable_recurring_reminder_occurrences',
                     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            [],
        )
        .map_err(|_| "Unable to record recurring reminder migration.".to_owned())?;
    Ok(())
}

pub fn open_encrypted(path: &Path, key: &[u8; 32]) -> Result<Connection, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Vault database path is invalid.".to_owned())?
        .canonicalize()
        .map_err(|_| "Vault database directory is unavailable.".to_owned())?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "Vault database path is invalid.".to_owned())?;
    let resolved_path = parent.join(file_name);
    let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
        | OpenFlags::SQLITE_OPEN_CREATE
        | OpenFlags::SQLITE_OPEN_NOFOLLOW;
    let connection = Connection::open_with_flags(resolved_path, flags)
        .map_err(|_| "Unable to open encrypted vault database.".to_owned())?;

    let raw_key = Zeroizing::new(hex::encode_upper(key));
    let key_pragma = Zeroizing::new(format!("PRAGMA key = \"x'{}'\";", raw_key.as_str()));
    connection
        .execute_batch(key_pragma.as_str())
        .map_err(|_| "Unable to apply encrypted vault key.".to_owned())?;
    connection
        .execute_batch(
            "
            PRAGMA cipher_memory_security = ON;
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = FULL;
            PRAGMA secure_delete = ON;
            ",
        )
        .map_err(|_| "Unable to configure encrypted vault database.".to_owned())?;

    let cipher_version: String = connection
        .query_row("PRAGMA cipher_version", [], |row| row.get(0))
        .map_err(|_| "SQLCipher is not available in this build.".to_owned())?;
    if cipher_version.trim().is_empty() {
        return Err("SQLCipher is not available in this build.".to_owned());
    }

    connection
        .query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))
        .map_err(|_| "Vault key is invalid or the database is damaged.".to_owned())?;
    ensure_schema(&connection)?;
    Ok(connection)
}

pub fn cipher_integrity_check(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare("PRAGMA cipher_integrity_check")
        .map_err(|_| "Unable to start encrypted integrity check.".to_owned())?;
    let mut rows = statement
        .query([])
        .map_err(|_| "Unable to run encrypted integrity check.".to_owned())?;
    if rows
        .next()
        .map_err(|_| "Unable to read encrypted integrity result.".to_owned())?
        .is_some()
    {
        return Err("Encrypted vault integrity check failed.".to_owned());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn sqlcipher_database_round_trips_without_plaintext_schema() {
        let directory = tempfile::tempdir().expect("temporary directory should exist");
        let path = directory.path().join("vault.local.sqlite3");
        let key = [7_u8; 32];
        {
            let connection = open_encrypted(&path, &key).expect("database should open");
            connection
                .execute(
                    "INSERT INTO vaults(id, display_name, base_currency, created_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    (
                        "vault-1",
                        "Encrypted Test Vault",
                        "CNY",
                        "2026-07-24T00:00:00.000Z",
                    ),
                )
                .expect("fixture should insert");
            cipher_integrity_check(&connection).expect("cipher integrity should pass");
        }

        let bytes = fs::read(&path).expect("database should be readable as bytes");
        assert!(!bytes.starts_with(b"SQLite format 3"));
        assert!(!bytes
            .windows("Encrypted Test Vault".len())
            .any(|window| window == b"Encrypted Test Vault"));
        assert!(!bytes
            .windows("ledger_events".len())
            .any(|window| window == b"ledger_events"));

        let reopened = open_encrypted(&path, &key).expect("correct key should reopen");
        let name: String = reopened
            .query_row(
                "SELECT display_name FROM vaults WHERE id = 'vault-1'",
                [],
                |row| row.get(0),
            )
            .expect("fixture should decrypt");
        assert_eq!(name, "Encrypted Test Vault");
    }

    #[test]
    fn wrong_database_key_is_rejected() {
        let directory = tempfile::tempdir().expect("temporary directory should exist");
        let path = directory.path().join("vault.local.sqlite3");
        drop(open_encrypted(&path, &[3_u8; 32]).expect("database should be created"));

        let result = open_encrypted(&path, &[4_u8; 32]);
        assert!(result.is_err());
    }

    #[test]
    fn legacy_sync_envelopes_migrate_to_holding_event_kinds_without_losing_state() {
        let connection = Connection::open_in_memory().expect("memory database should open");
        connection
            .execute_batch(
                "
                PRAGMA foreign_keys = ON;
                CREATE TABLE vaults(id TEXT PRIMARY KEY);
                CREATE TABLE sync_outbox_events (
                  cloud_event_id TEXT PRIMARY KEY,
                  local_vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
                  event_kind TEXT NOT NULL CHECK (
                    event_kind IN (
                      'account_snapshot', 'ledger_event', 'reminder_snapshot'
                    )
                  ),
                  source_id TEXT NOT NULL,
                  source_version_id TEXT NOT NULL,
                  device_id TEXT NOT NULL,
                  logical_clock INTEGER NOT NULL CHECK (logical_clock > 0),
                  idempotency_key TEXT NOT NULL,
                  event_hash BLOB NOT NULL CHECK (length(event_hash) = 32),
                  previous_event_hash BLOB CHECK (
                    previous_event_hash IS NULL OR length(previous_event_hash) = 32
                  ),
                  payload_nonce BLOB NOT NULL CHECK (length(payload_nonce) = 24),
                  payload_ciphertext BLOB NOT NULL CHECK (length(payload_ciphertext) >= 17),
                  aad_version INTEGER NOT NULL DEFAULT 2 CHECK (aad_version = 2),
                  occurred_at TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  UNIQUE (local_vault_id, event_kind, source_version_id),
                  UNIQUE (local_vault_id, logical_clock),
                  UNIQUE (local_vault_id, idempotency_key),
                  UNIQUE (local_vault_id, event_hash)
                );
                CREATE TABLE sync_delivery_state (
                  cloud_event_id TEXT PRIMARY KEY
                    REFERENCES sync_outbox_events(cloud_event_id) ON DELETE RESTRICT,
                  status TEXT NOT NULL,
                  attempt_count INTEGER NOT NULL,
                  updated_at TEXT NOT NULL
                );
                CREATE TABLE sync_inbox_events (
                  cloud_event_id TEXT PRIMARY KEY,
                  local_vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
                  event_kind TEXT NOT NULL CHECK (
                    event_kind IN (
                      'account_snapshot', 'ledger_event', 'reminder_snapshot'
                    )
                  ),
                  device_id TEXT NOT NULL,
                  logical_clock INTEGER NOT NULL CHECK (logical_clock > 0),
                  idempotency_key TEXT NOT NULL,
                  event_hash BLOB NOT NULL CHECK (length(event_hash) = 32),
                  previous_event_hash BLOB CHECK (
                    previous_event_hash IS NULL OR length(previous_event_hash) = 32
                  ),
                  payload_nonce BLOB NOT NULL CHECK (length(payload_nonce) = 24),
                  payload_ciphertext BLOB NOT NULL CHECK (length(payload_ciphertext) >= 17),
                  aad_version INTEGER NOT NULL DEFAULT 2 CHECK (aad_version = 2),
                  occurred_at TEXT NOT NULL,
                  received_at TEXT NOT NULL,
                  recorded_at TEXT NOT NULL,
                  UNIQUE (local_vault_id, idempotency_key),
                  UNIQUE (local_vault_id, event_hash)
                );
                CREATE TABLE sync_inbox_state (
                  cloud_event_id TEXT PRIMARY KEY
                    REFERENCES sync_inbox_events(cloud_event_id) ON DELETE RESTRICT,
                  status TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                CREATE TABLE sync_entity_versions (
                  local_vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
                  event_kind TEXT NOT NULL CHECK (
                    event_kind IN ('account_snapshot', 'reminder_snapshot')
                  ),
                  source_id TEXT NOT NULL,
                  device_id TEXT NOT NULL,
                  logical_clock INTEGER NOT NULL CHECK (logical_clock > 0),
                  event_hash BLOB NOT NULL CHECK (length(event_hash) = 32),
                  cloud_event_id TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY (local_vault_id, event_kind, source_id)
                );
                INSERT INTO vaults(id) VALUES ('vault-1');
                INSERT INTO sync_outbox_events(
                  cloud_event_id, local_vault_id, event_kind, source_id,
                  source_version_id, device_id, logical_clock, idempotency_key,
                  event_hash, payload_nonce, payload_ciphertext, aad_version,
                  occurred_at, created_at
                ) VALUES (
                  'outbox-1', 'vault-1', 'account_snapshot', 'account-1',
                  'version-1', 'device-1', 1, 'legacy-idempotency-outbox',
                  zeroblob(32), zeroblob(24), zeroblob(17), 2,
                  '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z'
                );
                INSERT INTO sync_delivery_state(
                  cloud_event_id, status, attempt_count, updated_at
                ) VALUES ('outbox-1', 'pending', 0, '2026-07-26T00:00:00.000Z');
                INSERT INTO sync_inbox_events(
                  cloud_event_id, local_vault_id, event_kind, device_id,
                  logical_clock, idempotency_key, event_hash, payload_nonce,
                  payload_ciphertext, aad_version, occurred_at, received_at,
                  recorded_at
                ) VALUES (
                  'inbox-1', 'vault-1', 'reminder_snapshot', 'device-2',
                  1, 'legacy-idempotency-inbox', randomblob(32), zeroblob(24),
                  zeroblob(17), 2, '2026-07-26T00:00:00.000Z',
                  '2026-07-26T00:00:01.000Z', '2026-07-26T00:00:01.000Z'
                );
                INSERT INTO sync_inbox_state(
                  cloud_event_id, status, updated_at
                ) VALUES ('inbox-1', 'applied', '2026-07-26T00:00:01.000Z');
                INSERT INTO sync_entity_versions(
                  local_vault_id, event_kind, source_id, device_id,
                  logical_clock, event_hash, cloud_event_id, updated_at
                ) VALUES (
                  'vault-1', 'account_snapshot', 'account-1', 'device-1',
                  1, zeroblob(32), 'outbox-1', '2026-07-26T00:00:00.000Z'
                );
                ",
            )
            .expect("legacy encrypted sync schema should create");

        migrate_holding_sync_event_kinds(&connection)
            .expect("holding-domain sync migration should preserve encrypted state");

        let preserved: (i64, i64, i64, i64, i64) = connection
            .query_row(
                "SELECT
                   (SELECT count(*) FROM sync_outbox_events),
                   (SELECT count(*) FROM sync_delivery_state),
                   (SELECT count(*) FROM sync_inbox_events),
                   (SELECT count(*) FROM sync_inbox_state),
                   (SELECT count(*) FROM sync_entity_versions)",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("migrated encrypted sync rows should remain queryable");
        assert_eq!(preserved, (1, 1, 1, 1, 1));
        connection
            .execute(
                "INSERT INTO sync_outbox_events(
                  cloud_event_id, local_vault_id, event_kind, source_id,
                  source_version_id, device_id, logical_clock, idempotency_key,
                  event_hash, payload_nonce, payload_ciphertext, aad_version,
                  occurred_at, created_at
                ) VALUES (
                  'outbox-holding', 'vault-1', 'holding_operation_correction',
                  'operation-1', 'correction-1', 'device-1', 2,
                  'holding-correction-idempotency', randomblob(32),
                  randomblob(24), randomblob(17), 2,
                  '2026-07-27T00:00:00.000Z', '2026-07-27T00:00:00.000Z'
                )",
                [],
            )
            .expect("new holding-domain outbox kind should be accepted");
        connection
            .execute(
                "INSERT INTO sync_entity_versions(
                  local_vault_id, event_kind, source_id, device_id,
                  logical_clock, event_hash, cloud_event_id, updated_at
                ) VALUES (
                  'vault-1', 'holding_snapshot', 'holding-1', 'device-1',
                  2, randomblob(32), 'outbox-holding',
                  '2026-07-27T00:00:00.000Z'
                )",
                [],
            )
            .expect("holding snapshots should support conflict-version tracking");
        let foreign_key_issues: i64 = connection
            .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .expect("foreign key verification should run");
        assert_eq!(foreign_key_issues, 0);
    }

    #[test]
    fn legacy_account_schema_gains_notes_column_and_migration_record() {
        let connection = Connection::open_in_memory().expect("memory database should open");
        connection
            .execute_batch(
                "
                CREATE TABLE accounts(id TEXT PRIMARY KEY);
                CREATE TABLE reminders(
                    id TEXT PRIMARY KEY,
                    notes_ciphertext BLOB
                );
                CREATE TABLE reminder_events(
                    id TEXT PRIMARY KEY,
                    reminder_id TEXT NOT NULL REFERENCES reminders(id),
                    action TEXT NOT NULL CHECK (
                        action IN ('created', 'completed', 'snoozed', 'ignored', 'restored', 'notified')
                    ),
                    occurred_at TEXT NOT NULL,
                    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json))
                );
                CREATE TABLE schema_migrations(
                    version INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    applied_at TEXT NOT NULL
                );
                ",
            )
            .expect("legacy schema should create");

        migrate_schema(&connection).expect("legacy account schema should migrate");

        let has_notes: bool = connection
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM pragma_table_info('accounts') WHERE name = 'notes'
                )",
                [],
                |row| row.get(0),
            )
            .expect("notes column should be queryable");
        assert!(has_notes);
        let migration_count: i64 = connection
            .query_row(
                "SELECT count(*) FROM schema_migrations
                 WHERE version = 2 AND name = 'account_notes_and_manual_account_flow'",
                [],
                |row| row.get(0),
            )
            .expect("migration record should exist");
        assert_eq!(migration_count, 1);
        let reminder_columns: (bool, bool) = connection
            .query_row(
                "SELECT
                    EXISTS(SELECT 1 FROM pragma_table_info('reminders') WHERE name = 'notes'),
                    EXISTS(SELECT 1 FROM pragma_table_info('reminders') WHERE name = 'archived_at')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("reminder lifecycle columns should be queryable");
        assert_eq!(reminder_columns, (true, true));
        let reminder_event_sql: String = connection
            .query_row(
                "SELECT sql FROM sqlite_master
                 WHERE type = 'table' AND name = 'reminder_events'",
                [],
                |row| row.get(0),
            )
            .expect("reminder event schema should exist");
        assert!(reminder_event_sql.contains("'updated'"));
        assert!(reminder_event_sql.contains("'archived'"));
        let recurring_schema: (i64, bool, bool) = connection
            .query_row(
                "SELECT
                    (SELECT count(*) FROM pragma_table_info('reminders')
                     WHERE name IN (
                       'recurrence_anchor_month', 'recurrence_anchor_day'
                     )),
                    EXISTS(
                      SELECT 1 FROM sqlite_master
                      WHERE type = 'table' AND name = 'reminder_occurrences'
                    ),
                    EXISTS(
                      SELECT 1 FROM schema_migrations
                      WHERE version = 9
                        AND name = 'immutable_recurring_reminder_occurrences'
                    )",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("recurring reminder migration should be queryable");
        assert_eq!(recurring_schema, (2, true, true));
    }
}
