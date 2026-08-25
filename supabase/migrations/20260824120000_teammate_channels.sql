-- Teammate channels: named threads holding N Members and N Teammates
-- (spec ciele-org#778, resolutions ciele-org#775 / #776).
--
-- A channel is its own entity and owns its own messages. The alternative was to
-- give `conversations` a roster, and it was refused for one reason: a
-- Conversation is single-subject by construction (#768's exclusive-or check),
-- and the widget, the Inbox, the Insights population and the message-level
-- export all read it that way. Teaching it a roster would have made every one of
-- those reads ask "and is this one a group?", where a new table makes them ask
-- nothing at all.

create table public.teammate_channels (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  -- The bound Project (0..1): its decisions document is shared context for every
  -- Teammate turn here, and where a Teammate writes what the channel settled.
  -- `set null`, like `teammates.project_id`: deleting a Project unbinds the
  -- channels that read it rather than deleting the threads.
  project_id text references public.projects (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index teammate_channels_org_idx
  on public.teammate_channels (organization_id, created_at);
create index teammate_channels_project_idx on public.teammate_channels (project_id);

-- The roster ------------------------------------------------------------------
--
-- One table, two kinds of seat, under an exclusive-or check: the shape
-- `conversations` and `memory_documents` already take. Two tables would answer
-- "who is in this channel" twice, and the reads that matter (the perimeter for a
-- mention, the visibility rule) want one answer.

create table public.teammate_channel_participants (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  channel_id text not null references public.teammate_channels (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  teammate_id text references public.teammates (id) on delete cascade,
  constraint teammate_channel_participants_one_seat
    check (num_nonnulls(user_id, teammate_id) = 1),
  added_by uuid references auth.users (id) on delete set null,
  -- A Member's own read marker. Null on a Teammate row: an agent has no unreads.
  last_read_at timestamptz,
  created_at timestamptz not null default now()
);

-- Partial uniques rather than one composite: half of each pair is always null,
-- and a composite unique treats two nulls as distinct in the engines that
-- matter, so (channel, null) twice would be allowed.
create unique index teammate_channel_participants_member_uniq
  on public.teammate_channel_participants (channel_id, user_id)
  where user_id is not null;
create unique index teammate_channel_participants_teammate_uniq
  on public.teammate_channel_participants (channel_id, teammate_id)
  where teammate_id is not null;
create index teammate_channel_participants_member_idx
  on public.teammate_channel_participants (user_id, created_at);

-- The transcript --------------------------------------------------------------

create table public.teammate_channel_messages (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  channel_id text not null references public.teammate_channels (id) on delete cascade,
  -- `system` is the runtime speaking as itself: today the chain-cap marker,
  -- which belongs in the transcript because "the fan-out stopped here" is part
  -- of what happened.
  author_type text not null check (author_type in ('member', 'teammate', 'system')),
  author_user_id uuid references auth.users (id) on delete set null,
  -- `set null` rather than cascade: hard-deleting a Teammate must not take the
  -- thread's history with it. The check below therefore only refuses BOTH
  -- authors at once, and a member message naming nobody; it deliberately does
  -- not tie author_type to a non-null id, or that set-null would fail the row.
  author_teammate_id text references public.teammates (id) on delete set null,
  constraint teammate_channel_messages_one_author
    check (
      num_nonnulls(author_user_id, author_teammate_id) <= 1
      and (author_type <> 'member' or author_user_id is not null)
      and (author_type <> 'system' or num_nonnulls(author_user_id, author_teammate_id) = 0)
    ),
  -- The same ChatReplyPart[] vocabulary a Conversation message carries, so the
  -- console renders a channel with the transcript component the 1:1 chat uses.
  content jsonb not null default '[]'::jsonb,
  -- Everybody this message addressed, Members and Teammates alike. Only a
  -- Teammate id ever produces a turn; a Member id is what makes "notify me only
  -- when I am mentioned" one field instead of a second parse at read time.
  mentions jsonb not null default '[]'::jsonb,
  -- The chain this message belongs to: the id of the human message that started
  -- it, null on that message itself. Makes "everything one message triggered" a
  -- single filter rather than a walk, which is how the caps are counted.
  chain_id text references public.teammate_channel_messages (id) on delete set null,
  trace jsonb,
  created_at timestamptz not null default now()
);

create index teammate_channel_messages_channel_idx
  on public.teammate_channel_messages (channel_id, created_at, id);
create index teammate_channel_messages_chain_idx
  on public.teammate_channel_messages (chain_id);

-- Access ----------------------------------------------------------------------
--
-- Membership is the visibility rule (#776, story 14): a channel a Member is not
-- in does not exist for them. Owner/Admin oversight is real (story 15) and it is
-- deliberately a different read: the policies below give an admin the org's
-- channels so the Inbox can show them, while the operations layer's roster read
-- asks only about membership. An admin therefore oversees without sitting in
-- everybody's group chats.
--
-- The helper is security-definer and lives in `private`, both for the reason
-- 0026 gives (PostgREST never exposes `private` for RPC) and because a policy on
-- the participants table that queried the participants table would recurse.

create or replace function private.is_channel_member(p_channel_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teammate_channel_participants p
    where p.channel_id = p_channel_id
      and p.user_id = auth.uid()
  )
$$;

alter table public.teammate_channels enable row level security;

create policy "channel members read channels" on public.teammate_channels
  for select using (
    private.is_channel_member(id)
    or private.has_org_role(organization_id, 3)
  );
-- Any Member opens one: creating a channel is not configuring an agent, so the
-- Editor+ gate that guards Teammates does not apply here (#776).
create policy "members create channels" on public.teammate_channels
  for insert with check (private.is_org_member(organization_id));
-- Any member may write the row, because appending a message moves `updated_at`
-- and the roster sorts on it; *what* they may change is the trigger below.
create policy "channel members update channels" on public.teammate_channels
  for update using (
    private.is_channel_member(id)
    or private.has_org_role(organization_id, 3)
  );
create policy "the creator or an admin deletes channels" on public.teammate_channels
  for delete using (
    created_by = auth.uid()
    or private.has_org_role(organization_id, 3)
  );

-- The manage rule, at the column level -----------------------------------------
--
-- `canManageChannel` (packages/core/src/channel.ts) says the name, the bound
-- Project and the thread's existence belong to whoever opened it, or to an
-- organization admin. RLS cannot express that here, because the same row also
-- carries `updated_at`, which every member moves by posting: a policy sees one
-- row, not which column changed, so "members may write this row" and "only the
-- creator may rename it" cannot both be policies.
--
-- Hence a trigger, the same tool `20260823170000_teammate_routine_cap.sql` uses
-- for a rule `check` cannot see. Without it the operations layer is the only
-- thing enforcing the rule, and PostgREST is a way around the operations layer.
--
-- `auth.uid()` is null under the service role, which already bypasses RLS
-- outright; refusing it here would make a trigger stricter than the tenancy
-- line everywhere else, so an unauthenticated caller (a migration, the seed)
-- passes.

create or replace function private.enforce_channel_manage_rule()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.id is not distinct from old.id
    and new.organization_id is not distinct from old.organization_id
    and new.name is not distinct from old.name
    and new.project_id is not distinct from old.project_id
    and new.created_by is not distinct from old.created_by
  then
    -- Only `updated_at` moved: the activity bump every member's message makes.
    return new;
  end if;
  if old.created_by = auth.uid()
    or private.has_org_role(old.organization_id, 3)
  then
    return new;
  end if;
  raise exception
    'Only whoever opened this channel, or an organization admin, can change it.'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists enforce_channel_manage_rule on public.teammate_channels;
create trigger enforce_channel_manage_rule
  before update on public.teammate_channels
  for each row
  execute function private.enforce_channel_manage_rule();

comment on function private.enforce_channel_manage_rule() is
  'Keeps a channel''s name, bound Project and ownership to its creator or an org admin (#778), while leaving the updated_at bump open to every member. Mirrors canManageChannel in packages/core/src/channel.ts; change both.';

alter table public.teammate_channel_participants enable row level security;

create policy "channel members read the roster" on public.teammate_channel_participants
  for select using (
    private.is_channel_member(channel_id)
    or private.has_org_role(organization_id, 3)
  );
-- The creator's own first seat is inserted when they are not yet a member of the
-- channel they just made, hence the `created_by` branch: without it every
-- channel would be created empty and unreachable.
--
-- The second half is the disclosure rule, and it is a rule about a *write*
-- rather than about a read: `20260821140000_teammates.sql` deliberately lets
-- every member select every Teammate row and leaves whose roster it appears on
-- to `canViewTeammate`, but seating one broadcasts it to everybody else in the
-- channel, which is a thing a colleague's private Teammate must not become.
-- Mirrors `canAddTeammateToChannel`: the org-visible ones, plus your own.
create policy "channel members add to the roster" on public.teammate_channel_participants
  for insert with check (
    (
      private.is_channel_member(channel_id)
      or exists (
        select 1 from public.teammate_channels c
        where c.id = channel_id and c.created_by = auth.uid()
      )
      or private.has_org_role(organization_id, 3)
    )
    and (
      teammate_id is null
      or exists (
        select 1 from public.teammates t
        where t.id = teammate_id
          and t.organization_id = teammate_channel_participants.organization_id
          and t.deleted_at is null
          and (
            t.visibility = 'org'
            or t.owner_id = auth.uid()
            or t.editor_ids @> to_jsonb(auth.uid()::text)
          )
      )
    )
  );
-- A Member moves their own read marker, and the `with check` is what keeps that
-- to a marker: without it `user_id = auth.uid()` reads the row being changed and
-- says nothing about the row it becomes, so a seat could be rewritten to point
-- at another channel and be a way into it. The remaining columns on your own
-- seat (when you were added, by whom) are yours to rewrite and worth nothing.
create policy "members update their own read marker" on public.teammate_channel_participants
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and private.is_channel_member(channel_id));
-- Removing somebody is the manage rule; leaving is always yours. Everyone in
-- the channel may *add* (invite-based group chat where only one person can
-- invite is a queue in front of one person), and that asymmetry is deliberate:
-- being removed from a thread you are reading is not something a colleague you
-- barely invited should be able to do to you.
create policy "the creator, an admin, or you leaving" on public.teammate_channel_participants
  for delete using (
    user_id = auth.uid()
    or exists (
      select 1 from public.teammate_channels c
      where c.id = channel_id and c.created_by = auth.uid()
    )
    or private.has_org_role(organization_id, 3)
  );

alter table public.teammate_channel_messages enable row level security;

create policy "channel members read the transcript" on public.teammate_channel_messages
  for select using (
    private.is_channel_member(channel_id)
    or private.has_org_role(organization_id, 3)
  );
-- Append-only: no update, no delete policy. A Teammate's reply is written by the
-- runtime under the session of the Member whose message started the chain, which
-- is the same rule the attribution follows (#778, story 8).
create policy "channel members append to the transcript" on public.teammate_channel_messages
  for insert with check (private.is_channel_member(channel_id));
