import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const schema = readFileSync(resolve(root, "db/schema.sql"), "utf8");

function runSql(sql) {
  return spawnSync("sqlite3", [":memory:"], {
    cwd: root,
    encoding: "utf8",
    input: `${schema}\n${sql}`,
  });
}

const fixtureSql = `
INSERT INTO vaults(id, display_name, base_currency, created_at)
VALUES ('vault-1', 'Test Vault', 'CNY', '2026-07-24T00:00:00.000Z');
INSERT INTO accounts(
  id, vault_id, institution_name, display_name, account_type, currency, created_at
) VALUES (
  'account-1', 'vault-1', 'Test Bank', 'Test Account', 'cash', 'CNY',
  '2026-07-24T00:00:00.000Z'
);
INSERT INTO ledger_events(
  id, vault_id, account_id, event_type, delta_minor, currency, occurred_at,
  status, idempotency_key, created_at
) VALUES (
  'event-1', 'vault-1', 'account-1', 'income', 1280000, 'CNY',
  '2026-07-24T00:00:00.000Z', 'confirmed', 'test:1',
  '2026-07-24T00:00:00.000Z'
);
`;

test("SQLite schema creates the immutable ledger and balance projection", () => {
  const result = runSql(`
${fixtureSql}
SELECT balance_minor FROM account_balances
WHERE vault_id = 'vault-1' AND account_id = 'account-1' AND currency = 'CNY';
`);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "1280000");
});

test("SQLite schema rejects in-place ledger updates", () => {
  const result = runSql(`
${fixtureSql}
UPDATE ledger_events SET delta_minor = 1 WHERE id = 'event-1';
`);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ledger_events are immutable/);
});

test("SQLite schema enforces idempotency per vault", () => {
  const result = runSql(`
${fixtureSql}
INSERT INTO ledger_events(
  id, vault_id, account_id, event_type, delta_minor, currency, occurred_at,
  status, idempotency_key, created_at
) VALUES (
  'event-2', 'vault-1', 'account-1', 'income', 1280000, 'CNY',
  '2026-07-24T00:00:00.000Z', 'confirmed', 'test:1',
  '2026-07-24T00:00:00.000Z'
);
`);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /UNIQUE constraint failed/);
});

test("SQLite account schema supports encrypted-at-rest account notes", () => {
  const result = runSql(`
SELECT count(*) FROM pragma_table_info('accounts') WHERE name = 'notes';
`);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "1");
});

test("SQLite holdings preserve immutable valuations without changing ledger balances", () => {
  const result = runSql(`
${fixtureSql}
INSERT INTO draft_changes(
  id, vault_id, source_type, status, proposed_events_json,
  evidence_json, created_at, confirmed_at, confirmed_by
) VALUES (
  'draft-holding', 'vault-1', 'manual_holding', 'confirmed',
  '{"kind":"holding.create"}', '[]',
  '2026-07-27T00:00:00.000Z', '2026-07-27T00:00:00.000Z', 'local_user'
);
INSERT INTO holdings(
  id, vault_id, account_id, name, product_type, currency, created_at
) VALUES (
  'holding-1', 'vault-1', 'account-1', 'Test Fund',
  'fund', 'CNY', '2026-07-27T00:00:00.000Z'
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
SELECT
  (SELECT count(*) FROM holdings WHERE vault_id = 'vault-1'),
  (SELECT count(*) FROM holding_valuations WHERE vault_id = 'vault-1'),
  (SELECT balance_minor FROM account_balances
   WHERE vault_id = 'vault-1' AND account_id = 'account-1');
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "1|1|1280000");

  const mutation = runSql(`
${fixtureSql}
INSERT INTO draft_changes(
  id, vault_id, source_type, status, proposed_events_json,
  evidence_json, created_at
) VALUES (
  'draft-holding', 'vault-1', 'manual_holding', 'confirmed',
  '{"kind":"holding.create"}', '[]', '2026-07-27T00:00:00.000Z'
);
INSERT INTO holdings(
  id, vault_id, account_id, name, product_type, currency, created_at
) VALUES (
  'holding-1', 'vault-1', 'account-1', 'Test Fund',
  'fund', 'CNY', '2026-07-27T00:00:00.000Z'
);
INSERT INTO holding_valuations(
  id, vault_id, holding_id, draft_id, units_micros,
  cost_basis_minor, market_value_minor, as_of_date,
  source_type, created_at
) VALUES (
  'valuation-1', 'vault-1', 'holding-1', 'draft-holding',
  1000000, 10000, 10200, '2026-07-27',
  'manual', '2026-07-27T00:00:00.000Z'
);
UPDATE holding_valuations SET market_value_minor = 1 WHERE id = 'valuation-1';
`);
  assert.notEqual(mutation.status, 0);
  assert.match(mutation.stderr, /holding valuations are immutable/);
});

test("SQLite holding operations are immutable and preserve explicit ledger linkage", () => {
  const result = runSql(`
${fixtureSql}
INSERT INTO draft_changes(
  id, vault_id, source_type, status, proposed_events_json,
  evidence_json, created_at, confirmed_at, confirmed_by
) VALUES (
  'draft-operation', 'vault-1', 'manual_holding_operation', 'confirmed',
  '{"kind":"holding_operation.create"}', '[]',
  '2026-07-27T00:00:00.000Z', '2026-07-27T00:00:00.000Z', 'local_user'
);
INSERT INTO holdings(
  id, vault_id, account_id, name, product_type, currency, created_at
) VALUES (
  'holding-1', 'vault-1', 'account-1', 'Test Fund',
  'fund', 'CNY', '2026-07-27T00:00:00.000Z'
);
INSERT INTO holding_valuations(
  id, vault_id, holding_id, draft_id, units_micros,
  cost_basis_minor, market_value_minor, as_of_date,
  source_type, created_at
) VALUES (
  'valuation-1', 'vault-1', 'holding-1', 'draft-operation',
  1000000, 10000, 10200, '2026-07-27',
  'manual', '2026-07-27T00:00:00.000Z'
);
INSERT INTO holding_operations(
  id, vault_id, holding_id, draft_id, operation_kind,
  amount_minor, currency, units_delta_micros, before_valuation_id,
  primary_ledger_event_id, occurred_on, description, created_at
) VALUES (
  'operation-1', 'vault-1', 'holding-1', 'draft-operation', 'dividend',
  500, 'CNY', 0, 'valuation-1', 'event-1',
  '2026-07-27', 'Test dividend', '2026-07-27T00:00:00.000Z'
);
SELECT operation_kind, amount_minor, primary_ledger_event_id
FROM holding_operations WHERE id = 'operation-1';
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "dividend|500|event-1");

  const mutation = runSql(`
${fixtureSql}
INSERT INTO draft_changes(
  id, vault_id, source_type, status, proposed_events_json,
  evidence_json, created_at
) VALUES (
  'draft-operation', 'vault-1', 'manual_holding_operation', 'confirmed',
  '{}', '[]', '2026-07-27T00:00:00.000Z'
);
INSERT INTO holdings(
  id, vault_id, account_id, name, product_type, currency, created_at
) VALUES (
  'holding-1', 'vault-1', 'account-1', 'Test Fund',
  'fund', 'CNY', '2026-07-27T00:00:00.000Z'
);
INSERT INTO holding_valuations(
  id, vault_id, holding_id, draft_id, units_micros,
  cost_basis_minor, market_value_minor, as_of_date, source_type, created_at
) VALUES (
  'valuation-1', 'vault-1', 'holding-1', 'draft-operation',
  1000000, 10000, 10200, '2026-07-27', 'manual',
  '2026-07-27T00:00:00.000Z'
);
INSERT INTO holding_operations(
  id, vault_id, holding_id, draft_id, operation_kind,
  amount_minor, currency, units_delta_micros, before_valuation_id,
  occurred_on, description, created_at
) VALUES (
  'operation-1', 'vault-1', 'holding-1', 'draft-operation', 'fee',
  100, 'CNY', 0, 'valuation-1', '2026-07-27', 'Fee',
  '2026-07-27T00:00:00.000Z'
);
UPDATE holding_operations SET amount_minor = 1 WHERE id = 'operation-1';
`);
  assert.notEqual(mutation.status, 0);
  assert.match(mutation.stderr, /holding operations are immutable/);
});

test("SQLite holding operation corrections link two immutable operations exactly once", () => {
  const fixture = `
${fixtureSql}
INSERT INTO draft_changes(
  id, vault_id, source_type, status, proposed_events_json,
  evidence_json, created_at, confirmed_at, confirmed_by
) VALUES
  ('draft-original', 'vault-1', 'manual_holding_operation', 'confirmed',
   '{}', '[]', '2026-07-27T00:00:00.000Z',
   '2026-07-27T00:00:00.000Z', 'local_user'),
  ('draft-reversal', 'vault-1', 'holding_operation_correction', 'confirmed',
   '{}', '[]', '2026-07-27T01:00:00.000Z',
   '2026-07-27T01:00:00.000Z', 'local_user');
INSERT INTO holdings(
  id, vault_id, account_id, name, product_type, currency, created_at
) VALUES (
  'holding-1', 'vault-1', 'account-1', 'Test Fund',
  'fund', 'CNY', '2026-07-27T00:00:00.000Z'
);
INSERT INTO holding_valuations(
  id, vault_id, holding_id, draft_id, units_micros,
  cost_basis_minor, market_value_minor, as_of_date,
  source_type, created_at
) VALUES (
  'valuation-1', 'vault-1', 'holding-1', 'draft-original',
  1000000, 10000, 10200, '2026-07-27',
  'manual', '2026-07-27T00:00:00.000Z'
);
INSERT INTO holding_operations(
  id, vault_id, holding_id, draft_id, operation_kind,
  amount_minor, currency, units_delta_micros,
  before_valuation_id, occurred_on, description, created_at
) VALUES
  ('operation-original', 'vault-1', 'holding-1', 'draft-original',
   'dividend', 500, 'CNY', 0, 'valuation-1', '2026-07-27', 'Dividend',
   '2026-07-27T00:00:00.000Z'),
  ('operation-reversal', 'vault-1', 'holding-1', 'draft-reversal',
   'fee', 500, 'CNY', 0, 'valuation-1', '2026-07-27', 'Reverse dividend',
   '2026-07-27T01:00:00.000Z');
INSERT INTO holding_operation_corrections(
  id, vault_id, draft_id, original_operation_id,
  compensating_operation_id, reason, created_at
) VALUES (
  'correction-1', 'vault-1', 'draft-reversal', 'operation-original',
  'operation-reversal', 'Duplicate dividend',
  '2026-07-27T01:00:00.000Z'
);
`;
  const result = runSql(`
${fixture}
SELECT original_operation_id, compensating_operation_id, reason
FROM holding_operation_corrections WHERE id = 'correction-1';
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    "operation-original|operation-reversal|Duplicate dividend",
  );

  const mutation = runSql(`
${fixture}
UPDATE holding_operation_corrections
SET reason = 'mutated' WHERE id = 'correction-1';
`);
  assert.notEqual(mutation.status, 0);
  assert.match(mutation.stderr, /holding operation corrections are immutable/);

  const duplicate = runSql(`
${fixture}
INSERT INTO draft_changes(
  id, vault_id, source_type, status, proposed_events_json,
  evidence_json, created_at
) VALUES (
  'draft-duplicate', 'vault-1', 'holding_operation_correction',
  'confirmed', '{}', '[]', '2026-07-27T02:00:00.000Z'
);
INSERT INTO holding_operations(
  id, vault_id, holding_id, draft_id, operation_kind,
  amount_minor, currency, units_delta_micros,
  before_valuation_id, occurred_on, description, created_at
) VALUES (
  'operation-duplicate', 'vault-1', 'holding-1', 'draft-duplicate',
  'fee', 500, 'CNY', 0, 'valuation-1', '2026-07-27', 'Duplicate reverse',
  '2026-07-27T02:00:00.000Z'
);
INSERT INTO holding_operation_corrections(
  id, vault_id, draft_id, original_operation_id,
  compensating_operation_id, reason, created_at
) VALUES (
  'correction-2', 'vault-1', 'draft-duplicate', 'operation-original',
  'operation-duplicate', 'Duplicate correction',
  '2026-07-27T02:00:00.000Z'
);
`);
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /UNIQUE constraint failed/);
});

test("SQLite reminder schema supports auditable update and archive lifecycle", () => {
  const result = runSql(`
SELECT
  (SELECT count(*) FROM pragma_table_info('reminders')
   WHERE name IN ('notes', 'archived_at')),
  instr((SELECT sql FROM sqlite_master
         WHERE type = 'table' AND name = 'reminder_events'), '''updated''') > 0,
  instr((SELECT sql FROM sqlite_master
         WHERE type = 'table' AND name = 'reminder_events'), '''archived''') > 0;
`);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "2|1|1");
});

test("SQLite recurring reminders preserve anchors and immutable occurrence history", () => {
  const result = runSql(`
INSERT INTO vaults(id, display_name, base_currency, created_at)
VALUES ('vault-reminder', 'Reminder Vault', 'CNY', '2026-07-27T00:00:00.000Z');
INSERT INTO reminders(
  id, vault_id, category, title, due_at, recurrence_rule,
  recurrence_anchor_month, recurrence_anchor_day, status, created_at, updated_at
) VALUES (
  'reminder-recurring', 'vault-reminder', 'custom', 'Month end review',
  '2026-02-28', 'monthly', 1, 31, 'active',
  '2026-01-31T00:00:00.000Z', '2026-01-31T00:00:00.000Z'
);
INSERT INTO reminder_occurrences(
  id, reminder_id, due_on, completed_at, next_due_on,
  confirmation_draft_id, created_at
) VALUES (
  'occurrence-1', 'reminder-recurring', '2026-01-31',
  '2026-01-31T10:00:00.000Z', '2026-02-28',
  'draft-1', '2026-01-31T10:00:00.000Z'
);
SELECT recurrence_anchor_day,
       (SELECT count(*) FROM reminder_occurrences
        WHERE reminder_id = 'reminder-recurring')
FROM reminders WHERE id = 'reminder-recurring';
`);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "31|1");

  const mutation = runSql(`
INSERT INTO vaults(id, display_name, base_currency, created_at)
VALUES ('vault-reminder', 'Reminder Vault', 'CNY', '2026-07-27T00:00:00.000Z');
INSERT INTO reminders(
  id, vault_id, category, title, due_at, status, created_at, updated_at
) VALUES (
  'reminder-recurring', 'vault-reminder', 'custom', 'Review',
  '2026-02-28', 'active',
  '2026-01-31T00:00:00.000Z', '2026-01-31T00:00:00.000Z'
);
INSERT INTO reminder_occurrences(
  id, reminder_id, due_on, completed_at,
  confirmation_draft_id, created_at
) VALUES (
  'occurrence-1', 'reminder-recurring', '2026-01-31',
  '2026-01-31T10:00:00.000Z', 'draft-1',
  '2026-01-31T10:00:00.000Z'
);
UPDATE reminder_occurrences SET completed_at = 'tampered'
WHERE id = 'occurrence-1';
`);
  assert.notEqual(mutation.status, 0);
  assert.match(mutation.stderr, /reminder occurrences are immutable/);
});

test("SQLite notification schedule is private, bounded, and derived from reminders", () => {
  const result = runSql(`
INSERT INTO vaults(id, display_name, base_currency, created_at)
VALUES ('vault-notify', 'Notify Vault', 'CNY', '2026-07-27T00:00:00.000Z');
INSERT INTO reminders(
  id, vault_id, category, title, due_at, status, created_at, updated_at
) VALUES (
  'reminder-notify', 'vault-notify', 'custom', 'Sensitive title',
  '2026-08-10', 'active', '2026-07-27T00:00:00.000Z',
  '2026-07-27T00:00:00.000Z'
);
INSERT INTO notification_preferences(
  vault_id, enabled, privacy_mode, delivery_hour, updated_at
) VALUES (
  'vault-notify', 1, 'generic', 9, '2026-07-27T00:00:00.000Z'
);
INSERT INTO notification_schedules(
  vault_id, reminder_id, request_identifier, scheduled_for_local,
  content_mode, reminder_version, updated_at
) VALUES (
  'vault-notify', 'reminder-notify', 'folio-opaque',
  '2026-08-10T09:00:00', 'generic', 'version-1',
  '2026-07-27T00:00:00.000Z'
);
SELECT
  (SELECT count(*) FROM notification_preferences),
  (SELECT count(*) FROM notification_schedules),
  (SELECT count(*) FROM pragma_table_info('notification_schedules')
   WHERE name IN ('amount_minor', 'account_name', 'notes'));
`);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "1|1|0");

  const invalidHour = runSql(`
INSERT INTO vaults(id, display_name, base_currency, created_at)
VALUES ('vault-notify', 'Notify Vault', 'CNY', '2026-07-27T00:00:00.000Z');
INSERT INTO notification_preferences(
  vault_id, enabled, privacy_mode, delivery_hour, updated_at
) VALUES ('vault-notify', 1, 'generic', 25, 'now');
`);
  assert.notEqual(invalidHour.status, 0);
  assert.match(invalidHour.stderr, /CHECK constraint failed/);
});

test("SQLite schema keeps sync envelopes encrypted and immutable", () => {
  const result = runSql(`
INSERT INTO vaults(id, display_name, base_currency, created_at)
VALUES ('vault-sync', 'Sync Vault', 'CNY', '2026-07-26T00:00:00.000Z');
INSERT INTO accounts(
  id, vault_id, institution_name, display_name, account_type, currency, created_at
) VALUES (
  'account-sync', 'vault-sync', 'Test Bank', 'Test Account', 'cash', 'CNY',
  '2026-07-26T00:00:00.000Z'
);
INSERT INTO ledger_events(
  id, vault_id, account_id, event_type, delta_minor, currency, occurred_at,
  status, idempotency_key, created_at
) VALUES (
  'event-sync', 'vault-sync', 'account-sync', 'opening_balance', 100, 'CNY',
  '2026-07-26T00:00:00.000Z', 'confirmed', 'fixture-sync-event',
  '2026-07-26T00:00:00.000Z'
);
INSERT INTO sync_outbox_events(
  cloud_event_id, local_vault_id, event_kind, source_id, source_version_id,
  device_id, logical_clock,
  idempotency_key, event_hash, payload_nonce, payload_ciphertext,
  aad_version, occurred_at, created_at
) VALUES (
  'cloud-event-sync', 'vault-sync', 'ledger_event', 'event-sync', 'event-sync',
  'device-sync', 1,
  'local-domain:ledger_event:event-sync:v2',
  zeroblob(32), zeroblob(24), zeroblob(32), 2,
  '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z'
);
UPDATE sync_outbox_events SET logical_clock = 2
WHERE cloud_event_id = 'cloud-event-sync';
`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sync outbox envelopes are immutable/);
});

test("SQLite encrypted sync accepts the complete holding domain and records migration 14", () => {
  const result = runSql(`
SELECT
  instr((SELECT sql FROM sqlite_master
         WHERE type = 'table' AND name = 'sync_outbox_events'),
        '''holding_snapshot''') > 0,
  instr((SELECT sql FROM sqlite_master
         WHERE type = 'table' AND name = 'sync_outbox_events'),
        '''holding_valuation''') > 0,
  instr((SELECT sql FROM sqlite_master
         WHERE type = 'table' AND name = 'sync_outbox_events'),
        '''holding_operation''') > 0,
  instr((SELECT sql FROM sqlite_master
         WHERE type = 'table' AND name = 'sync_outbox_events'),
        '''holding_operation_correction''') > 0,
  instr((SELECT sql FROM sqlite_master
         WHERE type = 'table' AND name = 'sync_entity_versions'),
        '''holding_snapshot''') > 0,
  EXISTS(
    SELECT 1 FROM schema_migrations
    WHERE version = 14 AND name = 'encrypted_holding_domain_sync'
  );
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "1|1|1|1|1|1");
});

test("SQLite sync conflict resolutions are append-only and record migration 15", () => {
  const fixture = `
INSERT INTO vaults(id, display_name, base_currency, created_at)
VALUES ('vault-conflict', 'Conflict Vault', 'CNY', '2026-07-27T00:00:00.000Z');
INSERT INTO sync_inbox_events(
  cloud_event_id, local_vault_id, event_kind, device_id, logical_clock,
  idempotency_key, event_hash, payload_nonce, payload_ciphertext,
  aad_version, occurred_at, received_at, recorded_at
) VALUES (
  'cloud-conflict', 'vault-conflict', 'account_snapshot', 'remote-device', 1,
  'account-conflict-idempotency', zeroblob(32), zeroblob(24), zeroblob(32),
  2, '2026-07-27T00:00:00.000Z', '2026-07-27T00:00:01.000Z',
  '2026-07-27T00:00:01.000Z'
);
INSERT INTO sync_inbox_conflicts(
  id, local_vault_id, cloud_event_id, event_kind, source_id,
  reason_code, details_json, occurred_at
) VALUES (
  'sync_conflict-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'vault-conflict', 'cloud-conflict', 'account_snapshot', 'account-1',
  'concurrent_edit', '{"requiresExplicitResolution":true}',
  '2026-07-27T00:00:02.000Z'
);
INSERT INTO sync_inbox_conflict_resolutions(
  id, local_vault_id, conflict_id, resolution_action,
  confirmed_by, resolved_at
) VALUES (
  'sync_resolution-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'vault-conflict', 'sync_conflict-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'keep_local', 'local_user', '2026-07-27T00:00:03.000Z'
);
`;
  const result = runSql(`
${fixture}
SELECT
  (SELECT resolution_action FROM sync_inbox_conflict_resolutions),
  EXISTS(
    SELECT 1 FROM schema_migrations
    WHERE version = 15 AND name = 'immutable_sync_conflict_resolutions'
  );
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "keep_local|1");

  const mutation = runSql(`
${fixture}
UPDATE sync_inbox_conflict_resolutions
SET resolution_action = 'keep_local';
`);
  assert.notEqual(mutation.status, 0);
  assert.match(mutation.stderr, /sync conflict resolutions are immutable/);

  const deletion = runSql(`
${fixture}
DELETE FROM sync_inbox_conflict_resolutions;
`);
  assert.notEqual(deletion.status, 0);
  assert.match(deletion.stderr, /sync conflict resolutions are immutable/);
});

test("SQLite schema keeps AI proposal evidence local, linked, and immutable", () => {
  const result = runSql(`
INSERT INTO vaults(id, display_name, base_currency, created_at)
VALUES ('vault-ai', 'AI Vault', 'CNY', '2026-07-26T00:00:00.000Z');
INSERT INTO draft_changes(
  id, vault_id, source_type, proposed_events_json,
  evidence_json, status, created_at
) VALUES (
  'draft-ai', 'vault-ai', 'manual_transaction',
  '{"transactionKind":"expense"}', '[]', 'needs_review',
  '2026-07-26T00:00:00.000Z'
);
INSERT INTO ai_proposals(
  id, vault_id, domain_draft_id, input_kind, proposal_kind,
  module_context, provider_id, parser_version, transcript,
  transcript_hash, confidence_bps, evidence_json, created_at
) VALUES (
  'proposal-ai', 'vault-ai', 'draft-ai', 'voice', 'transaction',
  'cashflow', 'local_rules_v1', 'zh-finance-rules-1',
  '虚构口述', zeroblob(32), 9000, '[]',
  '2026-07-26T00:00:00.000Z'
);
UPDATE ai_proposals SET transcript = '不可覆盖'
WHERE id = 'proposal-ai';
`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AI proposals are immutable/);
});

test("SQLite AI proposal schema accepts product operations and records migration 13", () => {
  const result = runSql(`
SELECT
  instr((SELECT sql FROM sqlite_master
         WHERE type = 'table' AND name = 'ai_proposals'),
        '''holding_operation''') > 0,
  EXISTS(
    SELECT 1 FROM schema_migrations
    WHERE version = 13 AND name = 'holding_operation_ai_proposals'
  );
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "1|1");
});

test("SQLite QQ email ingestion stores only config, fingerprints, and review links", () => {
  const result = runSql(`
${fixtureSql}
INSERT INTO email_sources(
  id, vault_id, provider, email_address, host, port, mailbox,
  account_id, allowed_senders_json, subject_keywords_json,
  last_uid, enabled, created_at, updated_at
) VALUES (
  'email-source-1', 'vault-1', 'qq_imap', 'fictional@qq.com',
  'imap.qq.com', 993, 'INBOX', 'account-1',
  '["cmbchina.com"]', '["消费提醒"]', 42, 1,
  '2026-07-30T00:00:00.000Z', '2026-07-30T00:00:00.000Z'
);
INSERT INTO draft_changes(
  id, vault_id, source_type, source_fingerprint, status,
  proposed_events_json, evidence_json, created_at
) VALUES (
  'email-draft-1', 'vault-1', 'email_transaction',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0',
  'needs_review', '{"kind":"transaction.create"}',
  '[{"rawMessagePersisted":false}]', '2026-07-30T00:00:00.000Z'
);
INSERT INTO email_receipts(
  id, vault_id, source_id, remote_uid, message_fingerprint,
  sender_domain, status, created_at
) VALUES (
  'email-receipt-1', 'vault-1', 'email-source-1', 42,
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'cmbchina.com', 'needs_review', '2026-07-30T00:00:00.000Z'
);
INSERT INTO email_receipt_items(
  id, receipt_id, item_index, transaction_draft_id, created_at
) VALUES (
  'email-item-1', 'email-receipt-1', 0, 'email-draft-1',
  '2026-07-30T00:00:00.000Z'
);
SELECT
  (SELECT count(*) FROM schema_migrations WHERE version = 16),
  (SELECT count(*) FROM email_sources),
  (SELECT count(*) FROM email_receipts),
  (SELECT count(*) FROM email_receipt_items),
  (SELECT count(*) FROM pragma_table_info('email_sources')
   WHERE lower(name) LIKE '%password%' OR lower(name) LIKE '%authorization%'),
  (SELECT count(*) FROM pragma_table_info('email_receipts')
   WHERE lower(name) LIKE '%body%' OR lower(name) LIKE '%content%'),
  (SELECT count(*) FROM ledger_events WHERE draft_id = 'email-draft-1');
`);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "1|1|1|1|0|0|0");

  const duplicate = runSql(`
${fixtureSql}
INSERT INTO email_sources(
  id, vault_id, provider, email_address, host, port, mailbox,
  account_id, allowed_senders_json, subject_keywords_json,
  last_uid, enabled, created_at, updated_at
) VALUES (
  'email-source-1', 'vault-1', 'qq_imap', 'fictional@qq.com',
  'imap.qq.com', 993, 'INBOX', 'account-1',
  '["cmbchina.com"]', '["消费提醒"]', 42, 1,
  '2026-07-30T00:00:00.000Z', '2026-07-30T00:00:00.000Z'
);
INSERT INTO email_receipts(
  id, vault_id, source_id, remote_uid, message_fingerprint,
  sender_domain, status, created_at
) VALUES (
  'email-receipt-1', 'vault-1', 'email-source-1', 42,
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'cmbchina.com', 'needs_review', '2026-07-30T00:00:00.000Z'
);
INSERT INTO email_receipts(
  id, vault_id, source_id, remote_uid, message_fingerprint,
  sender_domain, status, created_at
) VALUES (
  'email-receipt-2', 'vault-1', 'email-source-1', 43,
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'cmbchina.com', 'needs_review', '2026-07-30T00:00:01.000Z'
);
`);
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /UNIQUE constraint failed/);
});

test("AI proposal storage cannot write ledger rows without explicit domain confirmation", () => {
  const result = runSql(`
INSERT INTO vaults(id, display_name, base_currency, created_at)
VALUES ('vault-ai', 'AI Vault', 'CNY', '2026-07-26T00:00:00.000Z');
INSERT INTO draft_changes(
  id, vault_id, source_type, proposed_events_json,
  evidence_json, status, created_at
) VALUES (
  'draft-ai', 'vault-ai', 'manual_transaction',
  '{"transactionKind":"expense"}', '[]', 'needs_review',
  '2026-07-26T00:00:00.000Z'
);
INSERT INTO ai_proposals(
  id, vault_id, domain_draft_id, input_kind, proposal_kind,
  module_context, provider_id, parser_version, transcript,
  transcript_hash, confidence_bps, evidence_json, created_at
) VALUES (
  'proposal-ai', 'vault-ai', 'draft-ai', 'text', 'transaction',
  'cashflow', 'local_rules_v1', 'zh-finance-rules-1',
  '虚构口述', zeroblob(32), 9000, '[]',
  '2026-07-26T00:00:00.000Z'
);
SELECT
  (SELECT count(*) FROM ai_proposals),
  (SELECT count(*) FROM ledger_events),
  (SELECT status FROM draft_changes WHERE id = 'draft-ai');
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "1|0|needs_review");
});

test("SQLite planning history is immutable and cannot mutate ledger balances", () => {
  const result = runSql(`
INSERT INTO vaults(id, display_name, base_currency, created_at)
VALUES ('vault-plan', 'Planning Vault', 'CNY', '2026-07-27T00:00:00.000Z');
INSERT INTO draft_changes(
  id, vault_id, source_type, proposed_events_json,
  evidence_json, status, created_at
) VALUES (
  'draft-plan', 'vault-plan', 'manual_planning',
  '{"kind":"planning.save"}', '[]', 'confirmed',
  '2026-07-27T00:00:00.000Z'
);
INSERT INTO planning_profiles(
  id, vault_id, name, base_currency, cash_buffer_minor,
  allocations_json, version_id, created_at, updated_at
) VALUES (
  'profile-plan', 'vault-plan', '长期规划', 'CNY', 8000000,
  '[{"category":"cash","targetBps":10000}]', 'version-plan',
  '2026-07-27T00:00:00.000Z', '2026-07-27T00:00:00.000Z'
);
INSERT INTO planning_events(
  id, vault_id, profile_id, draft_id, action, before_json,
  after_json, occurred_at
) VALUES (
  'planning-event-1', 'vault-plan', 'profile-plan', 'draft-plan',
  'created', NULL, '{"cashBufferMinor":8000000}',
  '2026-07-27T00:00:00.000Z'
);
UPDATE planning_events SET action = 'updated' WHERE id = 'planning-event-1';
`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /planning_events are immutable/);

  const noLedgerWrite = runSql(`
INSERT INTO vaults(id, display_name, base_currency, created_at)
VALUES ('vault-plan', 'Planning Vault', 'CNY', '2026-07-27T00:00:00.000Z');
INSERT INTO planning_profiles(
  id, vault_id, name, base_currency, cash_buffer_minor,
  allocations_json, version_id, created_at, updated_at
) VALUES (
  'profile-plan', 'vault-plan', '长期规划', 'CNY', 8000000,
  '[{"category":"cash","targetBps":10000}]', 'version-plan',
  '2026-07-27T00:00:00.000Z', '2026-07-27T00:00:00.000Z'
);
SELECT
  (SELECT count(*) FROM planning_profiles),
  (SELECT count(*) FROM ledger_events);
`);
  assert.equal(noLedgerWrite.status, 0, noLedgerWrite.stderr);
  assert.equal(noLedgerWrite.stdout.trim(), "1|0");
});
