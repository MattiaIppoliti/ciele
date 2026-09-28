-- The retention sweeps delete in bounded batches.
--
-- `delete_expired_conversations` and `clear_expired_traces` were one statement
-- per Organization over everything expired. The first sweep after a large
-- tenant switched retention on had to delete years of Conversations (and their
-- cascades) in one transaction inside one function timeout; when that ran out
-- it made no progress at all, every night. Each call now handles at most
-- `p_limit` rows, oldest first, and the sweep calls again until a batch comes
-- back short.
--
-- The old two-argument signatures are dropped rather than overloaded: a third
-- argument with a default beside a two-argument twin makes every two-argument
-- call ambiguous. Code that still calls with two named arguments resolves to
-- the new function and gets the default batch.

drop function if exists public.delete_expired_conversations(uuid, timestamptz);
drop function if exists public.clear_expired_traces(uuid, timestamptz);

create or replace function public.delete_expired_conversations(
  p_organization_id uuid,
  p_cutoff timestamptz,
  p_limit integer default 5000
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  deleted integer;
begin
  with expired as (
    select c.id
    from public.conversations c
    left join public.assistants a on a.id = c.assistant_id
    left join public.teammates t on t.id = c.teammate_id
    where coalesce(a.organization_id, t.organization_id) = p_organization_id
      and c.legal_hold = false
      and c.updated_at < p_cutoff
    order by c.updated_at
    limit greatest(p_limit, 1)
  )
  delete from public.conversations c
  using expired
  where c.id = expired.id;
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

comment on function public.delete_expired_conversations(uuid, timestamptz, integer) is
  'Deletes up to p_limit of one Organization''s Conversations whose last activity (updated_at) predates the cutoff, oldest first, skipping legal holds. Idempotent; call again until it returns less than p_limit.';

create or replace function public.clear_expired_traces(
  p_organization_id uuid,
  p_cutoff timestamptz,
  p_limit integer default 5000
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  cleared integer;
begin
  with expired as (
    select m.id
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    join public.assistants a on a.id = c.assistant_id
    where a.organization_id = p_organization_id
      and m.trace is not null
      and m.created_at < p_cutoff
    order by m.created_at
    limit greatest(p_limit, 1)
  )
  update public.messages m
  set trace = null
  from expired
  where m.id = expired.id;
  get diagnostics cleared = row_count;
  return cleared;
end;
$$;
