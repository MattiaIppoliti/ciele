-- Large extracted documents do not belong in the hot background-job row. Keep
-- immutable, versioned payloads in their own TOAST-able table and enqueue only
-- a small reference in the same transaction.

create table if not exists public.source_ingest_payloads (
  source_id text not null references public.sources(id) on delete cascade,
  version bigint not null,
  raw_text text not null,
  draft_manifest jsonb,
  created_at timestamptz not null default now(),
  primary key (source_id, version)
);

create index if not exists source_ingest_payloads_latest_idx
  on public.source_ingest_payloads (source_id, version desc);

alter table public.source_ingest_payloads enable row level security;
create policy "members read source ingest payloads" on public.source_ingest_payloads
  for select using (exists (
    select 1 from public.sources s
    join public.knowledge_collections kc on kc.id = s.collection_id
    where s.id = source_ingest_payloads.source_id
      and private.is_org_member(kc.organization_id)
  ));
create policy "editors create source ingest payloads" on public.source_ingest_payloads
  for insert with check (exists (
    select 1 from public.sources s
    join public.knowledge_collections kc on kc.id = s.collection_id
    where s.id = source_ingest_payloads.source_id
      and private.has_org_role(kc.organization_id, 2)
  ));

create or replace function public.stage_source_ingest_job(
  p_job_id text,
  p_source_id text,
  p_assistant_id text,
  p_collection_id text,
  p_raw_text text,
  p_now timestamptz
)
returns bigint
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_version bigint;
  v_collection_id text;
  v_organization_id uuid;
begin
  select s.collection_id, kc.organization_id
  into v_collection_id, v_organization_id
  from public.sources s
  join public.knowledge_collections kc on kc.id = s.collection_id
  where s.id = p_source_id
  for update;
  if not found then raise foreign_key_violation using message = 'Source not found'; end if;
  if auth.role() <> 'service_role'
     and not private.has_org_role(v_organization_id, 2) then
    raise insufficient_privilege using message = 'Source ingest requires Editor role';
  end if;
  if v_collection_id <> p_collection_id then
    raise foreign_key_violation using message = 'Source collection mismatch';
  end if;
  if not exists (
    select 1
    from public.assistant_sources link
    join public.assistants a on a.id = link.assistant_id
    join public.knowledge_collections kc on kc.id = v_collection_id
    where link.source_id = p_source_id
      and link.assistant_id = p_assistant_id
      and a.organization_id = kc.organization_id
  ) then
    raise foreign_key_violation using message = 'Assistant is not linked to Source';
  end if;
  update public.background_jobs
  set status = 'failed', error = 'Superseded by a newer Source revision',
      locked_at = null, locked_by = null, lease_token = null, updated_at = p_now
  where kind = 'ingest_source' and source_id = p_source_id
    and status in ('queued', 'running');
  select coalesce(max(version), 0) + 1 into v_version
  from public.source_ingest_payloads where source_id = p_source_id;
  insert into public.source_ingest_payloads (source_id, version, raw_text, created_at)
  values (p_source_id, v_version, p_raw_text, p_now);
  insert into public.background_jobs (
    id, organization_id, kind, source_id, status, payload,
    next_run_at, created_at, updated_at
  ) values (
    p_job_id,
    v_organization_id,
    'ingest_source', p_source_id, 'queued',
    jsonb_build_object(
      'kind', 'ingest_source',
      'assistantId', p_assistant_id,
      'collectionId', v_collection_id,
      'sourceId', p_source_id,
      'payloadVersion', v_version
    ),
    p_now, p_now, p_now
  );
  delete from public.source_ingest_payloads sip
  where sip.source_id = p_source_id
    and sip.version < v_version
    and not exists (
      select 1 from public.background_jobs bj
      where bj.source_id = p_source_id
        and bj.kind = 'ingest_source'
        and bj.status in ('queued', 'running')
        and (bj.payload->>'payloadVersion')::bigint = sip.version
    );
  return v_version;
end;
$$;

revoke all on function public.stage_source_ingest_job(
  text, text, text, text, text, timestamptz
) from public, anon;
grant execute on function public.stage_source_ingest_job(
  text, text, text, text, text, timestamptz
) to authenticated, service_role;

-- Convert one pre-versioning job in place. A crash after this transaction
-- leaves the same row resumable with its durable payload reference.
create or replace function public.upgrade_legacy_source_ingest_job(
  p_job_id text, p_lease_token uuid, p_assistant_id text,
  p_collection_id text, p_source_id text, p_raw_text text, p_now timestamptz
) returns bigint
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_version bigint;
  v_created_at timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise insufficient_privilege using message = 'Ingest upgrade requires service role';
  end if;
  perform 1 from public.sources s where s.id = p_source_id for update;
  if not found then return null; end if;
  select j.created_at into v_created_at
  from public.background_jobs j
  where j.id = p_job_id and j.kind = 'ingest_source'
    and j.source_id = p_source_id and j.status = 'running'
    and j.lease_token = p_lease_token
  for update;
  if not found then return null; end if;
  if exists (
    select 1 from public.background_jobs newer
    where newer.kind = 'ingest_source' and newer.source_id = p_source_id
      and newer.id <> p_job_id
      and (newer.created_at, newer.id) > (v_created_at, p_job_id)
  ) then
    update public.background_jobs
    set status = 'failed', error = 'Superseded by a newer Source revision',
        locked_at = null, locked_by = null, lease_token = null, updated_at = p_now
    where id = p_job_id and status = 'running' and lease_token = p_lease_token;
    return null;
  end if;
  update public.background_jobs older
  set status = 'failed', error = 'Superseded by a newer Source revision',
      locked_at = null, locked_by = null, lease_token = null, updated_at = p_now
  where older.kind = 'ingest_source' and older.source_id = p_source_id
    and older.status in ('queued', 'running') and older.id <> p_job_id
    and older.payload ? 'rawText'
    and (older.created_at, older.id) < (v_created_at, p_job_id);
  select coalesce(max(version), 0) + 1 into v_version
  from public.source_ingest_payloads where source_id = p_source_id;
  insert into public.source_ingest_payloads (source_id, version, raw_text, created_at)
  values (p_source_id, v_version, p_raw_text, p_now);
  update public.background_jobs
  set payload = jsonb_build_object(
        'kind', 'ingest_source', 'assistantId', p_assistant_id,
        'collectionId', p_collection_id, 'sourceId', p_source_id,
        'payloadVersion', v_version
      ), updated_at = p_now
  where id = p_job_id and status = 'running' and lease_token = p_lease_token;
  return v_version;
end
$$;

revoke all on function public.upgrade_legacy_source_ingest_job(
  text, uuid, text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.upgrade_legacy_source_ingest_job(
  text, uuid, text, text, text, text, timestamptz
) to service_role;

-- Freeze stochastic enrichment output and its replacement cursor behind the
-- same lease that owns the job. A late worker cannot overwrite the canonical
-- manifest after another worker has reclaimed the row.
alter table public.source_ingest_payloads
  add column if not exists generation_id uuid,
  add column if not exists expected_active_generation_id uuid,
  add column if not exists ingest_cursor integer not null default 0;

create or replace function public.initialize_source_ingest_attempt(
  p_job_id text, p_lease_token uuid, p_source_id text, p_version bigint,
  p_draft_manifest jsonb
) returns table (
  draft_manifest jsonb, generation_id uuid,
  expected_active_generation_id uuid, ingest_cursor integer
)
language plpgsql volatile security definer set search_path = public
as $$
declare v_payload public.source_ingest_payloads%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise insufficient_privilege using message = 'Ingest initialization requires service role';
  end if;
  perform 1 from public.background_jobs j
  where j.id = p_job_id and j.kind = 'ingest_source'
    and j.source_id = p_source_id and j.status = 'running'
    and j.lease_token = p_lease_token
    and (j.payload ->> 'payloadVersion')::bigint = p_version
  for update;
  if not found then return; end if;
  select sip.* into v_payload from public.source_ingest_payloads sip
  where sip.source_id = p_source_id and sip.version = p_version for update;
  if not found then return; end if;
  if v_payload.draft_manifest is null then
    update public.source_ingest_payloads sip
    set draft_manifest = p_draft_manifest, generation_id = gen_random_uuid(),
        expected_active_generation_id = s.active_generation_id, ingest_cursor = 0
    from public.sources s
    where sip.source_id = p_source_id and sip.version = p_version
      and s.id = sip.source_id
    returning sip.* into v_payload;
  end if;
  return query select v_payload.draft_manifest, v_payload.generation_id,
    v_payload.expected_active_generation_id, v_payload.ingest_cursor;
end
$$;

create or replace function public.checkpoint_source_ingest_cursor(
  p_job_id text, p_lease_token uuid, p_source_id text, p_version bigint,
  p_generation_id uuid, p_cursor integer
) returns boolean
language plpgsql volatile security definer set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise insufficient_privilege using message = 'Ingest checkpoint requires service role';
  end if;
  update public.source_ingest_payloads sip set ingest_cursor = p_cursor
  from public.background_jobs j
  where j.id = p_job_id and j.kind = 'ingest_source'
    and j.source_id = p_source_id and j.status = 'running'
    and j.lease_token = p_lease_token
    and (j.payload ->> 'payloadVersion')::bigint = p_version
    and sip.source_id = p_source_id and sip.version = p_version
    and sip.generation_id = p_generation_id and p_cursor >= sip.ingest_cursor;
  return found;
end
$$;

revoke all on function public.initialize_source_ingest_attempt(
  text, uuid, text, bigint, jsonb
) from public, anon, authenticated;
grant execute on function public.initialize_source_ingest_attempt(
  text, uuid, text, bigint, jsonb
) to service_role;
revoke all on function public.checkpoint_source_ingest_cursor(
  text, uuid, text, bigint, uuid, integer
) from public, anon, authenticated;
grant execute on function public.checkpoint_source_ingest_cursor(
  text, uuid, text, bigint, uuid, integer
) to service_role;

-- The cutover and lease check share a transaction. A newer staged revision
-- clears the older lease before it can change the active generation.
create or replace function public.commit_source_ingest_generation(
  p_job_id text, p_lease_token uuid, p_source_id text, p_version bigint,
  p_expected_active_generation_id uuid, p_generation_id uuid
) returns boolean
language plpgsql volatile security definer set search_path = public
as $$
declare v_committed boolean;
begin
  if auth.role() <> 'service_role' then
    raise insufficient_privilege using message = 'Ingest commit requires service role';
  end if;
  perform 1 from public.sources s where s.id = p_source_id for update;
  if not found then return false; end if;
  perform 1 from public.background_jobs j
  where j.id = p_job_id and j.kind = 'ingest_source'
    and j.source_id = p_source_id and j.status = 'running'
    and j.lease_token = p_lease_token
    and (j.payload ->> 'payloadVersion')::bigint = p_version
  for update;
  if not found then return false; end if;
  select public.commit_source_knowledge_generation(
    p_source_id, p_expected_active_generation_id, p_generation_id
  ) into v_committed;
  return v_committed;
end
$$;

revoke all on function public.commit_source_ingest_generation(
  text, uuid, text, bigint, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.commit_source_ingest_generation(
  text, uuid, text, bigint, uuid, uuid
) to service_role;
