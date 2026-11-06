-- The answer-improvement workflow (docs/design/answer-improvement-workflow.md):
-- storage-level board filters, Publication and knowledge fingerprints, and
-- append-only validation evidence with an atomically queued replay job.
-- Additive only: nothing here changes an existing column, policy or function.

-- Board filters ---------------------------------------------------------------
--
-- One predicate for the page, the lane counts, the export and a Project's
-- stage counts. `apps/web`, both Db adapters and services/ciele-api read
-- through it, so a filter is never applied to a window of rows. Security
-- invoker: RLS on `improvements` still decides what a session caller sees, and
-- the service-role callers (an API key) pass their own Organization as `org`.
-- `filters` keys: search, priority, assigneeId (JSON null = unassigned),
-- projectId, assistantId. Other keys are ignored.
create or replace function public.matching_improvements(org uuid, filters jsonb default '{}')
returns setof public.improvements
language sql stable security invoker set search_path = ''
as $$
  select i.* from public.improvements i
  where i.organization_id = org
    and (not (filters ? 'priority') or i.priority = filters->>'priority')
    and (not (filters ? 'assigneeId') or i.assignee_id::text is not distinct from filters->>'assigneeId')
    and (not (filters ? 'projectId') or i.project_id = filters->>'projectId')
    and (coalesce(btrim(filters->>'search'), '') = ''
      or position(lower(btrim(filters->>'search')) in lower(i.title)) > 0
      or position(lower(btrim(filters->>'search')) in lower('IMP-' || i.seq)) > 0
      or exists (
        select 1 from jsonb_array_elements_text(i.tags) tag
        where position(lower(btrim(filters->>'search')) in lower(tag)) > 0
      ))
    and (not (filters ? 'assistantId') or exists (
      select 1 from public.improvement_messages l
      join public.messages m on m.id = l.message_id
      join public.conversations c on c.id = m.conversation_id
      where l.improvement_id = i.id and c.assistant_id = filters->>'assistantId'
    ));
$$;

-- One page, newest `seq` first, `page_limit + 1` rows so the caller can tell
-- whether another page exists.
create or replace function public.query_improvements(
  org uuid,
  filters jsonb default '{}',
  page_limit integer default 50,
  before_seq integer default null,
  lane text default null
)
returns table(item jsonb)
language sql stable security invoker set search_path = ''
as $$
  select to_jsonb(i) || jsonb_build_object(
    'message_count',
    (select count(*) from public.improvement_messages l where l.improvement_id = i.id)
  )
  from public.matching_improvements(org, filters) i
  where (before_seq is null or i.seq < before_seq) and (lane is null or i.status = lane)
  order by i.seq desc
  limit greatest(1, least(page_limit, 100)) + 1;
$$;

create or replace function public.count_filtered_improvements(org uuid, filters jsonb default '{}')
returns table(status text, total bigint)
language sql stable security invoker set search_path = ''
as $$
  select i.status, count(*) from public.matching_improvements(org, filters) i group by i.status;
$$;

revoke all on function
  public.matching_improvements(uuid, jsonb),
  public.query_improvements(uuid, jsonb, integer, integer, text),
  public.count_filtered_improvements(uuid, jsonb)
from public, anon;
grant execute on function
  public.matching_improvements(uuid, jsonb),
  public.query_improvements(uuid, jsonb, integer, integer, text),
  public.count_filtered_improvements(uuid, jsonb)
to authenticated, service_role;

-- Validation fingerprint ------------------------------------------------------
--
-- The latest Publication plus every linked Source and Concept row, content
-- included. A validation recorded under one fingerprint reads as stale once
-- either side changes, so a pass never outlives the version it checked.
create or replace function public.assistant_validation_snapshot(target text)
returns text
language sql stable security invoker set search_path = ''
as $$
  select md5(
    coalesce((select p.id from public.publications p
      where p.assistant_id = target order by p.version desc limit 1), '')
    || coalesce((select string_agg(to_jsonb(s)::text, '' order by s.id)
      from public.sources s
      join public.assistant_sources l on l.source_id = s.id
      where l.assistant_id = target), '')
    || coalesce((select string_agg(md5(to_jsonb(c)::text), '' order by c.id)
      from public.concepts c
      join public.assistant_sources l on l.source_id = c.source_id
      where l.assistant_id = target), '')
  );
$$;
revoke all on function public.assistant_validation_snapshot(text) from public, anon;
grant execute on function public.assistant_validation_snapshot(text) to authenticated, service_role;

-- Validation evidence ---------------------------------------------------------

create table public.improvement_validations (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  improvement_id text not null references public.improvements (id) on delete cascade,
  assistant_id text not null references public.assistants (id) on delete cascade,
  -- Evidence outlives the Member who recorded it: a departed validator is
  -- nulled, never a reason to block their removal or delete the record.
  validator_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('manual', 'replay')),
  status text not null check (status in ('pending', 'pass', 'fail', 'error')),
  expected_behavior text not null,
  changed_resources text not null,
  detail text not null default '',
  publication_id text references public.publications (id) on delete set null,
  snapshot text not null,
  cases jsonb not null default '[]'::jsonb,
  results jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index improvement_validations_item_idx
  on public.improvement_validations (organization_id, improvement_id, created_at desc);
create index improvement_validations_improvement_idx
  on public.improvement_validations (improvement_id);
create index improvement_validations_assistant_idx
  on public.improvement_validations (assistant_id);
create index improvement_validations_validator_idx
  on public.improvement_validations (validator_id);
create index improvement_validations_publication_idx
  on public.improvement_validations (publication_id);
-- One replay in flight per Improvement.
create unique index improvement_validations_pending_idx
  on public.improvement_validations (organization_id, improvement_id)
  where kind = 'replay' and status = 'pending';

alter table public.improvement_validations enable row level security;

-- A record names an Assistant and may carry its answers, so reading it needs
-- that Assistant as well as the Organization (per-Assistant access).
create policy "members read improvement validations" on public.improvement_validations
  for select to authenticated
  using (
    private.is_org_member(organization_id)
    and private.has_assistant_role(assistant_id, 1)
  );

-- An Editor of the Assistant records their own evidence. A manual record is
-- final on insert; a replay starts pending and only the service-role worker
-- writes its outcome. No update or delete policy: the evidence is append-only.
create policy "editors record improvement validations" on public.improvement_validations
  for insert to authenticated
  with check (
    private.has_org_role(organization_id, 2)
    and private.has_assistant_role(assistant_id, 2)
    and validator_id = (select auth.uid())
    and exists (
      select 1 from public.improvements i
      where i.id = improvement_id
        and i.organization_id = improvement_validations.organization_id
    )
    and exists (
      select 1 from public.assistants a
      where a.id = assistant_id
        and a.organization_id = improvement_validations.organization_id
    )
    and (publication_id is null or exists (
      select 1 from public.publications p
      where p.id = publication_id
        and p.assistant_id = improvement_validations.assistant_id
    ))
    and (
      (kind = 'manual' and status in ('pass', 'fail'))
      or (kind = 'replay' and status = 'pending')
    )
  );

revoke all on public.improvement_validations from anon, authenticated;
grant select, insert on public.improvement_validations to authenticated;
grant all on public.improvement_validations to service_role;

-- The replay job kind ---------------------------------------------------------
--
-- Same list as 20261028172000_summarize_conversation_job_kind (the latest
-- redefinition) plus replay_improvement.
alter table public.background_jobs
  drop constraint if exists background_jobs_kind_check;
alter table public.background_jobs
  add constraint background_jobs_kind_check
  check (kind in (
    'ingest_source',
    'graph_sync_concept',
    'draft_improvement_proposal',
    'draft_goal_proposal',
    'promote_memories',
    'distill_agent_memory',
    'sync_entity_records',
    'sync_application_import',
    'deliver_review_request',
    'resume_reviewed_conversation',
    'resume_webhook_conversation',
    'answer_slack_mention',
    'extract_document_memories',
    'deliver_outbound_webhook',
    'score_assistant_answer',
    'notify_export_ready',
    'summarize_conversation',
    'replay_improvement'
  ));

-- The replay request and its job land in one transaction, so a process exit
-- cannot strand a pending record with nothing queued to finish it. Security
-- definer because the requesting Member has no insert policy on the job
-- ledger; the row it writes is fixed by the validation the policy above
-- already admitted. One attempt: a lost worker must not repeat paid model work.
create function public.queue_improvement_replay()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind = 'replay' then
    insert into public.background_jobs (id, organization_id, kind, payload, max_attempts)
    values (
      'replay-' || new.id,
      new.organization_id,
      'replay_improvement',
      jsonb_build_object('validationId', new.id),
      1
    );
  end if;
  return new;
end
$$;
revoke all on function public.queue_improvement_replay() from public, anon, authenticated;

create trigger queue_improvement_replay
  after insert on public.improvement_validations
  for each row execute function public.queue_improvement_replay();
