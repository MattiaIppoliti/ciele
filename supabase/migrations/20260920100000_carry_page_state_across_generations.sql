-- Per-page admin state survives a re-crawl.
--
-- 20260828070100 made a re-crawl a generation swap: every page is staged as a
-- fresh row with a fresh random id, and one compare-and-swap flips visibility.
-- Two columns on public.concepts are admin decisions about a page rather than
-- crawled material, and both were keyed only by concepts.id:
--
--   excluded          (0008_website_config) keep this page out of retrieval
--   recrawl_schedule  (0038) per-page cadence; null inherits the Source
--
-- Neither the staging function nor the cutover carried them, so every re-crawl
-- silently reverted both: an excluded page became retrievable again, and a
-- page-level cadence fell back to the site's.
--
-- The stable page identity across generations is (source_id, path), already
-- indexed by concepts_active_source_path_idx. The carry happens here, at
-- cutover, rather than in stage_source_concept, for two reasons. The outgoing
-- rows are still active at this point, so a decision an admin makes *while* a
-- crawl is running is honoured too; and it is one set-based update over that
-- index instead of a lookup per staged page, leaving the on conflict
-- (staging_key) replay path untouched.
--
-- A page that disappears from a crawl and later returns comes back included,
-- inheriting the Source cadence. Deliberate: the state lives on the page row,
-- the row dies with its retired generation, and remembering it would mean a
-- second source of truth for a column match_chunks_* reads plus an unbounded
-- store of decisions about pages that may never return.

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
      recrawl_schedule = prior.recrawl_schedule
  from (
    select distinct on (path) path, excluded, recrawl_schedule
    from public.concepts
    where source_id = p_source_id
      and is_active = true
    order by path, excluded desc, id
  ) prior
  where incoming.source_id = p_source_id
    and incoming.generation_id = p_generation_id
    and incoming.is_active = false
    and incoming.path = prior.path
    and (incoming.excluded, incoming.recrawl_schedule)
        is distinct from (prior.excluded, prior.recrawl_schedule);

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
