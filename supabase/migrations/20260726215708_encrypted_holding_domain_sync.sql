-- Folio M3 follow-up: allow the complete encrypted holding-domain event stream.
--
-- This migration changes only an opaque event discriminator. Financial domain
-- payloads remain XChaCha20-Poly1305 ciphertext, and the existing RLS and
-- immutable select/insert-only permission model remain unchanged.

set lock_timeout = '5s';

alter table public.encrypted_sync_events
  drop constraint if exists encrypted_sync_events_event_kind_check;

alter table public.encrypted_sync_events
  add constraint encrypted_sync_events_event_kind_check
  check (
    event_kind in (
      'account_snapshot', 'holding_snapshot', 'holding_valuation',
      'ledger_event', 'holding_operation',
      'holding_operation_correction', 'reminder_snapshot'
    )
  ) not valid;

alter table public.encrypted_sync_events
  validate constraint encrypted_sync_events_event_kind_check;

reset lock_timeout;
