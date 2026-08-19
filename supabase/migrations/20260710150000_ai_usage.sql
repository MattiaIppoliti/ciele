-- AI usage ledger: one row per model call the runtime makes, attributed to
-- (organization, assistant, conversation, message, pipeline stage, resolved
-- provider/model). Written post-commit by the Conversation Turn; a ledger
-- failure never breaks a chat. Stage vocabulary reserves values for scheduled
-- work (verify / goal_eval / compost) so later features meter under the same
-- accounting.

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  assistant_id text references public.assistants (id) on delete set null,
  conversation_id text,
  message_id text,
  stage text not null
    check (stage in ('classify', 'generate', 'embed', 'verify', 'goal_eval', 'compost')),
  provider text not null,
  -- The model that actually ran (post cross-provider fallback), not the
  -- assistant's configured model.
  model_id text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now()
);

create index ai_usage_org_created_idx
  on public.ai_usage (organization_id, created_at desc);
create index ai_usage_conversation_idx
  on public.ai_usage (conversation_id);

alter table public.ai_usage enable row level security;

-- Members read their org's ledger; members also insert (Preview turns run on
-- the session client). Published-widget turns insert via the service role.
create policy "members read ai usage" on public.ai_usage
  for select using (private.is_org_member(organization_id));
create policy "members record ai usage" on public.ai_usage
  for insert with check (private.is_org_member(organization_id));

-- Today's (UTC) token total for an organization, the budget pre-turn check.
-- Security invoker: RLS scopes callers, the service role sees everything.
create or replace function public.org_ai_tokens_today(p_organization_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(input_tokens + output_tokens), 0)::bigint
  from public.ai_usage
  where organization_id = p_organization_id
    and created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc');
$$;
