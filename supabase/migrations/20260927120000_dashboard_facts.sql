-- The Insights Dashboard's reads: one Organization's model calls, finished
-- Conversation Turns, verifier verdicts and Visitor Conversations over an
-- arbitrary [from, to) window, each grouped by UTC day.
--
-- Every function returns a grain fine enough that each Dashboard filter
-- (surface, Assistant) selects whole rows, so the pivots in
-- `computeUsageDashboard` (packages/core/src/usage-dashboard.ts) only ever sum.
-- That is also why latency leaves here as a histogram bucket rather than a
-- percentile: a p95 of a filtered subset cannot be rebuilt from p95s of its
-- parts, a bucket count can.
--
-- All four are security invoker, like org_usage_spenders: the caller's own RLS
-- on ai_usage, runtime_events, answer_verdicts and conversations applies, so a
-- member reads only their own Organization.

create or replace function public.org_dashboard_usage(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  day text,
  surface text,
  stage text,
  provider text,
  model_id text,
  assistant_id text,
  calls bigint,
  input_tokens bigint,
  output_tokens bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    to_char(created_at at time zone 'utc', 'YYYY-MM-DD'),
    surface,
    stage,
    provider,
    model_id,
    assistant_id,
    count(*)::bigint,
    sum(input_tokens)::bigint,
    sum(output_tokens)::bigint
  from public.ai_usage
  where organization_id = p_organization_id
    and created_at >= p_from
    and created_at < p_to
  group by 1, 2, 3, 4, 5, 6;
$$;

-- The thresholds are DASHBOARD_LATENCY_BOUNDS_MS; width_bucket returns how many
-- of them the duration reaches, which is exactly latencyBucketOf. The Db
-- contract suite records turns on the bucket edges and asserts both adapters
-- land them where latencyBucketOf does, so the two arrays cannot drift apart.
create or replace function public.org_dashboard_turns(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  day text,
  surface text,
  assistant_id text,
  status text,
  flow_name text,
  error_class text,
  latency_bucket integer,
  turns bigint,
  duration_ms bigint,
  tool_calls bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    to_char(created_at at time zone 'utc', 'YYYY-MM-DD'),
    surface,
    assistant_id,
    status,
    flow_name,
    case when status = 'failed' then coalesce(nullif(error_class, ''), 'unknown') end,
    width_bucket(
      coalesce(duration_ms, 0),
      array[250, 500, 1000, 1500, 2000, 3000, 4000, 6000, 8000, 12000, 16000, 24000, 32000, 60000]
    ),
    count(*)::bigint,
    coalesce(sum(duration_ms), 0)::bigint,
    coalesce(sum(tool_calls), 0)::bigint
  from public.runtime_events
  where organization_id = p_organization_id
    and kind = 'chat_turn'
    and status in ('succeeded', 'failed')
    and created_at >= p_from
    and created_at < p_to
  group by 1, 2, 3, 4, 5, 6, 7;
$$;

create or replace function public.org_dashboard_verdicts(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  day text,
  assistant_id text,
  verdict text,
  count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    to_char(created_at at time zone 'utc', 'YYYY-MM-DD'),
    assistant_id,
    verdict,
    count(*)::bigint
  from public.answer_verdicts
  where organization_id = p_organization_id
    and created_at >= p_from
    and created_at < p_to
  group by 1, 2, 3;
$$;

-- The Insights population (get_insights_overview): Assistant-owned
-- Conversations, Member Preview traffic excluded, escalation read from the same
-- metadata flag, so the Dashboard's autonomy agrees with the Insights tab's
-- "Escalated to Human".
create or replace function public.org_dashboard_conversations(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  day text,
  assistant_id text,
  escalated boolean,
  conversations bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    to_char(c.created_at at time zone 'utc', 'YYYY-MM-DD'),
    c.assistant_id,
    coalesce((c.metadata ->> 'escalated')::boolean, false),
    count(*)::bigint
  from public.conversations c
  join public.assistants a on a.id = c.assistant_id
  where a.organization_id = p_organization_id
    and c.subject_type <> 'member'
    and c.created_at >= p_from
    and c.created_at < p_to
  group by 1, 2, 3;
$$;

comment on function public.org_dashboard_usage(uuid, timestamptz, timestamptz) is
  'Insights Dashboard: model calls for one organization over [from, to), per UTC day, surface, stage, provider/model and assistant.';
comment on function public.org_dashboard_turns(uuid, timestamptz, timestamptz) is
  'Insights Dashboard: finished chat turns over [from, to), per UTC day, surface, assistant, status, flow, error class and latency histogram bucket.';
comment on function public.org_dashboard_verdicts(uuid, timestamptz, timestamptz) is
  'Insights Dashboard: answer verifier verdicts over [from, to), per UTC day, assistant and verdict.';
comment on function public.org_dashboard_conversations(uuid, timestamptz, timestamptz) is
  'Insights Dashboard: Visitor conversations started over [from, to), per UTC day, assistant and escalation.';
