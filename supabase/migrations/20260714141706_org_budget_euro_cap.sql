-- Adds an independent euro cap alongside the existing daily token cap
-- (org_budgets.daily_token_limit, 20260710160000_org_budgets.sql). Either
-- limit crossing today's usage trips `enforcement`. The euro figure is an
-- estimate computed app-side from token counts (packages/db/src/pricing.ts),
-- not a billed amount — there is no per-call cost feed from any provider.

alter table public.org_budgets
  add column daily_euro_limit_cents bigint;

-- Today's (UTC) token usage grouped by resolved provider/model, so the app
-- can price each group and sum an estimated euro total. Security invoker:
-- RLS scopes callers, the service role sees everything.
create or replace function public.org_ai_usage_by_model_today(p_organization_id uuid)
returns table (provider text, model_id text, input_tokens bigint, output_tokens bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select provider, model_id,
    coalesce(sum(input_tokens), 0)::bigint as input_tokens,
    coalesce(sum(output_tokens), 0)::bigint as output_tokens
  from public.ai_usage
  where organization_id = p_organization_id
    and created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
  group by provider, model_id;
$$;
