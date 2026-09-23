-- A Document's Summary lives on the Document row (ticket ciele-org#931).
--
-- Two columns, no table. The Summary is made the first time a Member opens a
-- Document and cached for everyone after them, and the thing that makes a
-- cached summary dangerous is a page that changed underneath it. The
-- generation scheme (20260828070100) already solves that: a re-crawl stages a
-- fresh row per page and the old one is retired, so a summary written against
-- last month's text cannot survive the crawl that replaced it. There is
-- nothing to invalidate, which is why there is no invalidation code.
--
-- `summary_generated_by` / `_at` are OKF `generated` (§5.2) in the actor
-- convention, as `knowledge_memories` writes it: `<producer>/<version>` for a
-- model. A summary with no recorded author would be a provenance lie, so a
-- row either has both or has neither.

alter table public.concepts
  add column if not exists summary text,
  add column if not exists summary_generated_by text,
  add column if not exists summary_generated_at timestamptz;

-- The carry at cutover, beside the two admin flags 20260920100000 already
-- carries. The difference is the condition: `excluded` and `recrawl_schedule`
-- are decisions *about* a page and follow it whatever it now says, while a
-- summary is a statement about the page's text and may only follow text that
-- did not change. Hence `incoming.body = prior.body`, which is what makes
-- "a re-crawl that changed nothing keeps its summary" and "a re-crawl that
-- rewrote the page loses it" the same line of SQL.
create or replace function public.commit_source_knowledge_generation(
  p_source_id text,
  p_expected_active_generation_id uuid,
  p_generation_id uuid
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_active_generation_id uuid;
begin
  select s.active_generation_id
    into v_active_generation_id
  from public.sources s
  where s.id = p_source_id
  for update;

  if not found or v_active_generation_id is distinct from p_expected_active_generation_id then
    return false;
  end if;

  if not exists (
    select 1
    from public.concepts c
    where c.source_id = p_source_id
      and c.generation_id = p_generation_id
  ) then
    return false;
  end if;

  -- Carry the outgoing page's admin state onto the incoming page with the same
  -- path. distinct on keeps the pick deterministic if a Source ever carries two
  -- active rows for one path (the index is not unique); excluded desc makes the
  -- tie fail safe, an exclusion is never dropped by the tie-break.
  update public.concepts incoming
  set excluded = prior.excluded,
      recrawl_schedule = prior.recrawl_schedule,
      -- Only onto identical text. A changed page gets no summary and the next
      -- opener pays for one, which is the whole point of caching per
      -- generation rather than per page.
      summary = case when incoming.body = prior.body then prior.summary else null end,
      summary_generated_by = case
        when incoming.body = prior.body then prior.summary_generated_by else null
      end,
      summary_generated_at = case
        when incoming.body = prior.body then prior.summary_generated_at else null
      end
  from (
    select distinct on (path)
      path, excluded, recrawl_schedule, body,
      summary, summary_generated_by, summary_generated_at
    from public.concepts
    where source_id = p_source_id
      and is_active = true
    order by path, excluded desc, id
  ) prior
  where incoming.source_id = p_source_id
    and incoming.generation_id = p_generation_id
    and incoming.is_active = false
    and incoming.path = prior.path
    and (
      -- Something to carry: an admin decision that differs, or a summary that
      -- belongs to text this generation did not change.
      (incoming.excluded, incoming.recrawl_schedule)
        is distinct from (prior.excluded, prior.recrawl_schedule)
      or (incoming.body = prior.body and prior.summary is not null)
    );

  update public.concepts
  set is_active = false
  where source_id = p_source_id
    and is_active = true;

  update public.concepts
  set is_active = true
  where source_id = p_source_id
    and generation_id = p_generation_id;

  update public.sources
  set active_generation_id = p_generation_id,
      updated_at = now()
  where id = p_source_id;

  return true;
end;
$$;

revoke all on function public.commit_source_knowledge_generation(
  text, uuid, uuid
) from public, anon;
grant execute on function public.commit_source_knowledge_generation(
  text, uuid, uuid
) to authenticated, service_role;

comment on column public.concepts.summary is
  'Generated on first open and cached for this generation (#931). Null means nobody has opened this Document yet.';
