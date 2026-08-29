-- Insights reporting after Collections stopped belonging to an Assistant
-- (PRD #726, ticket #733). `20260819120000_knowledge_collections_contract`
-- dropped `knowledge_collections.assistant_id` and updated every policy and
-- claim RPC that read it, but not `get_insights_overview`, which still joined
-- Assistants through that column to name the Channels. A `language sql`
-- function is parsed on first call, so the dead reference did not surface at
-- migration time: it surfaced as `42703 column kc.assistant_id does not exist`
-- on every single request, and /insights has 500'd ever since.
--
-- Two reads change, nothing else. The function is otherwise the
-- 20260808121000 text verbatim, so the notification accounting (#546) and the
-- staff-conversation exclusion (#668) carry over unchanged.
--
--   1. `channel_names` reaches the Organization the way the rest of the
--      knowledge hub now does, through `knowledge_collections.organization_id`.
--   2. The Channels *option* list, when one Assistant is selected, keys on the
--      assistant<->source link table. "The websites this Assistant answers
--      from" is what that filter means, and the link table is the only place
--      that fact lives now.
--
-- Note (2) is slightly wider than the mock/demo oracle, whose `OrgWebsiteSource`
-- carries a single `assistantId` (the earliest link, see `listWebsiteSources`):
-- a Source linked to two Assistants is offered under both here and under one
-- there. Production is the honest side; the demo path cannot represent a shared
-- Source at all.

create or replace function public.get_insights_overview(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_aggregate text,
  p_assistant_id text default null,
  p_channel text default null,
  p_role text default null,
  p_feedback text default null,
  p_escalation text default null
)
returns jsonb
language sql
security invoker
set search_path = public
as $$
with
all_conversations as (
  select
    c.id,
    c.assistant_id,
    a.title as assistant_title,
    c.subject_id,
    c.created_at,
    coalesce(c.metadata, '{}'::jsonb) as metadata,
    nullif(
      regexp_replace(
        split_part(regexp_replace(coalesce(c.metadata ->> 'launchUrl', ''), '^https?://', '', 'i'), '/', 1),
        '^www\.',
        '',
        'i'
      ),
      ''
    ) as host,
    c.metadata ->> 'userRole' as user_role,
    c.metadata ->> 'language' as language,
    coalesce((c.metadata ->> 'escalated')::boolean, false) as escalated,
    coalesce(nullif(c.metadata ->> 'userEmail', ''), c.subject_id) as user_key,
    case
      when exists (
        select 1 from public.messages m
        where m.conversation_id = c.id and m.feedback = 1
      ) then 1
      when exists (
        select 1 from public.messages m
        where m.conversation_id = c.id and m.feedback = -1
      ) then -1
      else 0
    end as feedback,
    -- Rule 2's test, carried as a column so both populations can be derived from
    -- one pass. An empty conversation is not "only" notifications and keeps its
    -- previous treatment.
    (
      exists (
        select 1 from public.messages m where m.conversation_id = c.id
      )
      and not exists (
        select 1 from public.messages m
        where m.conversation_id = c.id and not m.proactive
      )
    ) as notification_only
  from public.conversations c
  join public.assistants a on a.id = c.assistant_id
  where a.organization_id = p_organization_id
    -- Preview and Data Assistant traffic is internal staff usage.
    and c.subject_type <> 'member'
),
-- Every conversation the filters admit, nudge-only ones included. Only the
-- Notifications count reads this: a nudge nobody replied to still went out.
filtered_all_conversations as (
  select *
  from all_conversations
  where created_at >= p_from::timestamptz
    and created_at < (p_to + 1)::timestamptz
    and (p_assistant_id is null or assistant_id = p_assistant_id)
    and (p_channel is null or host = p_channel)
    and (p_role is null or user_role = p_role)
    and (p_feedback is null
      or (p_feedback = 'up' and feedback = 1)
      or (p_feedback = 'down' and feedback = -1))
    and (p_escalation is null
      or (p_escalation = 'escalated' and escalated)
      or (p_escalation = 'not_escalated' and not escalated))
),
-- Rule 2: everything else counts conversations the Visitor actually joined.
filtered_conversations as (
  select * from filtered_all_conversations where not notification_only
),
filtered_messages as (
  select
    m.conversation_id,
    m.role,
    m.feedback,
    m.created_at,
    m.proactive
  from public.messages m
  join filtered_conversations c on c.id = m.conversation_id
  where m.created_at >= p_from::timestamptz
    and m.created_at < (p_to + 1)::timestamptz
),
proactive_messages as (
  select m.created_at
  from public.messages m
  join filtered_all_conversations c on c.id = m.conversation_id
  where m.proactive
    and m.created_at >= p_from::timestamptz
    and m.created_at < (p_to + 1)::timestamptz
),
buckets as (
  select value::date as bucket
  from generate_series(
    case p_aggregate
      when 'weekly' then date_trunc('week', p_from)::date
      when 'monthly' then date_trunc('month', p_from)::date
      else p_from
    end,
    p_to,
    case p_aggregate
      when 'weekly' then interval '1 week'
      when 'monthly' then interval '1 month'
      else interval '1 day'
    end
  ) as value
),
conversation_bucket_counts as (
  select
    case p_aggregate
      when 'weekly' then date_trunc('week', created_at)::date
      when 'monthly' then date_trunc('month', created_at)::date
      else created_at::date
    end as bucket,
    count(*)::integer as conversations,
    count(*) filter (where escalated)::integer as escalated,
    count(distinct user_key)::integer as unique_users
  from filtered_conversations
  group by 1
),
message_bucket_counts as (
  select
    case p_aggregate
      when 'weekly' then date_trunc('week', created_at)::date
      when 'monthly' then date_trunc('month', created_at)::date
      else created_at::date
    end as bucket,
    -- Rule 1: an unprompted message is not an answer.
    count(*) filter (where role = 'assistant' and not proactive)::integer as ai_answers,
    count(*) filter (where role = 'user')::integer as user_messages,
    count(*) filter (where feedback = 1)::integer as positive,
    count(*) filter (where feedback = -1)::integer as negative
  from filtered_messages
  group by 1
),
notification_bucket_counts as (
  select
    case p_aggregate
      when 'weekly' then date_trunc('week', created_at)::date
      when 'monthly' then date_trunc('month', created_at)::date
      else created_at::date
    end as bucket,
    count(*)::integer as notifications
  from proactive_messages
  group by 1
),
bucket_rows as (
  select
    b.bucket,
    case when p_aggregate = 'monthly' then to_char(b.bucket, 'YYYY-MM') else to_char(b.bucket, 'YYYY-MM-DD') end as label,
    coalesce(c.conversations, 0) as conversations,
    coalesce(c.escalated, 0) as escalated,
    coalesce(c.unique_users, 0) as unique_users,
    coalesce(m.ai_answers, 0) as ai_answers,
    coalesce(n.notifications, 0) as notifications,
    coalesce(m.user_messages, 0) as user_messages,
    coalesce(m.positive, 0) as positive,
    coalesce(m.negative, 0) as negative
  from buckets b
  left join conversation_bucket_counts c on c.bucket = b.bucket
  left join message_bucket_counts m on m.bucket = b.bucket
  left join notification_bucket_counts n on n.bucket = b.bucket
),
stats as (
  select
    (select count(*)::integer from filtered_conversations) as total,
    (select count(*) filter (where escalated)::integer from filtered_conversations) as escalated,
    (select count(*)::integer from filtered_messages where role = 'assistant' and not proactive) as ai_answers,
    (select count(*)::integer from proactive_messages) as notifications,
    (select count(*)::integer from filtered_messages where role = 'user') as user_messages,
    (select count(*) filter (where feedback = 1)::integer from filtered_messages) as positive,
    (select count(*) filter (where feedback = -1)::integer from filtered_messages) as negative,
    (select count(distinct user_key)::integer from filtered_conversations) as unique_users
),
languages as (
  select coalesce(
    jsonb_agg(jsonb_build_array(language, count) order by count desc, language),
    '[]'::jsonb
  ) as value
  from (
    select language, count(*)::integer as count
    from filtered_conversations
    where language is not null and language <> ''
    group by language
  ) counts
),
chart as (
  select jsonb_build_object(
    'labels', jsonb_agg(label order by bucket),
    'series', jsonb_build_array(
      jsonb_build_object('key', 'Conversations', 'values', jsonb_agg(conversations order by bucket)),
      jsonb_build_object('key', 'Escalation', 'values', jsonb_agg(escalated order by bucket)),
      jsonb_build_object('key', 'AI answers', 'values', jsonb_agg(ai_answers order by bucket)),
      jsonb_build_object('key', 'Notifications', 'values', jsonb_agg(notifications order by bucket)),
      jsonb_build_object('key', 'User messages', 'values', jsonb_agg(user_messages order by bucket)),
      jsonb_build_object('key', 'Unique users', 'values', jsonb_agg(unique_users order by bucket)),
      jsonb_build_object('key', 'Conversations / User', 'values', jsonb_agg(case when unique_users > 0 then round(conversations::numeric / unique_users, 1) else 0 end order by bucket)),
      jsonb_build_object('key', 'Answers / Conversation', 'values', jsonb_agg(case when conversations > 0 then round(ai_answers::numeric / conversations, 1) else 0 end order by bucket)),
      jsonb_build_object('key', 'Messages / Conversation', 'values', jsonb_agg(case when conversations > 0 then round((ai_answers + user_messages)::numeric / conversations, 1) else 0 end order by bucket)),
      jsonb_build_object('key', 'Resolution rate', 'values', jsonb_agg(case when conversations > 0 then round(((conversations - escalated)::numeric / conversations) * 100) else 0 end order by bucket)),
      jsonb_build_object('key', 'Shortcut click', 'values', jsonb_agg(0 order by bucket)),
      jsonb_build_object('key', 'Answer rating', 'values', jsonb_agg(case when positive + negative > 0 then round((positive::numeric / (positive + negative)) * 100) else 0 end order by bucket)),
      jsonb_build_object('key', 'Positive vote', 'values', jsonb_agg(positive order by bucket)),
      jsonb_build_object('key', 'Negative vote', 'values', jsonb_agg(negative order by bucket))
    )
  ) as value
  from bucket_rows
),
assistant_ranked as (
  select assistant_id as raw_key, assistant_title as raw_label, count(*)::integer as total,
    row_number() over (order by count(*) desc, assistant_id) as rank
  from filtered_conversations
  group by assistant_id, assistant_title
),
assistant_groups as (
  select
    case when rank <= 5 then raw_key else '__other__' end as key,
    case when rank <= 5 then raw_label else 'Other' end as label,
    sum(total)::integer as total
  from assistant_ranked
  group by 1, 2
),
assistant_counts as (
  select
    case when r.rank <= 5 then c.assistant_id else '__other__' end as key,
    case p_aggregate when 'weekly' then date_trunc('week', c.created_at)::date when 'monthly' then date_trunc('month', c.created_at)::date else c.created_at::date end as bucket,
    count(*)::integer as count
  from filtered_conversations c
  join assistant_ranked r on r.raw_key = c.assistant_id
  group by 1, 2
),
assistant_series as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', g.key,
    'label', g.label,
    'values', (select jsonb_agg(coalesce(c.count, 0) order by b.bucket) from buckets b left join assistant_counts c on c.bucket = b.bucket and c.key = g.key),
    'total', g.total,
    'percent', case when (select total from stats) > 0 then round((g.total::numeric / (select total from stats)) * 100) else 0 end
  ) order by g.total desc, g.key), '[]'::jsonb) as value
  from assistant_groups g
),
channel_names as (
  select
    nullif(regexp_replace(split_part(regexp_replace(coalesce(s.config ->> 'url', ''), '^https?://', '', 'i'), '/', 1), '^www\.', '', 'i'), '') as host,
    min(s.name) as name
  from public.sources s
  join public.knowledge_collections kc on kc.id = s.collection_id
  where s.kind = 'website' and kc.organization_id = p_organization_id
  group by 1
),
channel_ranked as (
  select coalesce(host, 'direct') as raw_key,
    case when host is null then 'Direct' else coalesce((select name from channel_names n where n.host = filtered_conversations.host), host) end as raw_label,
    count(*)::integer as total,
    row_number() over (order by count(*) desc, coalesce(host, 'direct')) as rank
  from filtered_conversations
  group by host
),
channel_groups as (
  select case when rank <= 5 then raw_key else '__other__' end as key,
    case when rank <= 5 then raw_label else 'Other' end as label,
    sum(total)::integer as total
  from channel_ranked
  group by 1, 2
),
channel_counts as (
  select
    case when r.rank <= 5 then coalesce(c.host, 'direct') else '__other__' end as key,
    case p_aggregate when 'weekly' then date_trunc('week', c.created_at)::date when 'monthly' then date_trunc('month', c.created_at)::date else c.created_at::date end as bucket,
    count(*)::integer as count
  from filtered_conversations c
  join channel_ranked r on r.raw_key = coalesce(c.host, 'direct')
  group by 1, 2
),
channel_series as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', g.key,
    'label', g.label,
    'values', (select jsonb_agg(coalesce(c.count, 0) order by b.bucket) from buckets b left join channel_counts c on c.bucket = b.bucket and c.key = g.key),
    'total', g.total,
    'percent', case when (select total from stats) > 0 then round((g.total::numeric / (select total from stats)) * 100) else 0 end
  ) order by g.total desc, g.key), '[]'::jsonb) as value
  from channel_groups g
),
options as (
  select jsonb_build_object(
    -- Roles you can actually filter to: a notification-only conversation is out of
    -- the population, so offering its role would return an empty result (#546).
    'roles', coalesce((select jsonb_agg(role order by role) from (select distinct user_role as role from all_conversations where not notification_only and user_role is not null and user_role <> '') roles), '[]'::jsonb),
    'channels', coalesce((select jsonb_agg(jsonb_build_object('value', host, 'label', name || ' (' || host || ')') order by name, host) from channel_names where host is not null and (p_assistant_id is null or exists (select 1 from public.sources s join public.assistant_sources ln on ln.source_id = s.id where s.kind = 'website' and ln.assistant_id = p_assistant_id and nullif(regexp_replace(split_part(regexp_replace(coalesce(s.config ->> 'url', ''), '^https?://', '', 'i'), '/', 1), '^www\.', '', 'i'), '') = channel_names.host))), '[]'::jsonb)
  ) as value
)
select jsonb_build_object(
  'stats', jsonb_build_object(
    'total', stats.total,
    'escalated', stats.escalated,
    'resolutionRate', case when stats.total > 0 then round(((stats.total - stats.escalated)::numeric / stats.total) * 100) else null end,
    'positive', stats.positive,
    'negative', stats.negative,
    'answerRating', case when stats.positive + stats.negative > 0 then round((stats.positive::numeric / (stats.positive + stats.negative)) * 100) else 0 end,
    'aiAnswers', stats.ai_answers,
    'notifications', stats.notifications,
    'userMessages', stats.user_messages,
    'uniqueUsers', stats.unique_users,
    'conversationsPerUser', case when stats.unique_users > 0 then round(stats.total::numeric / stats.unique_users, 1) else 0 end,
    'answersPerConversation', case when stats.total > 0 then round(stats.ai_answers::numeric / stats.total, 1) else 0 end,
    'languages', languages.value
  ),
  'chart', chart.value,
  'assistantBreakdown', jsonb_build_object('labels', chart.value -> 'labels', 'series', assistant_series.value),
  'channelBreakdown', jsonb_build_object('labels', chart.value -> 'labels', 'series', channel_series.value),
  'options', options.value
)
from stats, languages, chart, assistant_series, channel_series, options;
$$;
