-- Verifier priority sampling (spec: verifier consequences): human signals
-- first. Candidates order: answers with a thumbs-down, then answers in
-- escalated conversations, then newest, so the verifier amplifies what
-- humans already flagged before sampling the rest.

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
  order by
    (m.feedback = -1) desc,
    coalesce((c.metadata ->> 'escalated')::boolean, false) desc,
    m.created_at desc
  limit p_limit;
$$;
