-- A bounded, server-filtered Inbox read model. The former adapter read joined
-- every Conversation to every Message in the Organization and only then let
-- the browser apply its default 30-day window. This function keeps the RLS
-- invoker semantics but makes work proportional to one visible page.

create index if not exists conversations_assistant_updated_id_idx
  on public.conversations (assistant_id, updated_at desc, id desc);

create or replace function public.get_inbox_page(
  p_organization_id uuid,
  p_limit integer default 50,
  p_cursor_updated_at timestamptz default null,
  p_cursor_id text default null,
  p_search text default null,
  p_user_info text default null,
  p_location text default null,
  p_city text default null,
  p_role text default null,
  p_from date default null,
  p_to date default null,
  p_assistant_id text default null,
  p_language text default null,
  p_workflow text default null,
  p_conversation_ids text[] default null,
  p_feedback text default null,
  p_escalation text default null,
  p_staff text default null
)
returns table (
  id text,
  assistant_id text,
  subject_type text,
  subject_id text,
  collection_id text,
  title text,
  metadata jsonb,
  pinned boolean,
  created_at timestamptz,
  updated_at timestamptz,
  assistant_title text,
  collection_name text,
  message_count bigint,
  flow_names text[],
  notification_only boolean,
  feedback smallint
)
language sql
security invoker
set search_path = public
as $$
  select
    c.id,
    c.assistant_id,
    c.subject_type,
    c.subject_id,
    c.collection_id,
    c.title,
    coalesce(c.metadata, '{}'::jsonb) as metadata,
    c.pinned,
    c.created_at,
    c.updated_at,
    a.title as assistant_title,
    kc.name as collection_name,
    coalesce(ms.message_count, 0) as message_count,
    coalesce(ms.flow_names, '{}'::text[]) as flow_names,
    coalesce(ms.message_count > 0 and ms.all_proactive, false) as notification_only,
    case
      when coalesce(ms.has_positive, false) then 1::smallint
      when coalesce(ms.has_negative, false) then -1::smallint
      else 0::smallint
    end as feedback
  from public.conversations c
  join public.assistants a on a.id = c.assistant_id
  left join public.knowledge_collections kc on kc.id = c.collection_id
  left join lateral (
    select
      count(*)::bigint as message_count,
      coalesce(
        array_agg(distinct m.flow_name order by m.flow_name)
          filter (where m.flow_name is not null),
        '{}'::text[]
      ) as flow_names,
      coalesce(bool_and(m.proactive), false) as all_proactive,
      coalesce(bool_or(m.feedback = 1), false) as has_positive,
      coalesce(bool_or(m.feedback = -1), false) as has_negative
    from public.messages m
    where m.conversation_id = c.id
  ) ms on true
  where a.organization_id = p_organization_id
    and (p_from is null or c.updated_at >= p_from::timestamptz)
    and (p_to is null or c.updated_at < (p_to + 1)::timestamptz)
    and (p_assistant_id is null or c.assistant_id = p_assistant_id)
    and (p_location is null or c.metadata ->> 'location' = p_location)
    and (p_city is null or c.metadata ->> 'city' = p_city)
    and (p_role is null or c.metadata ->> 'userRole' = p_role)
    and (p_language is null or c.metadata ->> 'language' = p_language)
    and (
      p_search is null
      or position(lower(p_search) in lower(c.title)) > 0
      or position(lower(p_search) in lower(c.subject_id)) > 0
      or position(lower(p_search) in lower(coalesce(c.metadata ->> 'userEmail', ''))) > 0
      or position(lower(p_search) in lower(coalesce(c.metadata ->> 'userName', ''))) > 0
      or position(
        lower(p_search) in lower(
          coalesce(
            nullif(c.metadata ->> 'userName', ''),
            nullif(split_part(c.metadata ->> 'userEmail', '@', 1), ''),
            nullif(c.metadata ->> 'ssoClaimValue', ''),
            case
              when c.subject_type = 'member' then 'Member'
              when c.subject_type = 'sso' then 'Signed-in user'
              else 'Visitor'
            end
          )
        )
      ) > 0
    )
    and (
      p_user_info is null
      or position(lower(p_user_info) in lower(c.subject_id)) > 0
      or position(lower(p_user_info) in lower(coalesce(c.metadata ->> 'userEmail', ''))) > 0
      or position(lower(p_user_info) in lower(coalesce(c.metadata ->> 'userName', ''))) > 0
      or position(lower(p_user_info) in lower(coalesce(c.metadata ->> 'userRole', ''))) > 0
    )
    and (
      p_workflow is null
      or exists (
        select 1 from public.messages m
        where m.conversation_id = c.id and m.flow_name = p_workflow
      )
    )
    and (p_conversation_ids is null or c.id = any(p_conversation_ids))
    and (
      p_feedback is null
      or (p_feedback = 'up' and coalesce(ms.has_positive, false))
      or (p_feedback = 'down' and coalesce(ms.has_negative, false))
    )
    and (
      p_escalation is null
      or (
        p_escalation = 'escalated'
        and coalesce((c.metadata ->> 'escalated')::boolean, false)
      )
      or (
        p_escalation = 'not_escalated'
        and not coalesce((c.metadata ->> 'escalated')::boolean, false)
      )
    )
    and (
      coalesce(p_staff, '') = 'include'
      or (coalesce(p_staff, '') = 'only' and c.subject_type = 'member')
      or (coalesce(p_staff, '') = '' and c.subject_type <> 'member')
    )
    and (
      p_cursor_updated_at is null
      or (c.updated_at, c.id) < (p_cursor_updated_at, p_cursor_id)
    )
  order by c.updated_at desc, c.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100) + 1;
$$;

revoke execute on function public.get_inbox_page(
  uuid, integer, timestamptz, text, text, text, text, text, text, date, date,
  text, text, text, text[], text, text, text
) from public, anon;
grant execute on function public.get_inbox_page(
  uuid, integer, timestamptz, text, text, text, text, text, text, date, date,
  text, text, text, text[], text, text, text
) to authenticated;

-- Filter values are independent from the current page. Load this compact read
-- only when the filter panel opens, so Inbox navigation never waits for an
-- Organization-wide distinct scan.
create or replace function public.get_inbox_facets(p_organization_id uuid)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  with org_conversations as materialized (
    select c.id, c.metadata
    from public.conversations c
    join public.assistants a on a.id = c.assistant_id
    where a.organization_id = p_organization_id
  ),
  facet_values as (
    select 'locations' as facet, metadata ->> 'location' as value from org_conversations
    union all
    select 'cities', metadata ->> 'city' from org_conversations
    union all
    select 'roles', metadata ->> 'userRole' from org_conversations
    union all
    select 'languages', metadata ->> 'language' from org_conversations
    union all
    select 'workflows', m.flow_name
    from public.messages m
    join org_conversations c on c.id = m.conversation_id
  ),
  distinct_values as (
    select distinct facet, value
    from facet_values
    where value is not null and value <> ''
  ),
  ranked_values as (
    select
      facet,
      value,
      row_number() over (partition by facet order by value) as rank
    from distinct_values
  )
  select jsonb_build_object(
    'locations', coalesce((select jsonb_agg(value order by value) from ranked_values where facet = 'locations' and rank <= 200), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(value order by value) from ranked_values where facet = 'cities' and rank <= 200), '[]'::jsonb),
    'roles', coalesce((select jsonb_agg(value order by value) from ranked_values where facet = 'roles' and rank <= 200), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(value order by value) from ranked_values where facet = 'languages' and rank <= 200), '[]'::jsonb),
    'workflows', coalesce((select jsonb_agg(value order by value) from ranked_values where facet = 'workflows' and rank <= 200), '[]'::jsonb)
  );
$$;

revoke execute on function public.get_inbox_facets(uuid) from public, anon;
grant execute on function public.get_inbox_facets(uuid) to authenticated;
