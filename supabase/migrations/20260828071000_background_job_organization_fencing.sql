-- Application-sync jobs landed after organization-scoped fair queues. Keep
-- their atomic de-duplication RPC, but stamp the queue's required tenant key.
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
      and organization_id = p_organization_id
      and status in ('queued', 'running')
  ) >= greatest(1, least(p_max_concurrent, 20)) then return false; end if;
  insert into public.background_jobs (
    id, organization_id, kind, source_id, status, payload,
    attempts, max_attempts, next_run_at, error
  ) values (
    p_id, p_organization_id, 'sync_application_import', null, 'queued',
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

revoke all on function public.create_application_sync_job_if_absent(
  text, text, uuid, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.create_application_sync_job_if_absent(
  text, text, uuid, timestamptz, integer
) to service_role;

-- A paged Application Import must not settle without durably recording the
-- successor. The lease win and the next queue row are one transaction.
create or replace function public.settle_application_sync_job_success(
  p_id text,
  p_lease_token uuid,
  p_import_id text,
  p_organization_id uuid,
  p_successor_id text,
  p_now timestamptz,
  p_max_concurrent integer default 3
) returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_settled boolean;
begin
  if auth.role() <> 'service_role' then
    raise insufficient_privilege using message = 'Application job settlement requires service role';
  end if;
  update public.background_jobs
  set status = 'succeeded', error = '', locked_at = null, locked_by = null,
      lease_token = null, updated_at = p_now
  where id = p_id
    and organization_id = p_organization_id
    and kind = 'sync_application_import'
    and status = 'running'
    and lease_token = p_lease_token;
  v_settled := found;
  if not v_settled then return false; end if;

  perform pg_advisory_xact_lock(hashtext(p_organization_id::text));
  if exists (
    select 1 from public.application_imports
    where id = p_import_id and organization_id = p_organization_id
      and enabled and status = 'syncing'
  ) and not exists (
    select 1 from public.background_jobs
    where kind = 'sync_application_import'
      and status in ('queued', 'running')
      and payload ->> 'importId' = p_import_id
  ) and (
    select count(*) from public.background_jobs
    where kind = 'sync_application_import'
      and organization_id = p_organization_id
      and status in ('queued', 'running')
  ) < greatest(1, least(p_max_concurrent, 20)) then
    insert into public.background_jobs (
      id, organization_id, kind, source_id, status, payload,
      attempts, max_attempts, next_run_at, error
    ) values (
      p_successor_id, p_organization_id, 'sync_application_import', null, 'queued',
      jsonb_build_object(
        'kind', 'sync_application_import',
        'importId', p_import_id,
        'organizationId', p_organization_id::text
      ),
      0, 3, p_now, ''
    );
  end if;
  return true;
end
$$;

revoke all on function public.settle_application_sync_job_success(
  text, uuid, text, uuid, text, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.settle_application_sync_job_success(
  text, uuid, text, uuid, text, timestamptz, integer
) to service_role;

-- The API subject list must aggregate and page in Postgres; grouping the
-- entire memories table in the application makes `limit` cosmetic.
create or replace function public.list_memory_subjects_page(
  p_organization_id uuid,
  p_after_last_memory_at timestamptz,
  p_after_subject_id text,
  p_limit integer
) returns table (
  subject_id text,
  claim_value text,
  memory_count bigint,
  last_memory_at timestamptz
)
language sql stable security definer
set search_path = public
as $$
  with summaries as (
    select m.subject_id,
           count(*)::bigint as memory_count,
           max(m.created_at) as last_memory_at
    from public.memories m
    where m.organization_id = p_organization_id
    group by m.subject_id
  )
  select s.subject_id,
         claim.claim_value,
         s.memory_count,
         s.last_memory_at
  from summaries s
  left join lateral (
    select c.metadata ->> 'ssoClaimValue' as claim_value
    from public.conversations c
    join public.assistants a on a.id = c.assistant_id
    where a.organization_id = p_organization_id
      and c.subject_type = 'sso'
      and c.subject_id = s.subject_id
      and nullif(c.metadata ->> 'ssoClaimValue', '') is not null
    order by c.created_at desc, c.id desc
    limit 1
  ) claim on true
  where p_after_last_memory_at is null
     or s.last_memory_at < p_after_last_memory_at
     or (
       s.last_memory_at = p_after_last_memory_at
       and s.subject_id > p_after_subject_id
     )
  order by s.last_memory_at desc, s.subject_id asc
  limit greatest(1, least(p_limit, 101))
$$;

revoke all on function public.list_memory_subjects_page(
  uuid, timestamptz, text, integer
) from public, anon, authenticated;
grant execute on function public.list_memory_subjects_page(
  uuid, timestamptz, text, integer
) to service_role;
