PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vaults (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  base_currency TEXT NOT NULL CHECK (
    length(base_currency) = 3
    AND base_currency = upper(base_currency)
  ),
  created_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  institution_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (
    length(currency) = 3
    AND currency = upper(currency)
  ),
  masked_identifier TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE (vault_id, institution_name, display_name)
);

CREATE TABLE IF NOT EXISTS holdings (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  product_type TEXT NOT NULL CHECK (
    product_type IN (
      'cash_management', 'fixed_income', 'fund',
      'security', 'insurance', 'other'
    )
  ),
  currency TEXT NOT NULL CHECK (
    length(currency) = 3
    AND currency = upper(currency)
  ),
  masked_identifier TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE (vault_id, account_id, name)
);

CREATE INDEX IF NOT EXISTS holdings_vault_account
  ON holdings(vault_id, account_id, product_type, name);

CREATE TABLE IF NOT EXISTS holding_valuations (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  holding_id TEXT NOT NULL REFERENCES holdings(id) ON DELETE RESTRICT,
  draft_id TEXT NOT NULL UNIQUE REFERENCES draft_changes(id) ON DELETE RESTRICT,
  units_micros INTEGER NOT NULL CHECK (units_micros >= 0),
  cost_basis_minor INTEGER NOT NULL CHECK (cost_basis_minor >= 0),
  market_value_minor INTEGER NOT NULL CHECK (market_value_minor >= 0),
  as_of_date TEXT NOT NULL CHECK (date(as_of_date) = as_of_date),
  source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'import')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS holding_valuations_latest
  ON holding_valuations(vault_id, holding_id, as_of_date DESC, created_at DESC, id DESC);

CREATE TRIGGER IF NOT EXISTS holding_valuations_no_update
BEFORE UPDATE ON holding_valuations
BEGIN
  SELECT RAISE(ABORT, 'holding valuations are immutable');
END;

CREATE TRIGGER IF NOT EXISTS holding_valuations_no_delete
BEFORE DELETE ON holding_valuations
BEGIN
  SELECT RAISE(ABORT, 'holding valuations are immutable');
END;

CREATE TABLE IF NOT EXISTS holding_operations (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  holding_id TEXT NOT NULL REFERENCES holdings(id) ON DELETE RESTRICT,
  draft_id TEXT NOT NULL UNIQUE REFERENCES draft_changes(id) ON DELETE RESTRICT,
  operation_kind TEXT NOT NULL CHECK (
    operation_kind IN ('purchase', 'redeem', 'dividend', 'fee')
  ),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (
    length(currency) = 3
    AND currency = upper(currency)
  ),
  units_delta_micros INTEGER NOT NULL,
  before_valuation_id TEXT NOT NULL
    REFERENCES holding_valuations(id) ON DELETE RESTRICT,
  after_valuation_id TEXT
    REFERENCES holding_valuations(id) ON DELETE RESTRICT,
  settlement_account_id TEXT
    REFERENCES accounts(id) ON DELETE RESTRICT,
  ledger_link_id TEXT,
  primary_ledger_event_id TEXT
    REFERENCES ledger_events(id) ON DELETE RESTRICT,
  secondary_ledger_event_id TEXT
    REFERENCES ledger_events(id) ON DELETE RESTRICT,
  occurred_on TEXT NOT NULL CHECK (date(occurred_on) = occurred_on),
  description TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS holding_operations_history
  ON holding_operations(vault_id, holding_id, occurred_on DESC, created_at DESC, id DESC);

CREATE TRIGGER IF NOT EXISTS holding_operations_no_update
BEFORE UPDATE ON holding_operations
BEGIN
  SELECT RAISE(ABORT, 'holding operations are immutable');
END;

CREATE TRIGGER IF NOT EXISTS holding_operations_no_delete
BEFORE DELETE ON holding_operations
BEGIN
  SELECT RAISE(ABORT, 'holding operations are immutable');
END;

CREATE TABLE IF NOT EXISTS holding_operation_corrections (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL UNIQUE REFERENCES draft_changes(id) ON DELETE RESTRICT,
  original_operation_id TEXT NOT NULL UNIQUE REFERENCES holding_operations(id) ON DELETE RESTRICT,
  compensating_operation_id TEXT NOT NULL UNIQUE REFERENCES holding_operations(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 240),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS holding_operation_corrections_history
  ON holding_operation_corrections(vault_id, created_at DESC, id DESC);

CREATE TRIGGER IF NOT EXISTS holding_operation_corrections_no_update
BEFORE UPDATE ON holding_operation_corrections
BEGIN
  SELECT RAISE(ABORT, 'holding operation corrections are immutable');
END;

CREATE TRIGGER IF NOT EXISTS holding_operation_corrections_no_delete
BEFORE DELETE ON holding_operation_corrections
BEGIN
  SELECT RAISE(ABORT, 'holding operation corrections are immutable');
END;

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('parsed', 'needs_review', 'confirmed', 'rejected', 'failed')
  ),
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  UNIQUE (vault_id, source_fingerprint, parser_version)
);

CREATE TABLE IF NOT EXISTS draft_changes (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  import_batch_id TEXT REFERENCES import_batches(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL,
  source_fingerprint TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('needs_review', 'confirmed', 'rejected')
  ),
  proposed_events_json TEXT NOT NULL CHECK (json_valid(proposed_events_json)),
  evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_json)),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  confirmed_by TEXT,
  rejected_at TEXT,
  rejection_reason TEXT
);

CREATE TABLE IF NOT EXISTS ai_proposals (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  domain_draft_id TEXT NOT NULL UNIQUE REFERENCES draft_changes(id) ON DELETE RESTRICT,
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

CREATE INDEX IF NOT EXISTS ai_proposals_vault_time
  ON ai_proposals(vault_id, created_at, id);

CREATE TRIGGER IF NOT EXISTS ai_proposals_no_update
BEFORE UPDATE ON ai_proposals
BEGIN
  SELECT RAISE(ABORT, 'AI proposals are immutable');
END;

CREATE TABLE IF NOT EXISTS email_sources (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('qq_imap')),
  email_address TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  mailbox TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  allowed_senders_json TEXT NOT NULL CHECK (json_valid(allowed_senders_json)),
  subject_keywords_json TEXT NOT NULL CHECK (json_valid(subject_keywords_json)),
  last_uid INTEGER NOT NULL DEFAULT 0 CHECK (last_uid >= 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (vault_id, provider, email_address)
);

CREATE INDEX IF NOT EXISTS email_sources_vault
  ON email_sources(vault_id, enabled, id);

CREATE TABLE IF NOT EXISTS email_receipts (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  source_id TEXT NOT NULL REFERENCES email_sources(id) ON DELETE RESTRICT,
  remote_uid INTEGER NOT NULL CHECK (remote_uid > 0),
  message_fingerprint TEXT NOT NULL CHECK (length(message_fingerprint) = 64),
  sender_domain TEXT NOT NULL,
  received_at TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('needs_review', 'confirmed', 'duplicate', 'quarantined', 'rejected')
  ),
  error_code TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (source_id, remote_uid),
  UNIQUE (vault_id, message_fingerprint)
);

CREATE INDEX IF NOT EXISTS email_receipts_review
  ON email_receipts(vault_id, status, created_at DESC, id);

CREATE TABLE IF NOT EXISTS email_receipt_items (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES email_receipts(id) ON DELETE RESTRICT,
  item_index INTEGER NOT NULL CHECK (item_index >= 0),
  transaction_draft_id TEXT NOT NULL UNIQUE
    REFERENCES draft_changes(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE (receipt_id, item_index)
);

CREATE TRIGGER IF NOT EXISTS ai_proposals_no_delete
BEFORE DELETE ON ai_proposals
BEGIN
  SELECT RAISE(ABORT, 'AI proposals are immutable');
END;

CREATE TABLE IF NOT EXISTS planning_profiles (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL UNIQUE REFERENCES vaults(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  base_currency TEXT NOT NULL CHECK (
    length(base_currency) = 3
    AND base_currency = upper(base_currency)
  ),
  cash_buffer_minor INTEGER NOT NULL CHECK (cash_buffer_minor >= 0),
  allocations_json TEXT NOT NULL CHECK (json_valid(allocations_json)),
  version_id TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS planning_events (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  profile_id TEXT NOT NULL REFERENCES planning_profiles(id) ON DELETE RESTRICT,
  draft_id TEXT NOT NULL UNIQUE REFERENCES draft_changes(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated')),
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT NOT NULL CHECK (json_valid(after_json)),
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS planning_events_vault_time
  ON planning_events(vault_id, occurred_at, id);

CREATE TRIGGER IF NOT EXISTS planning_events_no_update
BEFORE UPDATE ON planning_events
BEGIN
  SELECT RAISE(ABORT, 'planning_events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS planning_events_no_delete
BEFORE DELETE ON planning_events
BEGIN
  SELECT RAISE(ABORT, 'planning_events are immutable');
END;

CREATE TABLE IF NOT EXISTS ledger_events (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  draft_id TEXT REFERENCES draft_changes(id) ON DELETE RESTRICT,
  import_batch_id TEXT REFERENCES import_batches(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  delta_minor INTEGER NOT NULL,
  currency TEXT NOT NULL CHECK (
    length(currency) = 3
    AND currency = upper(currency)
  ),
  occurred_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'reconciled')),
  idempotency_key TEXT NOT NULL,
  link_id TEXT,
  reverses_event_id TEXT REFERENCES ledger_events(id) ON DELETE RESTRICT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  UNIQUE (vault_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ledger_events_account_time
  ON ledger_events(vault_id, account_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS ledger_events_link
  ON ledger_events(vault_id, link_id)
  WHERE link_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ledger_events_single_reversal
  ON ledger_events(reverses_event_id)
  WHERE reverses_event_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS ledger_events_no_update
BEFORE UPDATE ON ledger_events
BEGIN
  SELECT RAISE(ABORT, 'ledger_events are immutable; append a compensating event');
END;

CREATE TRIGGER IF NOT EXISTS ledger_events_no_delete
BEFORE DELETE ON ledger_events
BEGIN
  SELECT RAISE(ABORT, 'ledger_events are immutable; destroy the encrypted vault to erase it');
END;

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  linked_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  amount_minor INTEGER,
  currency TEXT CHECK (
    currency IS NULL
    OR (length(currency) = 3 AND currency = upper(currency))
  ),
  due_at TEXT NOT NULL,
  advance_seconds INTEGER NOT NULL DEFAULT 0 CHECK (advance_seconds >= 0),
  recurrence_rule TEXT,
  recurrence_anchor_month INTEGER CHECK (
    recurrence_anchor_month IS NULL OR recurrence_anchor_month BETWEEN 1 AND 12
  ),
  recurrence_anchor_day INTEGER CHECK (
    recurrence_anchor_day IS NULL OR recurrence_anchor_day BETWEEN 1 AND 31
  ),
  status TEXT NOT NULL CHECK (
    status IN ('active', 'completed', 'snoozed', 'ignored')
  ),
  notes_ciphertext BLOB,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS reminder_events (
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

CREATE TABLE IF NOT EXISTS notification_preferences (
  vault_id TEXT PRIMARY KEY REFERENCES vaults(id) ON DELETE RESTRICT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  privacy_mode TEXT NOT NULL DEFAULT 'generic' CHECK (
    privacy_mode IN ('generic', 'title')
  ),
  delivery_hour INTEGER NOT NULL DEFAULT 9 CHECK (
    delivery_hour BETWEEN 0 AND 23
  ),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_schedules (
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  reminder_id TEXT NOT NULL REFERENCES reminders(id) ON DELETE RESTRICT,
  request_identifier TEXT NOT NULL UNIQUE,
  scheduled_for_local TEXT NOT NULL,
  content_mode TEXT NOT NULL CHECK (content_mode IN ('generic', 'title')),
  reminder_version TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (vault_id, reminder_id)
);

CREATE INDEX IF NOT EXISTS notification_schedules_next
  ON notification_schedules(vault_id, scheduled_for_local, reminder_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  vault_id TEXT REFERENCES vaults(id) ON DELETE RESTRICT,
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT,
  object_type TEXT,
  object_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  occurred_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events are immutable');
END;

CREATE TABLE IF NOT EXISTS sync_config (
  local_vault_id TEXT PRIMARY KEY REFERENCES vaults(id) ON DELETE RESTRICT,
  cloud_vault_id TEXT NOT NULL UNIQUE,
  cloud_user_id TEXT NOT NULL,
  device_id TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('macos', 'ios', 'android')),
  device_private_key BLOB NOT NULL CHECK (length(device_private_key) = 32),
  device_public_key BLOB NOT NULL CHECK (length(device_public_key) = 32),
  sync_key BLOB NOT NULL CHECK (length(sync_key) = 32),
  encrypted_vault_name BLOB NOT NULL CHECK (length(encrypted_vault_name) >= 17),
  vault_name_nonce BLOB NOT NULL CHECK (length(vault_name_nonce) = 24),
  key_envelope_id TEXT NOT NULL UNIQUE,
  key_envelope_nonce BLOB NOT NULL CHECK (length(key_envelope_nonce) = 24),
  wrapped_sync_key BLOB NOT NULL CHECK (length(wrapped_sync_key) >= 48),
  key_version INTEGER NOT NULL DEFAULT 1 CHECK (key_version > 0),
  logical_clock INTEGER NOT NULL DEFAULT 0 CHECK (logical_clock >= 0),
  last_inbound_received_at TEXT,
  last_inbound_event_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  disabled_at TEXT
);

CREATE TABLE IF NOT EXISTS sync_outbox_events (
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

CREATE INDEX IF NOT EXISTS sync_outbox_vault_clock
  ON sync_outbox_events(local_vault_id, logical_clock, cloud_event_id);

CREATE TRIGGER IF NOT EXISTS sync_outbox_no_update
BEFORE UPDATE ON sync_outbox_events
BEGIN
  SELECT RAISE(ABORT, 'sync outbox envelopes are immutable');
END;

CREATE TRIGGER IF NOT EXISTS sync_outbox_no_delete
BEFORE DELETE ON sync_outbox_events
BEGIN
  SELECT RAISE(ABORT, 'sync outbox envelopes are immutable');
END;

CREATE TABLE IF NOT EXISTS sync_delivery_state (
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

CREATE INDEX IF NOT EXISTS sync_delivery_pending
  ON sync_delivery_state(status, updated_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS sync_delivery_attempts (
  id TEXT PRIMARY KEY,
  cloud_event_id TEXT NOT NULL REFERENCES sync_outbox_events(cloud_event_id)
    ON DELETE RESTRICT,
  outcome TEXT NOT NULL CHECK (
    outcome IN ('synced', 'retry', 'needs_reconciliation')
  ),
  error_code TEXT,
  occurred_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS sync_delivery_attempts_no_update
BEFORE UPDATE ON sync_delivery_attempts
BEGIN
  SELECT RAISE(ABORT, 'sync delivery attempts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS sync_delivery_attempts_no_delete
BEFORE DELETE ON sync_delivery_attempts
BEGIN
  SELECT RAISE(ABORT, 'sync delivery attempts are immutable');
END;

CREATE TABLE IF NOT EXISTS sync_inbox_events (
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

CREATE TRIGGER IF NOT EXISTS sync_inbox_no_update
BEFORE UPDATE ON sync_inbox_events
BEGIN
  SELECT RAISE(ABORT, 'sync inbox envelopes are immutable');
END;

CREATE TRIGGER IF NOT EXISTS sync_inbox_no_delete
BEFORE DELETE ON sync_inbox_events
BEGIN
  SELECT RAISE(ABORT, 'sync inbox envelopes are immutable');
END;

CREATE TABLE IF NOT EXISTS sync_inbox_state (
  cloud_event_id TEXT PRIMARY KEY REFERENCES sync_inbox_events(cloud_event_id)
    ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'applied', 'duplicate', 'conflict', 'rejected')
  ),
  source_id TEXT,
  error_code TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_entity_versions (
  local_vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  event_kind TEXT NOT NULL CHECK (
    event_kind IN ('account_snapshot', 'holding_snapshot', 'reminder_snapshot')
  ),
  source_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  logical_clock INTEGER NOT NULL CHECK (logical_clock > 0),
  event_hash BLOB NOT NULL CHECK (length(event_hash) = 32),
  cloud_event_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (local_vault_id, event_kind, source_id)
);

CREATE TABLE IF NOT EXISTS sync_inbox_conflicts (
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

CREATE TRIGGER IF NOT EXISTS sync_inbox_conflicts_no_update
BEFORE UPDATE ON sync_inbox_conflicts
BEGIN
  SELECT RAISE(ABORT, 'sync inbox conflicts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS sync_inbox_conflicts_no_delete
BEFORE DELETE ON sync_inbox_conflicts
BEGIN
  SELECT RAISE(ABORT, 'sync inbox conflicts are immutable');
END;

CREATE TABLE IF NOT EXISTS sync_inbox_conflict_resolutions (
  id TEXT PRIMARY KEY,
  local_vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  conflict_id TEXT NOT NULL UNIQUE
    REFERENCES sync_inbox_conflicts(id) ON DELETE RESTRICT,
  resolution_action TEXT NOT NULL CHECK (resolution_action = 'keep_local'),
  confirmed_by TEXT NOT NULL CHECK (confirmed_by = 'local_user'),
  resolved_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sync_conflict_resolutions_vault_time
  ON sync_inbox_conflict_resolutions(local_vault_id, resolved_at, id);

CREATE TRIGGER IF NOT EXISTS sync_conflict_resolutions_no_update
BEFORE UPDATE ON sync_inbox_conflict_resolutions
BEGIN
  SELECT RAISE(ABORT, 'sync conflict resolutions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS sync_conflict_resolutions_no_delete
BEFORE DELETE ON sync_inbox_conflict_resolutions
BEGIN
  SELECT RAISE(ABORT, 'sync conflict resolutions are immutable');
END;

CREATE VIEW IF NOT EXISTS account_balances AS
SELECT
  vault_id,
  account_id,
  currency,
  SUM(delta_minor) AS balance_minor,
  MAX(occurred_at) AS last_event_at
FROM ledger_events
GROUP BY vault_id, account_id, currency;

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (1, 'initial_immutable_ledger', '2026-07-24T00:00:00.000Z');

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (4, 'encrypted_sync_outbox', '2026-07-26T14:40:00.000Z');

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (5, 'encrypted_domain_sync_and_inbox', '2026-07-26T18:00:00.000Z');

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (6, 'immutable_ai_proposal_evidence', '2026-07-26T20:00:00.000Z');

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (7, 'encrypted_planning_profile_and_events', '2026-07-27T12:00:00.000Z');

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (8, 'private_local_notification_schedule', '2026-07-27T18:00:00.000Z');

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (9, 'immutable_recurring_reminder_occurrences', '2026-07-27T20:00:00.000Z');

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (10, 'encrypted_holdings_and_immutable_valuations', '2026-07-27T22:00:00.000Z');

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (11, 'immutable_holding_operations', '2026-07-27T00:00:00.000Z');

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (12, 'immutable_holding_operation_corrections', '2026-07-27T00:00:00.000Z');

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (13, 'holding_operation_ai_proposals', '2026-07-27T00:00:00.000Z');

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (14, 'encrypted_holding_domain_sync', '2026-07-27T00:00:00.000Z');

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (15, 'immutable_sync_conflict_resolutions', '2026-07-27T00:00:00.000Z');

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (16, 'qq_email_read_only_ingestion', '2026-07-30T00:00:00.000Z');
