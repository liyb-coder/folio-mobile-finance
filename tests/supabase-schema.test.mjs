import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260726142108_m3_encrypted_sync.sql",
  import.meta.url,
);
const holdingMigrationUrl = new URL(
  "../supabase/migrations/20260726215708_encrypted_holding_domain_sync.sql",
  import.meta.url,
);

test("every exposed Folio sync table has RLS enabled and forced", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const tables = [
    "profiles",
    "vaults",
    "vault_memberships",
    "devices",
    "device_key_envelopes",
    "encrypted_sync_events",
    "encrypted_sync_conflicts",
    "encrypted_conflict_resolutions",
    "encrypted_attachment_manifests",
  ];
  for (const table of tables) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`alter table public\\.${table} force row level security`, "i"));
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from anon`, "i"));
  }
});

test("immutable cloud domain events grant only select and insert", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(
    sql,
    /grant select, insert on public\.encrypted_sync_events to authenticated/i,
  );
  assert.doesNotMatch(
    sql,
    /grant [^;]*(update|delete)[^;]*encrypted_sync_events/i,
  );
  assert.doesNotMatch(
    sql,
    /on public\.encrypted_sync_events for (update|delete)/i,
  );
  assert.match(sql, /unique \(vault_id, idempotency_key\)/i);
  for (const eventKind of [
    "account_snapshot",
    "holding_snapshot",
    "holding_valuation",
    "ledger_event",
    "holding_operation",
    "holding_operation_correction",
    "reminder_snapshot",
  ]) {
    assert.match(sql, new RegExp(`'${eventKind}'`, "i"));
  }
  assert.match(sql, /aad_version integer not null default 2 check \(aad_version = 2\)/i);
});

test("holding-domain upgrade changes only the opaque event-kind constraint", async () => {
  const sql = await readFile(holdingMigrationUrl, "utf8");
  assert.match(
    sql,
    /alter table public\.encrypted_sync_events\s+drop constraint if exists encrypted_sync_events_event_kind_check/i,
  );
  assert.match(
    sql,
    /add constraint encrypted_sync_events_event_kind_check\s+check/i,
  );
  assert.match(sql, /check \([\s\S]*\) not valid;/i);
  assert.match(
    sql,
    /validate constraint encrypted_sync_events_event_kind_check/i,
  );
  assert.match(sql, /set lock_timeout = '5s'/i);
  for (const eventKind of [
    "account_snapshot",
    "holding_snapshot",
    "holding_valuation",
    "ledger_event",
    "holding_operation",
    "holding_operation_correction",
    "reminder_snapshot",
  ]) {
    assert.match(sql, new RegExp(`'${eventKind}'`, "i"));
  }
  assert.doesNotMatch(
    sql,
    /\b(account_name|holding_name|amount_minor|market_value_minor|notes|payload_json)\b/i,
  );
  assert.doesNotMatch(sql, /\b(grant|create policy|disable row level security)\b/i);
});

test("storage is private and scoped by user plus active vault membership", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /'folio-private',\s*'folio-private',\s*false/i);
  assert.match(sql, /\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/i);
  assert.match(sql, /membership\.membership_status = 'active'/i);
  assert.doesNotMatch(sql, /service_role/i);
  assert.doesNotMatch(sql, /raw_user_meta_data|user_metadata/i);
});

test("vault bootstrap is atomic, invoker-safe, and never accepts plaintext", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /function public\.bootstrap_encrypted_vault/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /set search_path = ''/i);
  assert.doesNotMatch(sql, /security definer/i);
  assert.match(sql, /p_encrypted_name bytea/i);
  assert.doesNotMatch(sql, /p_display_name|p_balance|p_amount|p_notes/i);
  assert.match(
    sql,
    /revoke all on function public\.bootstrap_encrypted_vault[\s\S]*from public, anon/i,
  );
});
