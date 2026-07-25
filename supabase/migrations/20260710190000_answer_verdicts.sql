-- Answer verdicts (spec: independent answer verifier). One verdict per
-- message — the primary key doubles as the idempotence guard, so concurrent
-- verifier ticks can never double-grade an answer. Written by the scheduled
-- verifier via the service role; members read for Inbox surfacing and the
-- trust ledger.

create table public.answer_verdicts (
  message_id text primary key references public.messages (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  assistant_id text,
  flow_id text,
  verdict text not null check (verdict in ('pass', 'fail')),
  reason text not null default '',
  -- The grading model (fresh-context, cheap tier) — never the answering model's chain.
  model_id text not null default '',
  created_at timestamptz not null default now()
);

create index answer_verdicts_org_created_idx
  on public.answer_verdicts (organization_id, created_at desc);
create index answer_verdicts_assistant_flow_idx
  on public.answer_verdicts (assistant_id, flow_id, created_at desc);

alter table public.answer_verdicts enable row level security;

create policy "members read verdicts" on public.answer_verdicts
  for select using (private.is_org_member(organization_id));

-- Newest unverified generative answers, with the question that prompted each.
-- Only answers with generative text (search_knowledge) are candidates:
-- verbatim Message parts, fallback/error and refusal turns are excluded at
-- the query so they are never returned again and again.
create or replace function public.list_unverified_answers(p_limit integer)
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
language sql
stable
set search_path = public
as $$
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
  where m.role = 'assistant'
    and v.message_id is null
    and exists (
      select 1 from jsonb_array_elements(m.content) p
      where p ->> 'type' = 'text'
        and p ->> 'action' = 'search_knowledge'
    )
  order by m.created_at desc
  limit p_limit;
$$;
