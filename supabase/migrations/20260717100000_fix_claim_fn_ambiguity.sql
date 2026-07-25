-- Fix runtime ambiguity in the verifier and compost claim functions (#334).
--
-- Both plpgsql functions reference their own OUT/table columns unqualified
-- inside their claim CTEs (`select message_id … from candidates`,
-- `select assistant_id … from due`). plpgsql's variable substitution treats
-- those OUT parameters as variables, and with the default
-- plpgsql.variable_conflict = error every call fails at runtime with
-- `column reference "message_id" is ambiguous` — caught by the Db contract
-- suite running the real functions over the real migrations in PGlite.
-- Neither function ever reads its OUT params as variables, so
-- `#variable_conflict use_column` (resolve unqualified names to columns) is
-- the exact fix. Bodies are otherwise verbatim from 20260711120000 and
-- 20260711130000.

create or replace function public.claim_unverified_answers(
  p_limit integer,
  p_stale_before timestamptz
)
returns table (
  message_id text,
  conversation_id text,
  assistant_id text,
  organization_id uuid,
  flow_id text,
  flow_name text,
  content jsonb,
  question text,
  created_at timestamptz
)
language plpgsql
volatile
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  with candidates as (
    select
      m.id as message_id,
      m.conversation_id,
      c.assistant_id,
      a.organization_id,
      m.flow_id,
      m.flow_name,
      m.content,
      (
        select p.value ->> 'text'
        from public.messages mm,
          lateral jsonb_array_elements(mm.content) p
        where mm.conversation_id = m.conversation_id
          and mm.role = 'user'
          and mm.created_at < m.created_at
          and p.value ->> 'type' = 'text'
        order by mm.created_at desc
        limit 1
      ) as question,
      m.created_at
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    join public.assistants a on a.id = c.assistant_id
    left join public.answer_verdicts v on v.message_id = m.id
    left join public.answer_verifier_claims cl on cl.message_id = m.id
    where m.role = 'assistant'
      and v.message_id is null
      and (cl.message_id is null or cl.claimed_at < p_stale_before)
      and exists (
        select 1 from jsonb_array_elements(m.content) p
        where p ->> 'type' = 'text'
          and p ->> 'action' = 'search_knowledge'
      )
    order by
      (m.feedback = -1) desc,
      coalesce((c.metadata ->> 'escalated')::boolean, false) desc,
      m.created_at desc
    limit p_limit
  ),
  claimed as (
    insert into public.answer_verifier_claims (message_id, claimed_at)
    select message_id, now() from candidates
    on conflict (message_id) do update
      set claimed_at = now()
      where public.answer_verifier_claims.claimed_at < p_stale_before
    returning message_id
  )
  select
    cand.message_id,
    cand.conversation_id,
    cand.assistant_id,
    cand.organization_id,
    cand.flow_id,
    cand.flow_name,
    cand.content,
    cand.question,
    cand.created_at
  from candidates cand
  join claimed using (message_id);
end;
$$;

create or replace function public.claim_due_compost_assistants(
  p_due_before timestamptz,
  p_stale_before timestamptz,
  p_limit integer
)
returns table (
  assistant_id text,
  organization_id uuid,
  last_run_at timestamptz
)
language plpgsql
volatile
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select
      a.id as assistant_id,
      a.organization_id,
      r.created_at as last_run_at
    from public.assistants a
    join public.organizations o on o.id = a.organization_id
    left join lateral (
      select created_at from public.compost_runs
      where assistant_id = a.id
      order by created_at desc
      limit 1
    ) r on true
    left join public.compost_claims cl on cl.assistant_id = a.id
    where o.compost_opt_out = false
      and exists (select 1 from public.publications p where p.assistant_id = a.id)
      and (r.created_at is null or r.created_at < p_due_before)
      and (cl.assistant_id is null or cl.claimed_at < p_stale_before)
    order by r.created_at asc nulls first
    limit p_limit
  ),
  claimed as (
    insert into public.compost_claims (assistant_id, claimed_at)
    select assistant_id, now() from due
    on conflict (assistant_id) do update
      set claimed_at = now()
      where public.compost_claims.claimed_at < p_stale_before
    returning assistant_id
  )
  select d.assistant_id, d.organization_id, d.last_run_at
  from due d
  join claimed c using (assistant_id);
end;
$$;
