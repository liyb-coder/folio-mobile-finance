begin;
select plan(8);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'authenticated', 'authenticated', 'a@example.test', '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'authenticated', 'authenticated', 'b@example.test', '', now(), now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
insert into public.vaults(
  id, created_by, encrypted_name, name_nonce
) values (
  'a1000000-0000-4000-8000-000000000000',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  decode(repeat('11', 32), 'hex'),
  decode(repeat('12', 24), 'hex')
);
insert into public.vault_memberships(vault_id, user_id, member_role)
values (
  'a1000000-0000-4000-8000-000000000000',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'owner'
);
insert into public.devices(id, vault_id, user_id, platform, public_key)
values (
  'a2000000-0000-4000-8000-000000000000',
  'a1000000-0000-4000-8000-000000000000',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'web',
  decode(repeat('13', 32), 'hex')
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
insert into public.vaults(
  id, created_by, encrypted_name, name_nonce
) values (
  'b1000000-0000-4000-8000-000000000000',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  decode(repeat('21', 32), 'hex'),
  decode(repeat('22', 24), 'hex')
);
insert into public.vault_memberships(vault_id, user_id, member_role)
values (
  'b1000000-0000-4000-8000-000000000000',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'owner'
);
insert into public.devices(id, vault_id, user_id, platform, public_key)
values (
  'b2000000-0000-4000-8000-000000000000',
  'b1000000-0000-4000-8000-000000000000',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'web',
  decode(repeat('23', 32), 'hex')
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);

select is(
  (select count(*) from public.vaults),
  1::bigint,
  'user A sees only their own vault'
);
select is(
  (select count(*) from public.vault_memberships),
  1::bigint,
  'user A sees only their own membership'
);
select is(
  (select count(*) from public.devices),
  1::bigint,
  'user A sees only their own devices'
);
select throws_ok(
  $$
    insert into public.encrypted_sync_events(
      event_id, vault_id, device_id, event_kind, logical_clock, idempotency_key,
      event_hash, payload_nonce, payload_ciphertext, occurred_at
    ) values (
      'b3000000-0000-4000-8000-000000000000',
      'b1000000-0000-4000-8000-000000000000',
      'b2000000-0000-4000-8000-000000000000',
      'ledger_event', 1, 'cross-user-attempt-0001',
      decode(repeat('31', 32), 'hex'),
      decode(repeat('32', 24), 'hex'),
      decode(repeat('33', 32), 'hex'),
      now()
    )
  $$,
  '42501',
  null,
  'user A cannot insert an event into user B vault'
);
select lives_ok(
  $$
    insert into public.encrypted_sync_events(
      event_id, vault_id, device_id, event_kind, logical_clock, idempotency_key,
      event_hash, payload_nonce, payload_ciphertext, occurred_at
    ) values (
      'a3000000-0000-4000-8000-000000000000',
      'a1000000-0000-4000-8000-000000000000',
      'a2000000-0000-4000-8000-000000000000',
      'account_snapshot', 1, 'own-user-event-0001',
      decode(repeat('41', 32), 'hex'),
      decode(repeat('42', 24), 'hex'),
      decode(repeat('43', 32), 'hex'),
      now()
    )
  $$,
  'user A can append an encrypted event to their own vault'
);
select is(
  (select count(*) from public.encrypted_sync_events),
  1::bigint,
  'user A cannot read user B encrypted events'
);
select throws_ok(
  $$ delete from public.encrypted_sync_events
     where event_id = 'a3000000-0000-4000-8000-000000000000' $$,
  '42501',
  null,
  'confirmed encrypted events cannot be deleted by clients'
);
select throws_ok(
  $$ update public.encrypted_sync_events
     set logical_clock = 2
     where event_id = 'a3000000-0000-4000-8000-000000000000' $$,
  '42501',
  null,
  'confirmed encrypted events cannot be updated by clients'
);

select * from finish();
rollback;
