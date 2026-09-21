-- Spender attribution on the AI usage ledger (#848, spec #847).
--
-- Until now a usage row named the Organization, the Assistant, the Conversation
-- and the message, and nothing else. Since Teammates, Routines, Channels and
-- HTTP flows landed, a growing share of platform-funded work is internal rather
-- than Visitor traffic, and every one of those rows carries a null Assistant and
-- no other handle: an admin who hits the AI wall cannot tell what did it.
--
-- Every column here is nullable, so every existing writer keeps recording
-- exactly what it records today and each call site is upgraded on its own
-- (#849 does the rest).
--
-- **Attribution is a fact, never a decision.** No cap, gate or meter reads
-- these columns; they exist so the Usage page can say where the credits went,
-- and so a later per-Member budget needs no backfill.
--
-- Deliberately no foreign keys. A ledger is a historical record: it must keep
-- saying who spent what after the Teammate is retired or the Member's account
-- is deleted, and `on delete set null` would erase exactly the attribution the
-- row exists for. `assistant_id` above predates this and does set null, which is
-- why a deleted Assistant's spend already falls into the unattributed bucket.

alter table public.ai_usage
  add column member_id uuid,
  add column teammate_id text,
  add column api_key_id uuid,
  add column routine_id text,
  add column flow_id text,
  -- Wider than runtime_events.surface, which only distinguishes the three chat
  -- surfaces: unattended and machine callers spend too, and "a Routine fired"
  -- must not be indistinguishable from "a Visitor asked". The constraint has to
  -- grow with the UsageSurface union or the rows are rejected in production;
  -- the contract suite's exhaustive guard is what forces this edit.
  add column surface text
    check (
      surface in (
        'widget', 'preview', 'teammate', 'channel', 'routine',
        'http_flow', 'api', 'ingestion', 'scheduled'
      )
    );

comment on column public.ai_usage.member_id is
  'The Member whose turn it was (Preview, Teammate chat, a console action). No FK: the ledger outlives the account.';
comment on column public.ai_usage.teammate_id is
  'The AI Teammate that ran (1:1 chat, a channel turn, a Routine). No FK: the ledger outlives the Teammate.';
comment on column public.ai_usage.api_key_id is
  'The Organization API key behind an /api/v1 or MCP call. Attribution only; never an authorization signal.';
comment on column public.ai_usage.routine_id is
  'The Routine whose unattended run this was.';
comment on column public.ai_usage.flow_id is
  'The Flow whose action drove the spend.';
comment on column public.ai_usage.surface is
  'Which surface produced the spend. Null on rows recorded before #848.';

-- The breakdown reads one organization's window ordered by nothing in
-- particular and groups in the application, so the useful index is the one that
-- finds the window. (organization_id, created_at) already exists from 0001.

-- Usage over an arbitrary window grouped by WHO spent it, rather than by which
-- meter it charged.
--
-- The grain is the whole spender tuple, not one identity per row, because a
-- single unit of work has several: a Teammate turn belongs to the Teammate and
-- to the Member who asked. Summing across dimensions would count it twice,
-- which is why the pivot onto one dimension lives in a pure function
-- (`rankSpenders`) rather than here.
--
-- Reads the raw ledger over the whole window on purpose: the spender grain has
-- no rollup yet (#850 adds one and rewrites this body to the closed-day/live-head
-- construction `org_usage_meters` already uses). Crawl telemetry carries no
-- spender, so scraping does not appear here until it does.
create or replace function public.org_usage_spenders(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  member_id uuid,
  teammate_id text,
  api_key_id uuid,
  routine_id text,
  flow_id text,
  assistant_id text,
  surface text,
  credential_kind text,
  provider text,
  model_id text,
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
    member_id,
    teammate_id,
    api_key_id,
    routine_id,
    flow_id,
    assistant_id,
    surface,
    coalesce(credential_kind, 'unknown'),
    provider,
    model_id,
    count(*)::bigint,
    sum(input_tokens)::bigint,
    sum(output_tokens)::bigint
  from public.ai_usage
  where organization_id = p_organization_id
    and created_at >= p_from
    and created_at < p_to
  group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10;
$$;

-- security invoker, so the caller's own RLS on ai_usage applies: a member reads
-- only their own organization's rows, exactly as the meters read does. Execute
-- is left at the Postgres default, like org_usage_meters beside it.
comment on function public.org_usage_spenders(uuid, timestamptz, timestamptz) is
  'Usage for one organization over an arbitrary [from, to) window, grouped by the full spender tuple plus provider/model so the app can price it in credits and pivot onto one dimension at a time.';
