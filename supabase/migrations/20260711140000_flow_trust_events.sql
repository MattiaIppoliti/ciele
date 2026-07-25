-- Flow trust demotion history (spec: "when did this flow start failing?" needs
-- an answer older than last night). The flow_trust snapshot keeps only the last
-- transition (previous_tier), overwritten on every nightly materialization. This
-- append-only ledger records every tier transition so demotions survive, and
-- the weekly compost digest reads demotions from here — seeing every demotion in
-- its window, not just those surviving the latest materialization.

create table public.flow_trust_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  assistant_id text not null references public.assistants (id) on delete cascade,
  flow_id text not null,
  -- null when the pair first entered the ledger (no prior tier).
  from_tier text check (from_tier in ('auto', 'queue', 'watch')),
  to_tier text not null check (to_tier in ('auto', 'queue', 'watch')),
  runs integer not null default 0,
  passes integer not null default 0,
  created_at timestamptz not null default now()
);

create index flow_trust_events_assistant_flow_idx
  on public.flow_trust_events (assistant_id, flow_id, created_at desc);
create index flow_trust_events_org_idx
  on public.flow_trust_events (organization_id, created_at desc);

alter table public.flow_trust_events enable row level security;

-- Written by the nightly materialization (service role only — no insert policy
-- on purpose); members read for per-flow trust history.
create policy "members read flow trust events" on public.flow_trust_events
  for select using (private.is_org_member(organization_id));
