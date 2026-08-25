-- Routines: recurring, unattended Teammate runs
-- (spec ciele-org#767, ticket ciele-org#772).
--
-- A routine is a standing instruction plus a preset cadence. Deliberately not
-- a cron expression: the people who write these are describing "every morning"
-- and "the first of the month", and a free-form schedule field buys expressive
-- power nobody asked for at the price of an input that can be silently wrong
-- (`0 0 31 2 *` never fires).

create table public.teammate_routines (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  teammate_id text not null references public.teammates (id) on delete cascade,
  -- What to do, in the same voice as the Standing Role. Read as the user
  -- message of an unattended turn.
  instruction text not null,
  cadence text not null check (cadence in ('daily', 'weekly', 'monthly')),
  -- Preferred hour, UTC. The cadence says how often, this says when in the day,
  -- and together they are the whole schedule.
  hour int not null default 8 check (hour >= 0 and hour <= 23),
  enabled boolean not null default true,
  -- Whose standing instruction this is. The runs land in their thread with the
  -- Teammate, because "you set this up, here is what it did" is the honest
  -- attribution for work nobody asked for this morning.
  created_by uuid references auth.users (id) on delete set null,
  -- The claim lease and the cadence anchor at once: a run stamps this, and the
  -- next window is measured from it, so a drifting cron tick cannot double-run
  -- a routine or skip a day.
  last_run_at timestamptz,
  last_status text check (last_status in ('ok', 'failed')),
  last_detail text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index teammate_routines_teammate_idx
  on public.teammate_routines (teammate_id);
-- The cron's over-fetch reads this: enabled routines whose last run is old
-- enough that they *might* be due, before the exact per-routine rule runs.
create index teammate_routines_due_idx
  on public.teammate_routines (enabled, last_run_at);

alter table public.teammate_routines enable row level security;

-- Read is a Member right: unattended work an agent does in your workspace is
-- not a secret from you. Writing is Editor and up, and the ownership rule
-- (owner + named editors) is applied in the operations layer over the
-- Teammate, the same split the persona already uses.
create policy "members read routines" on public.teammate_routines
  for select using (private.is_org_member(organization_id));
create policy "editors create routines" on public.teammate_routines
  for insert with check (private.has_org_role(organization_id, 2));
create policy "editors update routines" on public.teammate_routines
  for update using (private.has_org_role(organization_id, 2));
create policy "editors delete routines" on public.teammate_routines
  for delete using (private.has_org_role(organization_id, 2));

-- A run's Conversation is marked in metadata rather than by a column: it is
-- an ordinary Teammate Conversation in every way the runtime cares about, and
-- what makes it a routine run is a fact about where it came from. See
-- `isRoutineConversation` in the domain package.

comment on table public.teammate_routines is
  'Recurring unattended Teammate runs (#772). Capped at 5 per Teammate in the operations layer; each run persists a Conversation in the author''s thread and stamps last_run_at as both lease and cadence anchor.';
