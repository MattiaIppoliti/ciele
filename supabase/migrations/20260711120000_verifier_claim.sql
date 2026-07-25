-- Verifier claim (spec: overlapping ticks must never double-grade an answer).
-- The one-verdict-per-message primary key on answer_verdicts is the final
-- backstop, but it only guards the write — the model call happens first, so a
-- second concurrent tick could still pay to grade the same answer. A dedicated
-- per-message claim stamp closes that window: a tick claims candidates before
-- grading; a claim expires with the cadence window, so a crashed run simply
-- retries on the next tick (mirrors the goal runner's lease).

create table public.answer_verifier_claims (
  message_id text primary key references public.messages (id) on delete cascade,
  claimed_at timestamptz not null default now()
);

alter table public.answer_verifier_claims enable row level security;
-- Service-role only: the scheduled verifier writes and reads these; no member
-- surface needs them (a graded answer is excluded by its verdict row anyway).

-- Atomically claims the newest unverified generative answers in priority order
-- (👎, then escalated conversations, then newest) that carry no verdict yet and
-- no fresh claim. The claim insert on the message-id primary key serializes
-- concurrent ticks; a stale claim (older than p_stale_before) is re-claimable.
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
