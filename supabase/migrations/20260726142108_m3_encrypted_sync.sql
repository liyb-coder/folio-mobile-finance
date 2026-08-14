-- Folio M3: identity-scoped, end-to-end encrypted sync.
--
-- The cloud database deliberately stores no account names, balances, notes,
-- reminder titles, attachment bodies, or other financial plaintext. Clients
-- encrypt event payloads and attachment metadata before upload.

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vaults (
  id uuid primary key,
  created_by uuid not null references auth.users(id) on delete restrict,
  cipher_suite text not null default 'xchacha20poly1305-v1'
    check (cipher_suite = 'xchacha20poly1305-v1'),
  key_version integer not null default 1 check (key_version > 0),
  encrypted_name bytea not null check (octet_length(encrypted_name) between 17 and 512),
  name_nonce bytea not null check (octet_length(name_nonce) = 24),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.vault_memberships (
  vault_id uuid not null references public.vaults(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null check (member_role in ('owner', 'member')),
  membership_status text not null default 'active'
    check (membership_status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (vault_id, user_id),
  check (
    (membership_status = 'active' and revoked_at is null)
    or (membership_status = 'revoked' and revoked_at is not null)
  )
);

create table public.devices (
  id uuid primary key,
  vault_id uuid not null references public.vaults(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('web', 'macos', 'ios', 'android')),
  public_key bytea not null check (octet_length(public_key) between 32 and 128),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  unique (vault_id, id, user_id)
);

create table public.device_key_envelopes (
  id uuid primary key,
  vault_id uuid not null references public.vaults(id) on delete cascade,
  device_id uuid not null,
  sender_device_id uuid not null references public.devices(id) on delete restrict,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  key_version integer not null check (key_version > 0),
  wrap_algorithm text not null default 'x25519-xchacha20poly1305-v1'
    check (wrap_algorithm = 'x25519-xchacha20poly1305-v1'),
  nonce bytea not null check (octet_length(nonce) = 24),
  wrapped_key bytea not null check (octet_length(wrapped_key) between 48 and 512),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (vault_id, device_id, recipient_user_id)
    references public.devices(vault_id, id, user_id) on delete cascade,
  unique (vault_id, device_id, key_version)
);

create table public.encrypted_sync_events (
  event_id uuid primary key,
  vault_id uuid not null references public.vaults(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete restrict,
  event_kind text not null check (
    event_kind in (
      'account_snapshot', 'holding_snapshot', 'holding_valuation',
      'ledger_event', 'holding_operation',
      'holding_operation_correction', 'reminder_snapshot'
    )
  ),
  logical_clock bigint not null check (logical_clock > 0),
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 160),
  event_hash bytea not null check (octet_length(event_hash) = 32),
  previous_event_hash bytea check (
    previous_event_hash is null or octet_length(previous_event_hash) = 32
  ),
  payload_nonce bytea not null check (octet_length(payload_nonce) = 24),
  payload_ciphertext bytea not null
    check (octet_length(payload_ciphertext) between 17 and 1048576),
  aad_version integer not null default 2 check (aad_version = 2),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique (vault_id, idempotency_key),
  unique (vault_id, device_id, logical_clock),
  unique (vault_id, event_hash)
);

create table public.encrypted_sync_conflicts (
  conflict_id uuid primary key,
  vault_id uuid not null references public.vaults(id) on delete cascade,
  detected_by_device_id uuid not null references public.devices(id) on delete restrict,
  local_event_id uuid not null references public.encrypted_sync_events(event_id),
  remote_event_id uuid not null references public.encrypted_sync_events(event_id),
  reason_code text not null check (
    reason_code in ('concurrent_edit', 'hash_gap', 'duplicate_semantic_event')
  ),
  details_nonce bytea not null check (octet_length(details_nonce) = 24),
  details_ciphertext bytea not null
    check (octet_length(details_ciphertext) between 17 and 65536),
  created_at timestamptz not null default now(),
  unique (vault_id, local_event_id, remote_event_id)
);

create table public.encrypted_conflict_resolutions (
  resolution_id uuid primary key,
  vault_id uuid not null references public.vaults(id) on delete cascade,
  conflict_id uuid not null references public.encrypted_sync_conflicts(conflict_id),
  device_id uuid not null references public.devices(id) on delete restrict,
  resolution_nonce bytea not null check (octet_length(resolution_nonce) = 24),
  resolution_ciphertext bytea not null
    check (octet_length(resolution_ciphertext) between 17 and 65536),
  created_at timestamptz not null default now(),
  unique (vault_id, conflict_id)
);

create table public.encrypted_attachment_manifests (
  attachment_id uuid primary key,
  vault_id uuid not null references public.vaults(id) on delete cascade,
  uploader_device_id uuid not null references public.devices(id) on delete restrict,
  object_path text not null unique
    check (char_length(object_path) between 10 and 300),
  byte_length bigint not null check (byte_length between 1 and 10485760),
  content_hash bytea not null check (octet_length(content_hash) = 32),
  metadata_nonce bytea not null check (octet_length(metadata_nonce) = 24),
  metadata_ciphertext bytea not null
    check (octet_length(metadata_ciphertext) between 17 and 65536),
  created_at timestamptz not null default now(),
  unique (vault_id, content_hash)
);

create index vault_memberships_user_active
  on public.vault_memberships(user_id, vault_id)
  where membership_status = 'active';
create index devices_user_vault
  on public.devices(user_id, vault_id)
  where revoked_at is null;
create index key_envelopes_recipient
  on public.device_key_envelopes(recipient_user_id, vault_id, key_version)
  where revoked_at is null;
create index encrypted_events_incremental_sync
  on public.encrypted_sync_events(vault_id, received_at, event_id);
create index encrypted_conflicts_vault_time
  on public.encrypted_sync_conflicts(vault_id, created_at, conflict_id);
create index encrypted_attachments_vault_time
  on public.encrypted_attachment_manifests(vault_id, created_at, attachment_id);

alter table public.profiles enable row level security;
alter table public.vaults enable row level security;
alter table public.vault_memberships enable row level security;
alter table public.devices enable row level security;
alter table public.device_key_envelopes enable row level security;
alter table public.encrypted_sync_events enable row level security;
alter table public.encrypted_sync_conflicts enable row level security;
alter table public.encrypted_conflict_resolutions enable row level security;
alter table public.encrypted_attachment_manifests enable row level security;

alter table public.profiles force row level security;
alter table public.vaults force row level security;
alter table public.vault_memberships force row level security;
alter table public.devices force row level security;
alter table public.device_key_envelopes force row level security;
alter table public.encrypted_sync_events force row level security;
alter table public.encrypted_sync_conflicts force row level security;
alter table public.encrypted_conflict_resolutions force row level security;
alter table public.encrypted_attachment_manifests force row level security;

create policy profiles_select_own
  on public.profiles for select to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()));
create policy profiles_insert_own
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) is not null and user_id = (select auth.uid()));
create policy profiles_update_own
  on public.profiles for update to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()))
  with check ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy vaults_select_member
  on public.vaults for select to authenticated
  using (
    (select auth.uid()) is not null
    and (
      created_by = (select auth.uid())
      or exists (
        select 1
        from public.vault_memberships membership
        where membership.vault_id = vaults.id
          and membership.user_id = (select auth.uid())
          and membership.membership_status = 'active'
      )
    )
  );
create policy vaults_insert_creator
  on public.vaults for insert to authenticated
  with check (
    (select auth.uid()) is not null
    and created_by = (select auth.uid())
  );
create policy vaults_update_owner
  on public.vaults for update to authenticated
  using (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.vault_memberships membership
      where membership.vault_id = vaults.id
        and membership.user_id = (select auth.uid())
        and membership.member_role = 'owner'
        and membership.membership_status = 'active'
    )
  )
  with check (created_by = (select auth.uid()));

create policy memberships_select_own
  on public.vault_memberships for select to authenticated
  using (
    (select auth.uid()) is not null
    and user_id = (select auth.uid())
  );
create policy memberships_insert_initial_owner
  on public.vault_memberships for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and member_role = 'owner'
    and membership_status = 'active'
    and exists (
      select 1 from public.vaults
      where vaults.id = vault_memberships.vault_id
        and vaults.created_by = (select auth.uid())
    )
  );

create policy devices_select_own
  on public.devices for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.vault_memberships membership
      where membership.vault_id = devices.vault_id
        and membership.user_id = (select auth.uid())
        and membership.membership_status = 'active'
    )
  );
create policy devices_insert_own
  on public.devices for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and revoked_at is null
    and exists (
      select 1 from public.vault_memberships membership
      where membership.vault_id = devices.vault_id
        and membership.user_id = (select auth.uid())
        and membership.membership_status = 'active'
    )
  );
create policy devices_update_own
  on public.devices for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.vault_memberships membership
      where membership.vault_id = devices.vault_id
        and membership.user_id = (select auth.uid())
        and membership.membership_status = 'active'
    )
  );

create policy key_envelopes_select_recipient
  on public.device_key_envelopes for select to authenticated
  using (
    recipient_user_id = (select auth.uid())
    and exists (
      select 1 from public.vault_memberships membership
      where membership.vault_id = device_key_envelopes.vault_id
        and membership.user_id = (select auth.uid())
        and membership.membership_status = 'active'
    )
  );
create policy key_envelopes_insert_self
  on public.device_key_envelopes for insert to authenticated
  with check (
    recipient_user_id = (select auth.uid())
    and created_by = (select auth.uid())
    and revoked_at is null
    and exists (
      select 1 from public.devices sender
      where sender.id = device_key_envelopes.sender_device_id
        and sender.vault_id = device_key_envelopes.vault_id
        and sender.user_id = (select auth.uid())
        and sender.revoked_at is null
    )
    and exists (
      select 1 from public.vault_memberships membership
      where membership.vault_id = device_key_envelopes.vault_id
        and membership.user_id = (select auth.uid())
        and membership.membership_status = 'active'
    )
  );

create policy encrypted_events_select_member
  on public.encrypted_sync_events for select to authenticated
  using (
    exists (
      select 1 from public.vault_memberships membership
      where membership.vault_id = encrypted_sync_events.vault_id
        and membership.user_id = (select auth.uid())
        and membership.membership_status = 'active'
    )
  );
create policy encrypted_events_insert_member_device
  on public.encrypted_sync_events for insert to authenticated
  with check (
    exists (
      select 1 from public.devices device
      where device.id = encrypted_sync_events.device_id
        and device.vault_id = encrypted_sync_events.vault_id
        and device.user_id = (select auth.uid())
        and device.revoked_at is null
    )
    and exists (
      select 1 from public.vault_memberships membership
      where membership.vault_id = encrypted_sync_events.vault_id
        and membership.user_id = (select auth.uid())
        and membership.membership_status = 'active'
    )
  );

create policy sync_conflicts_select_member
  on public.encrypted_sync_conflicts for select to authenticated
  using (
    exists (
      select 1 from public.vault_memberships membership
      where membership.vault_id = encrypted_sync_conflicts.vault_id
        and membership.user_id = (select auth.uid())
        and membership.membership_status = 'active'
    )
  );
create policy sync_conflicts_insert_member_device
  on public.encrypted_sync_conflicts for insert to authenticated
  with check (
    exists (
      select 1 from public.devices device
      where device.id = encrypted_sync_conflicts.detected_by_device_id
        and device.vault_id = encrypted_sync_conflicts.vault_id
        and device.user_id = (select auth.uid())
        and device.revoked_at is null
    )
  );

create policy conflict_resolutions_select_member
  on public.encrypted_conflict_resolutions for select to authenticated
  using (
    exists (
      select 1 from public.vault_memberships membership
      where membership.vault_id = encrypted_conflict_resolutions.vault_id
        and membership.user_id = (select auth.uid())
        and membership.membership_status = 'active'
    )
  );
create policy conflict_resolutions_insert_member_device
  on public.encrypted_conflict_resolutions for insert to authenticated
  with check (
    exists (
      select 1 from public.devices device
      where device.id = encrypted_conflict_resolutions.device_id
        and device.vault_id = encrypted_conflict_resolutions.vault_id
        and device.user_id = (select auth.uid())
        and device.revoked_at is null
    )
  );

create policy attachment_manifests_select_member
  on public.encrypted_attachment_manifests for select to authenticated
  using (
    exists (
      select 1 from public.vault_memberships membership
      where membership.vault_id = encrypted_attachment_manifests.vault_id
        and membership.user_id = (select auth.uid())
        and membership.membership_status = 'active'
    )
  );
create policy attachment_manifests_insert_member_device
  on public.encrypted_attachment_manifests for insert to authenticated
  with check (
    object_path like (select auth.uid())::text || '/' || vault_id::text || '/%'
    and exists (
      select 1 from public.devices device
      where device.id = encrypted_attachment_manifests.uploader_device_id
        and device.vault_id = encrypted_attachment_manifests.vault_id
        and device.user_id = (select auth.uid())
        and device.revoked_at is null
    )
  );

revoke all on public.profiles from anon;
revoke all on public.vaults from anon;
revoke all on public.vault_memberships from anon;
revoke all on public.devices from anon;
revoke all on public.device_key_envelopes from anon;
revoke all on public.encrypted_sync_events from anon;
revoke all on public.encrypted_sync_conflicts from anon;
revoke all on public.encrypted_conflict_resolutions from anon;
revoke all on public.encrypted_attachment_manifests from anon;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.vaults to authenticated;
grant select, insert on public.vault_memberships to authenticated;
grant select, insert, update on public.devices to authenticated;
grant select, insert on public.device_key_envelopes to authenticated;
grant select, insert on public.encrypted_sync_events to authenticated;
grant select, insert on public.encrypted_sync_conflicts to authenticated;
grant select, insert on public.encrypted_conflict_resolutions to authenticated;
grant select, insert on public.encrypted_attachment_manifests to authenticated;

create or replace function public.bootstrap_encrypted_vault(
  p_vault_id uuid,
  p_encrypted_name bytea,
  p_name_nonce bytea,
  p_device_id uuid,
  p_platform text,
  p_public_key bytea,
  p_key_envelope_id uuid,
  p_envelope_nonce bytea,
  p_wrapped_key bytea,
  p_key_version integer default 1
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.vaults where id = p_vault_id
  ) then
    if exists (
      select 1
      from public.vaults vault
      join public.vault_memberships membership
        on membership.vault_id = vault.id
      join public.devices device
        on device.vault_id = vault.id
      join public.device_key_envelopes envelope
        on envelope.vault_id = vault.id
      where vault.id = p_vault_id
        and vault.created_by = caller_id
        and vault.key_version = p_key_version
        and vault.encrypted_name = p_encrypted_name
        and vault.name_nonce = p_name_nonce
        and membership.user_id = caller_id
        and membership.member_role = 'owner'
        and membership.membership_status = 'active'
        and device.id = p_device_id
        and device.user_id = caller_id
        and device.platform = p_platform
        and device.public_key = p_public_key
        and envelope.id = p_key_envelope_id
        and envelope.device_id = p_device_id
        and envelope.sender_device_id = p_device_id
        and envelope.recipient_user_id = caller_id
        and envelope.nonce = p_envelope_nonce
        and envelope.wrapped_key = p_wrapped_key
    ) then
      return;
    end if;
    raise exception 'vault bootstrap collision' using errcode = '23505';
  end if;

  insert into public.vaults(
    id, created_by, key_version, encrypted_name, name_nonce
  ) values (
    p_vault_id, caller_id, p_key_version, p_encrypted_name, p_name_nonce
  );

  insert into public.vault_memberships(
    vault_id, user_id, member_role, membership_status
  ) values (
    p_vault_id, caller_id, 'owner', 'active'
  );

  insert into public.devices(
    id, vault_id, user_id, platform, public_key
  ) values (
    p_device_id, p_vault_id, caller_id, p_platform, p_public_key
  );

  insert into public.device_key_envelopes(
    id, vault_id, device_id, sender_device_id, recipient_user_id,
    created_by, key_version, nonce, wrapped_key
  ) values (
    p_key_envelope_id, p_vault_id, p_device_id, p_device_id, caller_id,
    caller_id, p_key_version, p_envelope_nonce, p_wrapped_key
  );
end;
$$;

revoke all on function public.bootstrap_encrypted_vault(
  uuid, bytea, bytea, uuid, text, bytea, uuid, bytea, bytea, integer
) from public, anon;
grant execute on function public.bootstrap_encrypted_vault(
  uuid, bytea, bytea, uuid, text, bytea, uuid, bytea, bytea, integer
) to authenticated;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) values (
  'folio-private',
  'folio-private',
  false,
  10485760,
  array[
    'application/octet-stream',
    'application/pdf',
    'image/jpeg',
    'image/png',
    'text/csv'
  ]
) on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy folio_storage_select_member
  on storage.objects for select to authenticated
  using (
    bucket_id = 'folio-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.vault_memberships membership
      where membership.vault_id::text = (storage.foldername(name))[2]
        and membership.user_id = (select auth.uid())
        and membership.membership_status = 'active'
    )
  );
create policy folio_storage_insert_member
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'folio-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.vault_memberships membership
      where membership.vault_id::text = (storage.foldername(name))[2]
        and membership.user_id = (select auth.uid())
        and membership.membership_status = 'active'
    )
  );
create policy folio_storage_update_member
  on storage.objects for update to authenticated
  using (
    bucket_id = 'folio-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'folio-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.vault_memberships membership
      where membership.vault_id::text = (storage.foldername(name))[2]
        and membership.user_id = (select auth.uid())
        and membership.membership_status = 'active'
    )
  );
create policy folio_storage_delete_member
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'folio-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.vault_memberships membership
      where membership.vault_id::text = (storage.foldername(name))[2]
        and membership.user_id = (select auth.uid())
        and membership.membership_status = 'active'
    )
  );
