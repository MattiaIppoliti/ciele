-- Read-only Application knowledge connectors (#794): Organization-owned
-- authorizations, configured Imports, stable remote-item Source mappings,
-- durable sync reports, and Assistant scope. Provider adapters normalize data;
-- these tables own tenant isolation and synchronization state.

alter table public.sources drop constraint if exists sources_kind_check;
alter table public.sources
  add constraint sources_kind_check
  check (kind in ('file', 'url', 'text', 'website', 'application', 'faq'));

alter table public.background_jobs
  drop constraint if exists background_jobs_kind_check;
alter table public.background_jobs
  add constraint background_jobs_kind_check
  check (kind in (
    'ingest_source',
    'graph_sync_concept',
    'draft_improvement_proposal',
    'promote_memories',
    'distill_agent_memory',
    'sync_entity_records',
    'sync_application_import'
  ));

create or replace function public.reorder_assistant_flows(
  p_assistant_id text,
  p_ordered_ids text[]
) returns void
language plpgsql security invoker
set search_path = public
as $$
declare expected_count integer;
begin
  select count(*) into expected_count
  from public.flows where assistant_id = p_assistant_id and not is_default;
  if cardinality(p_ordered_ids) <> expected_count
    or cardinality(p_ordered_ids) <> cardinality(array(select distinct unnest(p_ordered_ids)))
    or exists (
      select 1 from unnest(p_ordered_ids) flow_id
      where not exists (
        select 1 from public.flows
        where id = flow_id and assistant_id = p_assistant_id and not is_default
      )
    )
  then
    raise exception 'Flow order must contain every non-default Flow exactly once';
  end if;
  update public.flows flow
  set position = ordered.position - 1
  from unnest(p_ordered_ids) with ordinality ordered(id, position)
  where flow.id = ordered.id and flow.assistant_id = p_assistant_id;
end
$$;
revoke all on function public.reorder_assistant_flows(text, text[]) from public;
grant execute on function public.reorder_assistant_flows(text, text[]) to authenticated, service_role;

create table public.application_connections (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (provider in (
    'salesforce', 'servicenow', 'slack', 'onedrive', 'google_drive'
  )),
  name text not null check (char_length(name) between 1 and 200),
  status text not null default 'pending' check (status in (
    'pending', 'connected', 'reauthorization_required', 'error'
  )),
  -- AES-GCM envelope produced with APP_ENCRYPTION_KEY. Never return this field
  -- from a client-facing action, even though it is ciphertext at rest.
  sealed_credentials text not null default '',
  scopes text[] not null default '{}',
  provider_account_id text,
  metadata jsonb not null default '{}'::jsonb,
  error text not null default '',
  last_connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

-- Server-side, single-use OAuth state. The sealed browser cookie carries the
-- transaction details; this row makes concurrent callback replay impossible.
create table public.application_oauth_nonces (
  nonce text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  member_id uuid not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.application_oauth_nonces enable row level security;
create policy "admins create own application oauth nonce"
  on public.application_oauth_nonces for insert
  with check (
    member_id = auth.uid()
    and private.has_org_role(organization_id, 3)
  );

create or replace function public.consume_application_oauth_nonce(
  p_nonce text,
  p_organization_id uuid,
  p_member_id uuid,
  p_consumed_at timestamptz
) returns boolean
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is distinct from p_member_id
    or not private.has_org_role(p_organization_id, 3)
  then
    return false;
  end if;
  update public.application_oauth_nonces
  set consumed_at = p_consumed_at
  where nonce = p_nonce
    and organization_id = p_organization_id
    and member_id = p_member_id
    and consumed_at is null
    and expires_at > p_consumed_at;
  return found;
end
$$;
revoke all on function public.consume_application_oauth_nonce(text, uuid, uuid, timestamptz) from public;
grant execute on function public.consume_application_oauth_nonce(text, uuid, uuid, timestamptz) to authenticated, service_role;

create table public.application_imports (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  connection_id text not null,
  collection_id text not null references public.knowledge_collections (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  config jsonb not null default '{}'::jsonb,
  cadence text not null default 'manual' check (cadence in ('manual', 'daily')),
  enabled boolean not null default true,
  status text not null default 'idle' check (status in ('idle', 'syncing', 'ready', 'error')),
  checkpoint jsonb not null default '{}'::jsonb,
  error text not null default '',
  last_synced_at timestamptz,
  next_sync_at timestamptz,
  reserved_bytes bigint not null default 0 check (reserved_bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (connection_id, organization_id)
    references public.application_connections (id, organization_id)
    on delete cascade
);

create table public.application_import_assistants (
  import_id text not null references public.application_imports (id) on delete cascade,
  assistant_id text not null references public.assistants (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (import_id, assistant_id)
);

create table public.application_sources (
  id text primary key,
  import_id text not null references public.application_imports (id) on delete cascade,
  source_id text unique references public.sources (id) on delete set null,
  remote_id text not null,
  canonical_url text,
  revision text,
  content_hash text not null,
  content_bytes bigint not null default 0 check (content_bytes >= 0),
  remote_mime_type text,
  remote_updated_at timestamptz,
  last_seen_at timestamptz not null,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (import_id, remote_id)
);

create table public.application_sync_runs (
  id text primary key,
  import_id text not null references public.application_imports (id) on delete cascade,
  status text not null check (status in ('succeeded', 'failed')),
  discovered int not null default 0 check (discovered >= 0),
  upserted int not null default 0 check (upserted >= 0),
  unchanged int not null default 0 check (unchanged >= 0),
  deleted int not null default 0 check (deleted >= 0),
  skipped int not null default 0 check (skipped >= 0),
  failed int not null default 0 check (failed >= 0),
  enqueued int not null default 0 check (enqueued >= 0),
  provider_calls int not null default 0 check (provider_calls >= 0),
  bytes bigint not null default 0 check (bytes >= 0),
  duration_ms int not null default 0 check (duration_ms >= 0),
  skipped_reasons jsonb not null default '[]'::jsonb,
  error text not null default '',
  started_at timestamptz not null,
  completed_at timestamptz not null
);

create or replace function public.list_application_operational_state(
  p_organization_id uuid
) returns table(import_id text, source_count bigint, last_run jsonb)
language sql stable security invoker
set search_path = public
as $$
  select application_import.id,
    (select count(*) from public.application_sources application_source
      where application_source.import_id = application_import.id
        and application_source.source_id is not null),
    (select to_jsonb(sync_run) from public.application_sync_runs sync_run
      where sync_run.import_id = application_import.id
      order by sync_run.started_at desc limit 1)
  from public.application_imports application_import
  where application_import.organization_id = p_organization_id
$$;
revoke all on function public.list_application_operational_state(uuid) from public;
grant execute on function public.list_application_operational_state(uuid) to authenticated, service_role;

create or replace function public.acquire_application_import_sync(
  p_id text,
  p_organization_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  acquired public.application_imports;
begin
  select * into acquired
  from public.application_imports
  where id = p_id and organization_id = p_organization_id and enabled
  for update;
  if not found then return null; end if;
  update public.application_imports
  set status = 'syncing', error = '', updated_at = now()
  where id = p_id
  returning * into acquired;
  return to_jsonb(acquired) || jsonb_build_object(
    'application_import_assistants',
    coalesce((
      select jsonb_agg(jsonb_build_object('assistant_id', assistant_id))
      from public.application_import_assistants where import_id = p_id
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.reserve_application_knowledge_bytes(
  p_import_id text,
  p_organization_id uuid,
  p_projected_bytes bigint,
  p_limit_bytes bigint
) returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  other_bytes bigint;
begin
  if p_projected_bytes < 0 or p_limit_bytes < 1 then return false; end if;
  perform pg_advisory_xact_lock(hashtext('application-bytes:' || p_organization_id::text));
  if not exists (
    select 1 from public.application_imports
    where id = p_import_id and organization_id = p_organization_id and enabled
  ) then return false; end if;
  select coalesce(sum(reserved_bytes), 0) into other_bytes
  from public.application_imports
  where organization_id = p_organization_id and id <> p_import_id;
  if other_bytes + p_projected_bytes > p_limit_bytes then return false; end if;
  update public.application_imports
  set reserved_bytes = p_projected_bytes, updated_at = now()
  where id = p_import_id;
  return true;
end
$$;
revoke all on function public.acquire_application_import_sync(text, uuid) from public;
revoke all on function public.reserve_application_knowledge_bytes(text, uuid, bigint, bigint) from public;
grant execute on function public.acquire_application_import_sync(text, uuid) to service_role;
grant execute on function public.reserve_application_knowledge_bytes(text, uuid, bigint, bigint) to service_role;

create or replace function public.create_application_import_with_assistants(
  p_id text,
  p_organization_id uuid,
  p_connection_id text,
  p_collection_id text,
  p_name text,
  p_config jsonb,
  p_cadence text,
  p_enabled boolean,
  p_assistant_ids text[]
) returns public.application_imports
language plpgsql security invoker
set search_path = public
as $$
declare
  created public.application_imports;
begin
  insert into public.application_imports (
    id, organization_id, connection_id, collection_id, name, config, cadence, enabled
  ) values (
    p_id, p_organization_id, p_connection_id, p_collection_id, p_name,
    coalesce(p_config, '{}'::jsonb), p_cadence, p_enabled
  ) returning * into created;

  insert into public.application_import_assistants (import_id, assistant_id)
  select p_id, assistant_id
  from unnest(coalesce(p_assistant_ids, '{}'::text[])) assistant_id;
  return created;
end
$$;

create or replace function public.update_application_import_with_assistants(
  p_id text,
  p_patch jsonb,
  p_assistant_ids text[] default null
) returns void
language plpgsql security invoker
set search_path = public
as $$
declare
  current_status text;
begin
  select status into current_status
  from public.application_imports
  where id = p_id
  for update;
  if not found then raise exception 'Application Import not found'; end if;
  if p_patch ? 'config' and current_status = 'syncing' then
    raise exception 'Wait for the current synchronization before editing this Import';
  end if;
  if coalesce((p_patch ->> 'resetSources')::boolean, false) then
    delete from public.sources source
    where source.id in (
      select application_source.source_id
      from public.application_sources application_source
      where application_source.import_id = p_id
        and application_source.source_id is not null
    );
    update public.application_sources
    set source_id = null, removed_at = now(), updated_at = now()
    where import_id = p_id and removed_at is null;
  end if;
  update public.application_imports
  set
    name = case when p_patch ? 'name' then p_patch ->> 'name' else name end,
    config = case when p_patch ? 'config' then p_patch -> 'config' else config end,
    cadence = case when p_patch ? 'cadence' then p_patch ->> 'cadence' else cadence end,
    enabled = case when p_patch ? 'enabled' then (p_patch ->> 'enabled')::boolean else enabled end,
    status = case when p_patch ? 'status' then p_patch ->> 'status' else status end,
    checkpoint = case when p_patch ? 'checkpoint' then p_patch -> 'checkpoint' else checkpoint end,
    error = case when p_patch ? 'error' then p_patch ->> 'error' else error end,
    last_synced_at = case when p_patch ? 'lastSyncedAt'
      then nullif(p_patch ->> 'lastSyncedAt', '')::timestamptz else last_synced_at end,
    next_sync_at = case when p_patch ? 'nextSyncAt'
      then nullif(p_patch ->> 'nextSyncAt', '')::timestamptz else next_sync_at end,
    reserved_bytes = case
      when coalesce((p_patch ->> 'resetSources')::boolean, false) then 0
      else reserved_bytes end,
    updated_at = now()
  where id = p_id;

  if p_assistant_ids is not null then
    delete from public.application_import_assistants where import_id = p_id;
    insert into public.application_import_assistants (import_id, assistant_id)
    select p_id, assistant_id from unnest(p_assistant_ids) assistant_id;
    delete from public.assistant_sources assistant_source
    using public.application_sources application_source
    where application_source.import_id = p_id
      and application_source.source_id = assistant_source.source_id
      and not (assistant_source.assistant_id = any(p_assistant_ids));
    insert into public.assistant_sources (assistant_id, source_id)
    select import_assistant.assistant_id, application_source.source_id
    from public.application_import_assistants import_assistant
    join public.application_sources application_source
      on application_source.import_id = import_assistant.import_id
    where import_assistant.import_id = p_id
      and application_source.source_id is not null
    on conflict (assistant_id, source_id) do nothing;
  end if;
end
$$;

create or replace function public.sync_application_source_assistant_scope(
  p_import_id text,
  p_source_id text
) returns void
language plpgsql security invoker
set search_path = public
as $$
begin
  perform 1 from public.application_imports where id = p_import_id for update;
  if not found then raise exception 'Application Import not found'; end if;
  if not exists (
    select 1 from public.application_sources
    where import_id = p_import_id and source_id = p_source_id
  ) then
    raise exception 'Source is not materialized by this Application Import';
  end if;
  delete from public.assistant_sources where source_id = p_source_id;
  insert into public.assistant_sources (assistant_id, source_id)
  select assistant_id, p_source_id
  from public.application_import_assistants
  where import_id = p_import_id;
end
$$;

revoke all on function public.create_application_import_with_assistants(text, uuid, text, text, text, jsonb, text, boolean, text[]) from public;
revoke all on function public.update_application_import_with_assistants(text, jsonb, text[]) from public;
revoke all on function public.sync_application_source_assistant_scope(text, text) from public;
grant execute on function public.create_application_import_with_assistants(text, uuid, text, text, text, jsonb, text, boolean, text[]) to authenticated, service_role;
grant execute on function public.update_application_import_with_assistants(text, jsonb, text[]) to authenticated, service_role;
grant execute on function public.sync_application_source_assistant_scope(text, text) to service_role;

create index application_connections_org_idx
  on public.application_connections (organization_id, created_at);
create index application_imports_org_idx
  on public.application_imports (organization_id, created_at);
create index application_imports_due_idx
  on public.application_imports (next_sync_at)
  where enabled and cadence = 'daily';
create index application_imports_continuation_idx
  on public.application_imports (updated_at)
  where enabled and status = 'syncing';
create index application_sources_import_idx
  on public.application_sources (import_id, created_at);
create index application_sync_runs_import_idx
  on public.application_sync_runs (import_id, started_at desc);
create unique index background_jobs_one_active_application_sync
  on public.background_jobs ((payload ->> 'importId'))
  where kind = 'sync_application_import'
    and status in ('queued', 'running');

create or replace function public.create_application_sync_job_if_absent(
  p_id text,
  p_import_id text,
  p_organization_id uuid,
  p_next_run_at timestamptz,
  p_max_concurrent integer default 3
) returns boolean
language plpgsql security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext(p_organization_id::text));
  if not exists (
    select 1 from public.application_imports
    where id = p_import_id and organization_id = p_organization_id and enabled
  ) then return false; end if;
  if exists (
    select 1 from public.background_jobs
    where kind = 'sync_application_import'
      and status in ('queued', 'running')
      and payload ->> 'importId' = p_import_id
  ) then return false; end if;
  if (
    select count(*) from public.background_jobs
    where kind = 'sync_application_import'
      and status in ('queued', 'running')
      and payload ->> 'organizationId' = p_organization_id::text
  ) >= greatest(1, least(p_max_concurrent, 20)) then return false; end if;
  insert into public.background_jobs (
    id, kind, source_id, status, payload, attempts, max_attempts, next_run_at, error
  ) values (
    p_id, 'sync_application_import', null, 'queued',
    jsonb_build_object(
      'kind', 'sync_application_import',
      'importId', p_import_id,
      'organizationId', p_organization_id::text
    ),
    0, 3, p_next_run_at, ''
  );
  return true;
end
$$;
revoke all on function public.create_application_sync_job_if_absent(text, text, uuid, timestamptz, integer) from public;
grant execute on function public.create_application_sync_job_if_absent(text, text, uuid, timestamptz, integer) to service_role;

create or replace function public.cancel_application_sync_jobs(
  p_import_id text,
  p_reason text
) returns void
language sql security definer
set search_path = public
as $$
  update public.background_jobs
  set status = 'failed', error = left(p_reason, 1000),
      locked_at = null, locked_by = null, updated_at = now()
  where kind = 'sync_application_import'
    and status = 'queued'
    and payload ->> 'importId' = p_import_id
$$;
revoke all on function public.cancel_application_sync_jobs(text, text) from public;
grant execute on function public.cancel_application_sync_jobs(text, text) to service_role;

-- Reject guessed cross-tenant Collection and Assistant ids. RLS scopes the
-- parent row; these helpers also make the foreign relation itself tenant-safe.
create or replace function private.application_import_scope_ok(
  p_organization_id uuid,
  p_collection_id text
) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.knowledge_collections collection
    where collection.id = p_collection_id
      and collection.organization_id = p_organization_id
  )
$$;

create or replace function private.application_import_assistant_scope_ok(
  p_import_id text,
  p_assistant_id text
) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.application_imports application_import
    join public.assistants assistant on assistant.id = p_assistant_id
    where application_import.id = p_import_id
      and assistant.organization_id = application_import.organization_id
  )
$$;

alter table public.application_imports
  add constraint application_imports_collection_scope_check
  check (private.application_import_scope_ok(organization_id, collection_id));
alter table public.application_import_assistants
  add constraint application_import_assistants_scope_check
  check (private.application_import_assistant_scope_ok(import_id, assistant_id));

alter table public.application_connections enable row level security;
alter table public.application_imports enable row level security;
alter table public.application_import_assistants enable row level security;
alter table public.application_sources enable row level security;
alter table public.application_sync_runs enable row level security;

create policy "admins read application connections" on public.application_connections
  for select using (private.has_org_role(organization_id, 3));
create policy "admins insert application connections" on public.application_connections
  for insert with check (private.has_org_role(organization_id, 3));
create policy "admins update application connections" on public.application_connections
  for update using (private.has_org_role(organization_id, 3))
  with check (private.has_org_role(organization_id, 3));
create policy "admins delete application connections" on public.application_connections
  for delete using (private.has_org_role(organization_id, 3));

-- Members can inspect connection health without ever selecting ciphertext.
-- The view owner bypasses the base-table RLS, so membership is repeated here.
create view public.application_connections_safe
with (security_barrier = true)
as
select id, organization_id, provider, name, status, scopes,
  provider_account_id, metadata, error, last_connected_at, created_at, updated_at
from public.application_connections
where private.is_org_member(organization_id);
revoke all on public.application_connections_safe from public;
grant select on public.application_connections_safe to authenticated;

create or replace function public.get_application_health_summary(
  p_organization_id uuid
) returns table(connected bigint, pending bigint, attention bigint, syncing bigint, ready bigint)
language sql stable security invoker
set search_path = public
as $$
  select
    (select count(*) from public.application_connections_safe
      where organization_id = p_organization_id and status = 'connected'),
    (select count(*) from public.application_connections_safe
      where organization_id = p_organization_id and status = 'pending'),
    (select count(*) from public.application_connections_safe
      where organization_id = p_organization_id and status in ('error', 'reauthorization_required'))
      + (select count(*) from public.application_imports
          where organization_id = p_organization_id and status = 'error'),
    (select count(*) from public.application_imports
      where organization_id = p_organization_id and status = 'syncing'),
    (select count(*) from public.application_imports
      where organization_id = p_organization_id and status = 'ready')
$$;
revoke all on function public.get_application_health_summary(uuid) from public;
grant execute on function public.get_application_health_summary(uuid) to authenticated, service_role;

create policy "members read application imports" on public.application_imports
  for select using (private.is_org_member(organization_id));
create policy "editors insert application imports" on public.application_imports
  for insert with check (private.has_org_role(organization_id, 2));
create policy "editors update application imports" on public.application_imports
  for update using (private.has_org_role(organization_id, 2))
  with check (private.has_org_role(organization_id, 2));
create policy "editors delete application imports" on public.application_imports
  for delete using (private.has_org_role(organization_id, 2));

create policy "members read application import assistants" on public.application_import_assistants
  for select using (exists (
    select 1 from public.application_imports application_import
    where application_import.id = import_id
      and private.is_org_member(application_import.organization_id)
  ));
create policy "editors write application import assistants" on public.application_import_assistants
  for all using (exists (
    select 1 from public.application_imports application_import
    where application_import.id = import_id
      and private.has_org_role(application_import.organization_id, 2)
  )) with check (
    private.application_import_assistant_scope_ok(import_id, assistant_id)
    and exists (
      select 1 from public.application_imports application_import
      where application_import.id = import_id
        and private.has_org_role(application_import.organization_id, 2)
    )
  );

create policy "members read application sources" on public.application_sources
  for select using (exists (
    select 1 from public.application_imports application_import
    where application_import.id = import_id
      and private.is_org_member(application_import.organization_id)
  ));
create policy "editors write application sources" on public.application_sources
  for all using (exists (
    select 1 from public.application_imports application_import
    where application_import.id = import_id
      and private.has_org_role(application_import.organization_id, 2)
  )) with check (exists (
    select 1 from public.application_imports application_import
    join public.sources source on source.id = source_id
    join public.knowledge_collections collection on collection.id = source.collection_id
    where application_import.id = import_id
      and collection.organization_id = application_import.organization_id
      and private.has_org_role(application_import.organization_id, 2)
  ));

create policy "members read application sync runs" on public.application_sync_runs
  for select using (exists (
    select 1 from public.application_imports application_import
    where application_import.id = import_id
      and private.is_org_member(application_import.organization_id)
  ));
create policy "editors write application sync runs" on public.application_sync_runs
  for all using (exists (
    select 1 from public.application_imports application_import
    where application_import.id = import_id
      and private.has_org_role(application_import.organization_id, 2)
  )) with check (exists (
    select 1 from public.application_imports application_import
    where application_import.id = import_id
      and private.has_org_role(application_import.organization_id, 2)
  ));

-- Removing an Import or Connection removes the materialized Application
-- Sources too; their Concepts, chunks, Assistant links, and jobs cascade from
-- the existing Source foreign keys.
create or replace function private.delete_application_source_row()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if old.source_id is not null then
    delete from public.sources where id = old.source_id;
  end if;
  return old;
end;
$$;

create trigger delete_materialized_application_source
after delete on public.application_sources
for each row execute function private.delete_application_source_row();
