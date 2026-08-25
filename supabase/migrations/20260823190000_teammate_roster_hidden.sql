-- Per-Member roster hiding: "not on my list" without disabling anything
-- (spec ciele-org#767, story 10).
--
-- The distinction this table exists to keep is between three different acts
-- that all make a Teammate stop appearing. **Retiring** it (`deleted_at`) ends
-- it for the whole Organization. **Private visibility** keeps it off everyone's
-- roster but its owner's. **Hiding** is neither: the Teammate carries on
-- answering everybody else exactly as before, and one Member's list gets
-- shorter. So it is a fact about a Member's view, not about the Teammate, and
-- it lives in its own table rather than as a column somebody could mistake for
-- a state of the agent.
--
-- One row per (Teammate, Member), and a row means hidden. No `hidden boolean`,
-- for the same reason the grant rows have no `enabled`: unhiding deletes, and a
-- row that says false is a second way to say what an absent row already says.

create table public.teammate_roster_hidden (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  teammate_id text not null references public.teammates (id) on delete cascade,
  -- Whose roster. Their account going away takes their preferences with it,
  -- which is the one case where cascade is the honest choice: a hidden-for-
  -- nobody row is not a record worth keeping.
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (teammate_id, user_id)
);

create index teammate_roster_hidden_user_idx
  on public.teammate_roster_hidden (user_id, organization_id);

alter table public.teammate_roster_hidden enable row level security;

-- Every policy is scoped to `auth.uid()`, not to the Organization's Role
-- ladder. This is the rare table where an owner has no more business reading a
-- row than anybody else: which colleagues somebody keeps on their own list is
-- not an administrative fact, and an admin who could read it would learn that a
-- Member hid the CEO's Teammate.
create policy "members read their own hidden teammates"
  on public.teammate_roster_hidden
  for select using (
    user_id = auth.uid() and private.is_org_member(organization_id)
  );
create policy "members hide a teammate for themselves"
  on public.teammate_roster_hidden
  for insert with check (
    user_id = auth.uid() and private.is_org_member(organization_id)
  );
create policy "members unhide a teammate for themselves"
  on public.teammate_roster_hidden
  for delete using (
    user_id = auth.uid() and private.is_org_member(organization_id)
  );

-- No update policy: the row carries no state to change. Unhiding is a delete.

comment on table public.teammate_roster_hidden is
  'Per-Member roster hiding (#767, story 10). A row means this Member does not want this Teammate on their own list; the Teammate is unaffected for everybody else. Readable and writable only by the Member it belongs to, deliberately not by admins.';
