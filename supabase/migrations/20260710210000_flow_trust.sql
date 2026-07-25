-- Flow trust ledger (spec: measured trust per (Assistant, Flow)). A nightly
-- job materializes a rolling pass rate from graded signals — verifier
-- verdicts and explicit Visitor feedback (verdict wins when both exist) —
-- into earned tiers. Service-role writes; members read for Flow badges.

create table public.flow_trust (
  assistant_id text not null references public.assistants (id) on delete cascade,
  flow_id text not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  runs integer not null default 0,
  passes integer not null default 0,
  tier text not null check (tier in ('auto', 'queue', 'watch')),
  previous_tier text check (previous_tier in ('auto', 'queue', 'watch')),
  computed_at timestamptz not null default now(),
  primary key (assistant_id, flow_id)
);

create index flow_trust_org_idx on public.flow_trust (organization_id);

alter table public.flow_trust enable row level security;

create policy "members read flow trust" on public.flow_trust
  for select using (private.is_org_member(organization_id));

-- Graded signals feeding the ledger, newest first: one row per verifier
-- verdict, plus explicit feedback on generative answers that have no
-- verdict yet (the verdict wins when both exist).
create or replace function public.list_trust_signals(p_limit integer)
returns table (
  organization_id uuid,
  assistant_id text,
  flow_id text,
  message_id text,
  pass boolean,
  reason text,
  created_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select * from (
    select
      v.organization_id,
      v.assistant_id,
      v.flow_id,
      v.message_id,
      (v.verdict = 'pass') as pass,
      v.reason,
      v.created_at
    from public.answer_verdicts v
    where v.flow_id is not null and v.assistant_id is not null
    union all
    select
      a.organization_id,
      c.assistant_id,
      m.flow_id,
      m.id as message_id,
      (m.feedback = 1) as pass,
      'visitor feedback' as reason,
      m.created_at
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    join public.assistants a on a.id = c.assistant_id
    left join public.answer_verdicts v2 on v2.message_id = m.id
    where m.role = 'assistant'
      and m.feedback <> 0
      and m.flow_id is not null
      and v2.message_id is null
      and exists (
        select 1 from jsonb_array_elements(m.content) p
        where p ->> 'type' = 'text'
          and p ->> 'action' = 'search_knowledge'
      )
  ) signals
  order by created_at desc
  limit p_limit;
$$;
