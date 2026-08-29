-- Every durable job belongs to an Organization directly. `source_id` is an
-- optional domain reference, not a tenancy key: graph, memory, proposal, and
-- Entity jobs have no Source at all.
alter table public.background_jobs
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

update public.background_jobs j
set organization_id = kc.organization_id
from public.sources s
join public.knowledge_collections kc on kc.id = s.collection_id
where j.organization_id is null and j.source_id = s.id;

update public.background_jobs j
set organization_id = kc.organization_id
from public.knowledge_collections kc
where j.organization_id is null
  and kc.id = j.payload->>'collectionId';

update public.background_jobs j
set organization_id = i.organization_id
from public.improvements i
where j.organization_id is null
  and i.id = j.payload->>'improvementId';

update public.background_jobs j
set organization_id = e.organization_id
from public.entities e
where j.organization_id is null
  and e.id = j.payload->>'entityId';

update public.background_jobs j
set organization_id = coalesce(a.organization_id, t.organization_id)
from public.conversations c
left join public.assistants a on a.id = c.assistant_id
left join public.teammates t on t.id = c.teammate_id
where j.organization_id is null
  and c.id = j.payload->>'conversationId';

update public.background_jobs j
set organization_id = a.organization_id
from public.assistants a
where j.organization_id is null
  and a.id = j.payload->>'assistantId';

update public.background_jobs j
set organization_id = kc.organization_id
from public.concepts c
join public.knowledge_collections kc on kc.id = c.collection_id
where j.organization_id is null
  and c.id = j.payload->>'conceptId';

update public.background_jobs j
set organization_id = coalesce(a.organization_id, t.organization_id)
from public.messages m
join public.conversations c on c.id = m.conversation_id
left join public.assistants a on a.id = c.assistant_id
left join public.teammates t on t.id = c.teammate_id
where j.organization_id is null
  and m.id = j.payload->>'messageId';

update public.background_jobs j
set organization_id = t.organization_id
from public.teammates t
where j.organization_id is null
  and t.id = j.payload->>'teammateId';

update public.background_jobs
set organization_id = (payload->>'organizationId')::uuid
where organization_id is null
  and nullif(payload->>'organizationId', '') is not null;

-- Old application versions could persist payload-only references that did not
-- agree with the row's tenant. Keep those records for diagnosis, but make
-- them terminal before the service-role worker can dereference them.
update public.background_jobs j
set status = 'failed',
    error = 'Tenant reference mismatch quarantined during migration',
    locked_at = null, locked_by = null, lease_token = null, updated_at = now()
where j.status in ('queued', 'running') and (
  (nullif(j.payload->>'assistantId', '') is not null and not exists (
    select 1 from public.assistants a
    where a.id = j.payload->>'assistantId'
      and a.organization_id = j.organization_id
  ))
  or (nullif(j.payload->>'sourceId', '') is not null and not exists (
    select 1 from public.sources s
    join public.knowledge_collections kc on kc.id = s.collection_id
    where s.id = j.payload->>'sourceId'
      and kc.organization_id = j.organization_id
      and (j.source_id is null or j.source_id = s.id)
      and (nullif(j.payload->>'collectionId', '') is null
        or j.payload->>'collectionId' = s.collection_id)
  ))
  or (nullif(j.payload->>'conceptId', '') is not null
    and not (j.payload->>'kind' = 'graph_sync_concept' and j.payload->>'op' = 'remove')
    and not exists (
    select 1 from public.concepts c
    join public.knowledge_collections kc on kc.id = c.collection_id
    where c.id = j.payload->>'conceptId'
      and kc.organization_id = j.organization_id
      and (nullif(j.payload->>'collectionId', '') is null
        or j.payload->>'collectionId' = c.collection_id)
  ))
  or (nullif(j.payload->>'messageId', '') is not null and not exists (
    select 1 from public.messages m
    join public.conversations cv on cv.id = m.conversation_id
    left join public.assistants a on a.id = cv.assistant_id
    left join public.teammates t on t.id = cv.teammate_id
    where m.id = j.payload->>'messageId'
      and coalesce(a.organization_id, t.organization_id) = j.organization_id
      and (nullif(j.payload->>'conversationId', '') is null
        or j.payload->>'conversationId' = m.conversation_id)
  ))
  or (nullif(j.payload->>'teammateId', '') is not null and not exists (
    select 1 from public.teammates t
    where t.id = j.payload->>'teammateId'
      and t.organization_id = j.organization_id
      and (nullif(j.payload->>'conversationId', '') is null or exists (
        select 1 from public.conversations cv
        where cv.id = j.payload->>'conversationId'
          and cv.teammate_id = t.id
      ))
  ))
  or (
    nullif(j.payload->>'improvementId', '') is not null
    and nullif(j.payload->>'messageId', '') is not null
    and not exists (
      select 1 from public.improvement_messages im
      where im.improvement_id = j.payload->>'improvementId'
        and im.message_id = j.payload->>'messageId'
    )
  )
);

-- Compatibility for every existing enqueue path, including older application
-- instances during a rolling deployment. RLS validates the resolved org.
create or replace function private.resolve_background_job_organization()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_candidate uuid;
  v_parent_id text;
begin
  if new.source_id is not null then
    select kc.organization_id into v_candidate
    from public.sources s
    join public.knowledge_collections kc on kc.id = s.collection_id
    where s.id = new.source_id;
    if v_candidate is null then
      raise foreign_key_violation using message = 'Background job Source not found';
    end if;
    if new.organization_id is null then new.organization_id := v_candidate;
    elsif new.organization_id <> v_candidate then
      raise check_violation using message = 'Background job Source belongs to another Organization';
    end if;
  end if;
  if nullif(new.payload->>'organizationId', '') is not null then
    v_candidate := (new.payload->>'organizationId')::uuid;
    if new.organization_id is null then new.organization_id := v_candidate;
    elsif new.organization_id <> v_candidate then
      raise check_violation using message = 'Background job payload belongs to another Organization';
    end if;
  end if;
  if nullif(new.payload->>'collectionId', '') is not null then
    select organization_id into v_candidate
    from public.knowledge_collections where id = new.payload->>'collectionId';
    if v_candidate is null and not (
      new.organization_id is not null
      and new.payload->>'kind' = 'graph_sync_concept'
      and new.payload->>'op' = 'purge'
    ) then
      raise foreign_key_violation using message = 'Background job Collection not found';
    end if;
    if new.organization_id is null then new.organization_id := v_candidate;
    elsif v_candidate is null then null;
    elsif new.organization_id <> v_candidate then
      raise check_violation using message = 'Background job Collection belongs to another Organization';
    end if;
  end if;
  if nullif(new.payload->>'improvementId', '') is not null then
    select organization_id into v_candidate
    from public.improvements where id = new.payload->>'improvementId';
    if v_candidate is null then
      raise foreign_key_violation using message = 'Background job Improvement not found';
    end if;
    if new.organization_id is null then new.organization_id := v_candidate;
    elsif new.organization_id <> v_candidate then
      raise check_violation using message = 'Background job Improvement belongs to another Organization';
    end if;
  end if;
  if nullif(new.payload->>'entityId', '') is not null then
    select organization_id into v_candidate
    from public.entities where id = new.payload->>'entityId';
    if v_candidate is null then
      raise foreign_key_violation using message = 'Background job Entity not found';
    end if;
    if new.organization_id is null then new.organization_id := v_candidate;
    elsif new.organization_id <> v_candidate then
      raise check_violation using message = 'Background job Entity belongs to another Organization';
    end if;
  end if;
  if nullif(new.payload->>'conversationId', '') is not null then
    select coalesce(a.organization_id, t.organization_id) into v_candidate
    from public.conversations c
    left join public.assistants a on a.id = c.assistant_id
    left join public.teammates t on t.id = c.teammate_id
    where c.id = new.payload->>'conversationId';
    if v_candidate is null then
      raise foreign_key_violation using message = 'Background job Conversation not found';
    end if;
    if new.organization_id is null then new.organization_id := v_candidate;
    elsif new.organization_id <> v_candidate then
      raise check_violation using message = 'Background job Conversation belongs to another Organization';
    end if;
  end if;
  if nullif(new.payload->>'assistantId', '') is not null then
    select organization_id into v_candidate
    from public.assistants where id = new.payload->>'assistantId';
    if not found then
      raise foreign_key_violation using message = 'Background job Assistant not found';
    elsif new.organization_id is null then new.organization_id := v_candidate;
    elsif new.organization_id <> v_candidate then
      raise check_violation using message = 'Background job Assistant belongs to another Organization';
    end if;
  end if;
  if nullif(new.payload->>'sourceId', '') is not null then
    select kc.organization_id, s.collection_id into v_candidate, v_parent_id
    from public.sources s
    join public.knowledge_collections kc on kc.id = s.collection_id
    where s.id = new.payload->>'sourceId';
    if not found then
      raise foreign_key_violation using message = 'Background job payload Source not found';
    elsif new.organization_id is null then new.organization_id := v_candidate;
    elsif new.organization_id <> v_candidate then
      raise check_violation using message = 'Background job payload Source belongs to another Organization';
    end if;
    if new.source_id is not null and new.source_id <> new.payload->>'sourceId' then
      raise check_violation using message = 'Background job Source references disagree';
    end if;
    if nullif(new.payload->>'collectionId', '') is not null
      and v_parent_id <> new.payload->>'collectionId' then
      raise check_violation using message = 'Background job Source belongs to another Collection';
    end if;
  end if;
  if nullif(new.payload->>'conceptId', '') is not null then
    select kc.organization_id, c.collection_id into v_candidate, v_parent_id
    from public.concepts c
    join public.knowledge_collections kc on kc.id = c.collection_id
    where c.id = new.payload->>'conceptId';
    if not found and not (
      new.payload->>'kind' = 'graph_sync_concept'
      and new.payload->>'op' = 'remove'
      and nullif(new.payload->>'collectionId', '') is not null
    ) then
      raise foreign_key_violation using message = 'Background job Concept not found';
    elsif found and new.organization_id is null then new.organization_id := v_candidate;
    elsif found and new.organization_id <> v_candidate then
      raise check_violation using message = 'Background job Concept belongs to another Organization';
    end if;
    if found and nullif(new.payload->>'collectionId', '') is not null
      and v_parent_id <> new.payload->>'collectionId' then
      raise check_violation using message = 'Background job Concept belongs to another Collection';
    end if;
  end if;
  if nullif(new.payload->>'messageId', '') is not null then
    select coalesce(a.organization_id, t.organization_id), m.conversation_id
      into v_candidate, v_parent_id
    from public.messages m
    join public.conversations cv on cv.id = m.conversation_id
    left join public.assistants a on a.id = cv.assistant_id
    left join public.teammates t on t.id = cv.teammate_id
    where m.id = new.payload->>'messageId';
    if not found then
      raise foreign_key_violation using message = 'Background job Message not found';
    elsif new.organization_id is null then new.organization_id := v_candidate;
    elsif new.organization_id <> v_candidate then
      raise check_violation using message = 'Background job Message belongs to another Organization';
    end if;
    if nullif(new.payload->>'conversationId', '') is not null
      and v_parent_id <> new.payload->>'conversationId' then
      raise check_violation using message = 'Background job Message belongs to another Conversation';
    end if;
  end if;
  if nullif(new.payload->>'teammateId', '') is not null then
    select organization_id into v_candidate
    from public.teammates where id = new.payload->>'teammateId';
    if not found then
      raise foreign_key_violation using message = 'Background job Teammate not found';
    elsif new.organization_id is null then new.organization_id := v_candidate;
    elsif new.organization_id <> v_candidate then
      raise check_violation using message = 'Background job Teammate belongs to another Organization';
    end if;
    if nullif(new.payload->>'conversationId', '') is not null and not exists (
      select 1 from public.conversations cv
      where cv.id = new.payload->>'conversationId'
        and cv.teammate_id = new.payload->>'teammateId'
    ) then
      raise check_violation using message = 'Background job Conversation belongs to another Teammate';
    end if;
  end if;
  if nullif(new.payload->>'improvementId', '') is not null
    and nullif(new.payload->>'messageId', '') is not null
    and not exists (
      select 1 from public.improvement_messages im
      where im.improvement_id = new.payload->>'improvementId'
        and im.message_id = new.payload->>'messageId'
    ) then
    raise check_violation using message = 'Background job Message is not linked to Improvement';
  end if;
  if new.organization_id is null then
    raise not_null_violation using message = 'Background job organization could not be resolved';
  end if;
  return new;
end;
$$;

drop trigger if exists background_job_resolve_organization on public.background_jobs;
create trigger background_job_resolve_organization
before insert or update of source_id, payload, organization_id
on public.background_jobs
for each row execute function private.resolve_background_job_organization();

alter table public.background_jobs alter column organization_id set not null;
create index if not exists background_jobs_org_due_idx
  on public.background_jobs (organization_id, kind, status, next_run_at);

drop policy if exists "members read source jobs" on public.background_jobs;
drop policy if exists "editors create source jobs" on public.background_jobs;
drop policy if exists "editors update source jobs" on public.background_jobs;
drop policy if exists "editors delete source jobs" on public.background_jobs;
drop policy if exists "members read organization jobs" on public.background_jobs;
drop policy if exists "editors create organization jobs" on public.background_jobs;
drop policy if exists "editors update organization jobs" on public.background_jobs;
drop policy if exists "editors delete organization jobs" on public.background_jobs;
create policy "members read organization jobs" on public.background_jobs
  for select using (private.is_org_member(organization_id));
create policy "editors create organization jobs" on public.background_jobs
  for insert with check (private.has_org_role(organization_id, 2));
create policy "editors update organization jobs" on public.background_jobs
  for update using (private.has_org_role(organization_id, 2))
  with check (private.has_org_role(organization_id, 2));
create policy "editors delete organization jobs" on public.background_jobs
  for delete using (private.has_org_role(organization_id, 2));

create or replace function public.claim_background_jobs(
  p_kind text, p_worker_id text, p_now timestamptz,
  p_stale_before timestamptz, p_limit integer
)
returns setof public.background_jobs language sql volatile security invoker
set search_path = public as $$
  with eligible as (
    select j.id, j.organization_id::text as tenant_key,
      case when j.status = 'queued' then j.next_run_at else j.locked_at end as due_at,
      j.created_at
    from public.background_jobs j
    where j.kind = p_kind and (
      (j.status = 'queued' and j.next_run_at <= p_now and j.attempts < j.max_attempts)
      or (j.status = 'running' and j.locked_at is not null
          and j.locked_at <= p_stale_before)
    )
  ), ranked as (
    select *, row_number() over (
      partition by tenant_key order by due_at, created_at, id
    ) as tenant_position from eligible
  ), candidates as (
    select j.id from public.background_jobs j
    join ranked r on r.id = j.id
    order by r.tenant_position, r.due_at, r.created_at, r.id
    limit greatest(p_limit, 0)
    for update of j skip locked
  )
  update public.background_jobs j set
    status = 'running',
    attempts = case when j.status = 'running' and j.attempts >= j.max_attempts
      then j.attempts else j.attempts + 1 end,
    locked_at = p_now, locked_by = p_worker_id,
    lease_token = gen_random_uuid(), error = '', updated_at = p_now
  from candidates where j.id = candidates.id returning j.*;
$$;

-- Versioned terminal-cleanup claim. The legacy claim above intentionally
-- retains its old result contract for app/database rolling deploys. New
-- workers call this first, perform cleanup while holding the lease, and only
-- then settle the row failed; a crashed cleanup becomes reclaimable again.
create or replace function public.claim_terminal_background_jobs(
  p_kind text, p_worker_id text, p_now timestamptz,
  p_stale_before timestamptz, p_limit integer
)
returns setof public.background_jobs language sql volatile security invoker
set search_path = public as $$
  with candidates as (
    select j.id
    from public.background_jobs j
    where j.kind = p_kind
      and j.status = 'running'
      and j.locked_at is not null
      and j.locked_at <= p_stale_before
      and j.attempts >= j.max_attempts
    order by j.locked_at, j.created_at, j.id
    limit greatest(p_limit, 0)
    for update of j skip locked
  )
  update public.background_jobs j set
    locked_at = p_now,
    locked_by = p_worker_id,
    lease_token = gen_random_uuid(),
    error = 'Worker lease expired after final attempt',
    updated_at = p_now
  from candidates c where j.id = c.id returning j.*;
$$;

revoke all on function public.claim_terminal_background_jobs(
  text, text, timestamptz, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.claim_terminal_background_jobs(
  text, text, timestamptz, timestamptz, integer
) to service_role;
