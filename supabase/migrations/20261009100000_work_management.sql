-- Work management: the Project becomes the container of the work (map
-- ciele-org#1039, spec #1059, ticket #1061).
--
-- Decisions this file encodes, one per ticket: the Task record #1049, the
-- Project's shape and its backfill #1046, the access rule #1047, Member
-- Notifications #1048, Saved Views and Favorites #1050, the activity log and
-- the Teammate grant domain #1051, comments #1055, Task <-> Improvement #1044
-- (ADR-0027).
--
-- The access rule in one sentence: the Role decides what a Member may do, the
-- Project decides whether they can see it. Every work table carries its
-- `project_id` so its policy is one call to `private.can_read_project` /
-- `private.can_write_project`; children of a Task reference `(task_id,
-- project_id)` with `on update cascade`, so moving a Task carries its labels,
-- comments, reactions, activity and notifications with it and never leaves a
-- row whose policy asks about the wrong Project.

-- The Project, extended ---------------------------------------------------------

alter table public.projects
  add column key text,
  add column status text not null default 'active'
    check (status in ('planning', 'active', 'at_risk', 'on_hold', 'completed')),
  add column lead_id uuid references auth.users (id) on delete set null,
  add column start_date date,
  add column due_date date,
  add column color text not null default 'gray'
    check (color in ('gray', 'blue', 'green', 'amber', 'red', 'purple')),
  add column icon text not null default 'folder'
    check (icon ~ '^[a-z0-9-]{1,40}$'),
  add column visibility text not null default 'organization'
    check (visibility in ('organization', 'private')),
  add constraint projects_dates_check
    check (start_date is null or due_date is null or start_date <= due_date),
  -- The composite foreign keys below need it (the 20260929120000 pattern).
  add constraint projects_id_organization_id_key unique (id, organization_id);

create index projects_lead_idx on public.projects (lead_id);

-- The other parents a work row names by id. A Task's Improvement (ADR-0027
-- rule 1) and every Teammate a work row points at must be in the row's own
-- Organization, which a composite foreign key says once instead of every
-- writer remembering it.
alter table public.improvements
  add constraint improvements_id_organization_id_key unique (id, organization_id);
alter table public.teammates
  add constraint teammates_id_organization_id_key unique (id, organization_id);

-- A key from a Project's name: the initials of its words (at most three),
-- padded from its letters to two, suffixed with a number until unique in the
-- Organization. `deriveProjectKey` in packages/core/src/work.ts is the same
-- rule; the operations pass a key, and this covers every other writer.
create or replace function private.derive_project_key(p_org uuid, p_name text)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  letters text;
  base text;
  candidate text;
  n integer := 2;
begin
  letters := upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z ]', '', 'g'));
  select coalesce(string_agg(left(word, 1), ''), '') into base
    from regexp_split_to_table(btrim(letters), ' +') as word
    where word <> '';
  base := left(base, 3);
  if char_length(base) < 2 then
    base := left(replace(letters, ' ', '') || 'PR', 2);
  end if;
  candidate := base;
  while exists (
    select 1 from public.projects where organization_id = p_org and key = candidate
  ) loop
    candidate := left(base, 3) || n::text;
    n := n + 1;
  end loop;
  return candidate;
end $$;

revoke all on function private.derive_project_key(uuid, text) from public, anon;

-- Backfill every existing Project, oldest first, so the first one named
-- "Website" keeps `WE`.
do $$
declare
  r record;
begin
  for r in
    select id, organization_id, name from public.projects
    where key is null
    order by created_at, id
  loop
    update public.projects
      set key = private.derive_project_key(r.organization_id, r.name)
      where id = r.id;
  end loop;
end $$;

-- A writer that does not know about keys yet (the deploy that serves against
-- this schema before its own code is live, a seed, a script) still gets one:
-- the column stays NOT NULL and nobody has to remember it.
create or replace function private.assign_project_key()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.key is null then
    new.key := private.derive_project_key(new.organization_id, new.name);
  end if;
  return new;
end $$;

create trigger assign_project_key
  before insert on public.projects
  for each row execute function private.assign_project_key();

alter table public.projects
  alter column key set not null,
  add constraint projects_key_format check (key ~ '^[A-Z][A-Z0-9]{1,4}$'),
  add constraint projects_org_key_key unique (organization_id, key);

-- Private Projects list who may see them (#1047).
create table public.project_members (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade,
  unique (project_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id);
create index project_members_added_by_idx on public.project_members (added_by);
create index project_members_org_idx on public.project_members (organization_id);

create table public.project_milestones (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id text not null,
  name text not null check (char_length(name) between 1 and 200),
  date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);
create index project_milestones_project_idx on public.project_milestones (project_id, date);
create index project_milestones_org_idx on public.project_milestones (organization_id);

-- Access helpers ----------------------------------------------------------------
--
-- Security definer and in `private` for the reasons 0026 and the channels
-- migration give: PostgREST never exposes `private`, and a policy on
-- `project_members` that read `project_members` would recurse. The `created_by`
-- branch lets a private Project's creator see it in the instant between
-- creating it and seating themselves, and only then: once anyone is seated, a
-- creator removed in Share loses it like any other member (#1047).

create or replace function private.project_org(p_project_id text)
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from public.projects where id = p_project_id
$$;

create or replace function private.project_has_members(p_project_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_members where project_id = p_project_id)
$$;

create or replace function private.can_read_project(p_project_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and private.is_org_member(p.organization_id)
      and (
        p.visibility = 'organization'
        or private.has_org_role(p.organization_id, 3)
        or exists (
          select 1 from public.project_members m
          where m.project_id = p.id and m.user_id = auth.uid()
        )
        or (p.created_by = auth.uid() and not private.project_has_members(p.id))
      )
  )
$$;

create or replace function private.can_write_project(p_project_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select private.can_read_project(p_project_id)
    and private.has_org_role(private.project_org(p_project_id), 2)
$$;

revoke all on function private.project_org(text) from public, anon;
revoke all on function private.project_has_members(text) from public, anon;
revoke all on function private.can_read_project(text) from public, anon;
revoke all on function private.can_write_project(text) from public, anon;
grant execute on function private.project_org(text) to authenticated, service_role;
grant execute on function private.project_has_members(text) to authenticated, service_role;
grant execute on function private.can_read_project(text) to authenticated, service_role;
grant execute on function private.can_write_project(text) to authenticated, service_role;

comment on function private.can_read_project(text) is
  'The work visibility rule (#1047): an org-visible Project, or a private one the caller is a member of or administers (its creator too, until anyone is seated). Mirrors canReadProject in packages/core/src/work.ts; change both.';

-- Projects are now read through the visibility rule. The select policy spells
-- the columns out instead of calling `can_read_project(id)`, because an
-- `insert ... returning` checks it against a row the helper's snapshot cannot
-- see yet.
drop policy if exists "members read projects" on public.projects;
drop policy if exists "editors update projects" on public.projects;
drop policy if exists "editors delete projects" on public.projects;
create policy "members read visible projects" on public.projects
  for select using (
    private.is_org_member(organization_id)
    and (
      visibility = 'organization'
      or private.has_org_role(organization_id, 3)
      or exists (
        select 1 from public.project_members m
        where m.project_id = projects.id and m.user_id = (select auth.uid())
      )
      -- Through the definer helper, not an inline `not exists`: a creator who
      -- was removed cannot read the seats under RLS, so an inline check would
      -- see none and let them back in.
      or (created_by = (select auth.uid()) and not private.project_has_members(projects.id))
    )
  );
create policy "editors update visible projects" on public.projects
  for update using (private.can_write_project(id))
  with check (private.has_org_role(organization_id, 2));
create policy "editors delete visible projects" on public.projects
  for delete using (private.can_write_project(id));

alter table public.project_members enable row level security;
create policy "readers see a project's members" on public.project_members
  for select using (private.can_read_project(project_id));
create policy "editors seat project members" on public.project_members
  for insert with check (
    private.can_write_project(project_id)
    and organization_id = private.project_org(project_id)
  );
create policy "editors unseat project members" on public.project_members
  for delete using (private.can_write_project(project_id));

alter table public.project_milestones enable row level security;
create policy "readers see milestones" on public.project_milestones
  for select using (private.can_read_project(project_id));
create policy "editors add milestones" on public.project_milestones
  for insert with check (
    private.can_write_project(project_id)
    and organization_id = private.project_org(project_id)
  );
create policy "editors edit milestones" on public.project_milestones
  for update using (private.can_write_project(project_id))
  with check (private.can_write_project(project_id));
create policy "editors remove milestones" on public.project_milestones
  for delete using (private.can_write_project(project_id));

-- Tasks -------------------------------------------------------------------------

create table public.tasks (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id text not null,
  -- One level deep, same Project: the depth rule is `canNestUnder` in core
  -- (ops), the same-Project rule is the trigger below. A plain FK rather than a
  -- composite one, because moving a parent re-numbers its subtasks in the
  -- destination one row at a time, which a composite cascade cannot do.
  parent_id text references public.tasks (id) on delete cascade,
  seq integer not null check (seq > 0),
  title text not null check (char_length(title) between 1 and 500),
  description text not null default '' check (char_length(description) <= 20000),
  status text not null default 'to_do'
    check (status in ('backlog', 'to_do', 'in_progress', 'in_review', 'done')),
  priority text not null default 'none'
    check (priority in ('urgent', 'high', 'medium', 'low', 'none')),
  assignee_member_id uuid references auth.users (id) on delete set null,
  assignee_teammate_id text,
  start_date date,
  due_date date,
  estimate_minutes integer check (estimate_minutes > 0),
  recurrence text check (recurrence in ('daily', 'weekly', 'biweekly', 'monthly')),
  -- A fractional key (`rankBetween` in core). Byte order, so the database and
  -- JavaScript's string comparison sort it the same way.
  rank text collate "C" not null check (char_length(rank) between 1 and 200),
  -- The Improvement this Task resolves (#1044, ADR-0027), in the Task's own
  -- Organization: the composite foreign key below.
  improvement_id text,
  completed_at timestamptz,
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_one_assignee
    check (num_nonnulls(assignee_member_id, assignee_teammate_id) <= 1),
  constraint tasks_dates_check
    check (start_date is null or due_date is null or start_date <= due_date),
  constraint tasks_completed_iff_done
    check ((status = 'done') = (completed_at is not null)),
  constraint tasks_not_own_parent check (parent_id is null or parent_id <> id),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade,
  -- `set null` on the one column: the Organization stays.
  foreign key (improvement_id, organization_id)
    references public.improvements (id, organization_id) on delete set null (improvement_id),
  foreign key (assignee_teammate_id, organization_id)
    references public.teammates (id, organization_id) on delete set null (assignee_teammate_id),
  unique (project_id, seq),
  unique (id, project_id)
);

create index tasks_project_rank_idx on public.tasks (project_id, rank);
create index tasks_org_idx on public.tasks (organization_id, updated_at);
create index tasks_parent_idx on public.tasks (parent_id);
create index tasks_assignee_member_idx on public.tasks (assignee_member_id, due_date);
create index tasks_assignee_teammate_idx on public.tasks (assignee_teammate_id, organization_id);
create index tasks_improvement_idx on public.tasks (improvement_id, organization_id);
create index tasks_created_by_idx on public.tasks (created_by);

create or replace function private.enforce_task_parent_same_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from public.tasks t
    where t.id = new.parent_id and t.project_id = new.project_id
  ) then
    raise exception 'A subtask lives in its parent''s Project.' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger enforce_task_parent_same_project
  before insert or update of parent_id, project_id on public.tasks
  for each row execute function private.enforce_task_parent_same_project();

-- Removing a Member unassigns their Tasks (#1047). A trigger rather than the
-- operation, beside 20260927160000's memory one: a Member leaves through
-- several doors (removed by an admin, leaving, offboarding) and every one has
-- to land the same. Demoting a Member keeps their Tasks; only leaving clears.
create or replace function private.unassign_departed_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.tasks
     set assignee_member_id = null
   where organization_id = old.organization_id
     and assignee_member_id = old.user_id;
  return old;
end $$;

create trigger organization_members_unassign_tasks
  after delete on public.organization_members
  for each row execute function private.unassign_departed_member();

-- The per-Project number behind `WEB-12`: the hardened `next_improvement_seq`
-- shape (20260820121000), keyed by Project instead of Organization.
create table public.task_counters (
  project_id text primary key references public.projects (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  next_seq integer not null default 1
);
create index task_counters_org_idx on public.task_counters (organization_id);

create or replace function public.next_task_seq(p_project_id text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  org uuid;
  allocated integer;
begin
  select organization_id into org from public.projects where id = p_project_id;
  if org is null then
    raise exception 'not found';
  end if;
  if auth.uid() is not null and not private.can_write_project(p_project_id) then
    raise exception 'not authorized';
  end if;
  insert into public.task_counters (project_id, organization_id, next_seq)
  values (p_project_id, org, 2)
  on conflict (project_id)
  do update set next_seq = task_counters.next_seq + 1
  returning next_seq - 1 into allocated;
  return allocated;
end $$;

revoke execute on function public.next_task_seq(text) from public, anon;
grant execute on function public.next_task_seq(text) to authenticated, service_role;

alter table public.task_counters enable row level security;
create policy "readers see task counters" on public.task_counters
  for select using (private.can_read_project(project_id));

alter table public.tasks enable row level security;
create policy "readers see tasks" on public.tasks
  for select using (private.can_read_project(project_id));
create policy "editors create tasks" on public.tasks
  for insert with check (
    private.can_write_project(project_id)
    and organization_id = private.project_org(project_id)
  );
create policy "editors edit tasks" on public.tasks
  for update using (private.can_write_project(project_id))
  with check (
    private.can_write_project(project_id)
    and organization_id = private.project_org(project_id)
  );
create policy "editors delete tasks" on public.tasks
  for delete using (private.can_write_project(project_id));

create table public.task_dependencies (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id text not null,
  task_id text not null,
  blocked_by_id text not null,
  created_at timestamptz not null default now(),
  constraint task_dependencies_not_self check (task_id <> blocked_by_id),
  -- Both ends in one Project (#1049): a move drops the edges first.
  foreign key (task_id, project_id)
    references public.tasks (id, project_id) on delete cascade,
  foreign key (blocked_by_id, project_id)
    references public.tasks (id, project_id) on delete cascade,
  unique (task_id, blocked_by_id)
);
create index task_dependencies_blocked_by_idx on public.task_dependencies (blocked_by_id, project_id);
create index task_dependencies_project_idx on public.task_dependencies (project_id, task_id);
create index task_dependencies_org_idx on public.task_dependencies (organization_id);

alter table public.task_dependencies enable row level security;
create policy "readers see dependencies" on public.task_dependencies
  for select using (private.can_read_project(project_id));
create policy "editors add dependencies" on public.task_dependencies
  for insert with check (
    private.can_write_project(project_id)
    and organization_id = private.project_org(project_id)
  );
create policy "editors remove dependencies" on public.task_dependencies
  for delete using (private.can_write_project(project_id));

-- Labels belong to the Organization, not a Project: one "Bug" across every
-- Project is what a filter on My Tasks needs (#1049).
create table public.task_labels (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  color text not null default 'gray'
    check (color in ('gray', 'blue', 'green', 'amber', 'red', 'purple')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index task_labels_org_name_uniq on public.task_labels (organization_id, lower(name));

alter table public.task_labels enable row level security;
create policy "members read labels" on public.task_labels
  for select using (private.is_org_member(organization_id));
create policy "editors create labels" on public.task_labels
  for insert with check (private.has_org_role(organization_id, 2));
create policy "editors edit labels" on public.task_labels
  for update using (private.has_org_role(organization_id, 2))
  with check (private.has_org_role(organization_id, 2));
create policy "editors delete labels" on public.task_labels
  for delete using (private.has_org_role(organization_id, 2));

create table public.task_label_links (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id text not null,
  task_id text not null,
  label_id text not null references public.task_labels (id) on delete cascade,
  created_at timestamptz not null default now(),
  foreign key (task_id, project_id)
    references public.tasks (id, project_id) on update cascade on delete cascade,
  unique (task_id, label_id)
);
create index task_label_links_project_idx on public.task_label_links (project_id, task_id);
create index task_label_links_label_idx on public.task_label_links (label_id);
create index task_label_links_org_idx on public.task_label_links (organization_id);

alter table public.task_label_links enable row level security;
create policy "readers see label links" on public.task_label_links
  for select using (private.can_read_project(project_id));
create policy "editors label tasks" on public.task_label_links
  for insert with check (
    private.can_write_project(project_id)
    and organization_id = private.project_org(project_id)
    and exists (
      select 1 from public.task_labels l
      where l.id = label_id and l.organization_id = task_label_links.organization_id
    )
  );
create policy "editors unlabel tasks" on public.task_label_links
  for delete using (private.can_write_project(project_id));

-- Saved Views and Favorites (#1050) ---------------------------------------------

create table public.saved_views (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id text not null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  layout text not null default 'list' check (layout in ('list', 'board', 'table')),
  query jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);
create index saved_views_project_idx on public.saved_views (project_id, created_at);
create index saved_views_org_idx on public.saved_views (organization_id);
create index saved_views_created_by_idx on public.saved_views (created_by);

alter table public.saved_views enable row level security;
create policy "readers see saved views" on public.saved_views
  for select using (private.can_read_project(project_id));
create policy "editors save views" on public.saved_views
  for insert with check (
    private.can_write_project(project_id)
    and organization_id = private.project_org(project_id)
    and created_by = (select auth.uid())
  );
-- Renaming and deleting are the creator's or an Admin's (#1050).
create policy "the creator or an admin edits a view" on public.saved_views
  for update using (
    private.can_read_project(project_id)
    and (created_by = (select auth.uid()) or private.has_org_role(organization_id, 3))
  );
create policy "the creator or an admin deletes a view" on public.saved_views
  for delete using (
    private.can_read_project(project_id)
    and (created_by = (select auth.uid()) or private.has_org_role(organization_id, 3))
  );

create table public.work_favorites (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id text references public.projects (id) on delete cascade,
  task_id text references public.tasks (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint work_favorites_one_target check (num_nonnulls(project_id, task_id) = 1)
);
create unique index work_favorites_project_uniq
  on public.work_favorites (user_id, project_id) where project_id is not null;
create unique index work_favorites_task_uniq
  on public.work_favorites (user_id, task_id) where task_id is not null;
create index work_favorites_org_user_idx on public.work_favorites (organization_id, user_id);
create index work_favorites_project_idx on public.work_favorites (project_id);
create index work_favorites_task_idx on public.work_favorites (task_id);

alter table public.work_favorites enable row level security;
create policy "members read their favorites" on public.work_favorites
  for select using (user_id = (select auth.uid()));
create policy "members star what they can see" on public.work_favorites
  for insert with check (
    user_id = (select auth.uid())
    and private.is_org_member(organization_id)
    and (
      (project_id is not null and private.can_read_project(project_id)
        and private.project_org(project_id) = organization_id)
      or (task_id is not null and exists (
        select 1 from public.tasks t
        where t.id = task_id and t.organization_id = work_favorites.organization_id
          and private.can_read_project(t.project_id)
      ))
    )
  );
create policy "members unstar" on public.work_favorites
  for delete using (user_id = (select auth.uid()));

-- Comments and reactions (#1055) -------------------------------------------------

create table public.task_comments (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id text not null,
  task_id text not null,
  author_member_id uuid references auth.users (id) on delete set null,
  author_teammate_id text,
  -- Markdown with mention tokens `@[Name](member:<uuid>)` (#1041).
  body text not null check (char_length(body) between 1 and 10000),
  -- Derived from the body by `parseMentionTokens` in core at every write,
  -- never accepted from a client.
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  -- Soft delete with a short restore window; the nightly sweep hard-deletes.
  deleted_at timestamptz,
  -- `<= 1` rather than `= 1`: deleting an author's account sets their id to
  -- null and must not fail the row.
  constraint task_comments_one_author
    check (num_nonnulls(author_member_id, author_teammate_id) <= 1),
  foreign key (task_id, project_id)
    references public.tasks (id, project_id) on update cascade on delete cascade,
  foreign key (author_teammate_id, organization_id)
    references public.teammates (id, organization_id) on delete set null (author_teammate_id),
  unique (id, project_id)
);
create index task_comments_task_idx on public.task_comments (task_id, created_at);
create index task_comments_project_idx on public.task_comments (project_id, task_id);
create index task_comments_org_idx on public.task_comments (organization_id);
create index task_comments_author_member_idx on public.task_comments (author_member_id);
create index task_comments_author_teammate_idx on public.task_comments (author_teammate_id, organization_id);

alter table public.task_comments enable row level security;
create policy "readers see comments" on public.task_comments
  for select using (private.can_read_project(project_id));
-- Any reader comments, Viewers included (#1047), as themselves.
create policy "readers comment as themselves" on public.task_comments
  for insert with check (
    private.can_read_project(project_id)
    and organization_id = private.project_org(project_id)
    and author_member_id = (select auth.uid())
  );
create policy "authors edit their comments" on public.task_comments
  for update using (author_member_id = (select auth.uid()))
  with check (
    author_member_id = (select auth.uid())
    and private.can_read_project(project_id)
  );
create policy "authors delete their comments" on public.task_comments
  for delete using (author_member_id = (select auth.uid()));

create table public.task_comment_reactions (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id text not null,
  comment_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 32),
  created_at timestamptz not null default now(),
  foreign key (comment_id, project_id)
    references public.task_comments (id, project_id) on update cascade on delete cascade,
  -- Several per Member, one of each (#1055).
  unique (comment_id, user_id, emoji)
);
create index task_comment_reactions_project_idx on public.task_comment_reactions (project_id, comment_id);
create index task_comment_reactions_user_idx on public.task_comment_reactions (user_id);
create index task_comment_reactions_org_idx on public.task_comment_reactions (organization_id);

alter table public.task_comment_reactions enable row level security;
create policy "readers see reactions" on public.task_comment_reactions
  for select using (private.can_read_project(project_id));
create policy "readers react as themselves" on public.task_comment_reactions
  for insert with check (
    user_id = (select auth.uid())
    and private.can_read_project(project_id)
    and organization_id = private.project_org(project_id)
  );
create policy "members remove their reactions" on public.task_comment_reactions
  for delete using (user_id = (select auth.uid()));

-- Work Activity (#1051) ----------------------------------------------------------
--
-- Append-only and written by the operations through the system Db, so it can
-- record which Teammate did a write without trusting a client to say so. No
-- member write policy at all.

create table public.work_activity (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id text not null,
  task_id text,
  actor_member_id uuid references auth.users (id) on delete set null,
  actor_teammate_id text,
  verb text not null check (char_length(verb) between 1 and 60),
  -- What the verb needs to read back: from/to values, the Task's key and title
  -- at the time (a deleted Task's entry still says what it was).
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade,
  foreign key (task_id, project_id)
    references public.tasks (id, project_id) on update cascade on delete set null (task_id),
  foreign key (actor_teammate_id, organization_id)
    references public.teammates (id, organization_id) on delete set null (actor_teammate_id)
);
create index work_activity_project_idx on public.work_activity (project_id, created_at desc);
create index work_activity_task_idx on public.work_activity (task_id, project_id, created_at);
create index work_activity_org_idx on public.work_activity (organization_id, created_at);
create index work_activity_actor_member_idx on public.work_activity (actor_member_id);
create index work_activity_actor_teammate_idx on public.work_activity (actor_teammate_id, organization_id);

alter table public.work_activity enable row level security;
create policy "readers see activity" on public.work_activity
  for select using (private.can_read_project(project_id));

-- Member Notifications (#1048) ---------------------------------------------------
--
-- Addressed to one Member and inserted by the operations through the system Db:
-- a Member cannot write a row addressed to somebody else, so `authenticated`
-- gets no insert policy. The recipient reads and marks their own.

create table public.member_notifications (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('assigned', 'mentioned', 'commented', 'status_changed')),
  project_id text not null,
  task_id text not null,
  comment_id text references public.task_comments (id) on delete cascade,
  actor_member_id uuid references auth.users (id) on delete set null,
  actor_teammate_id text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  foreign key (task_id, project_id)
    references public.tasks (id, project_id) on update cascade on delete cascade,
  foreign key (actor_teammate_id, organization_id)
    references public.teammates (id, organization_id) on delete set null (actor_teammate_id)
);
create index member_notifications_recipient_idx
  on public.member_notifications (recipient_id, organization_id, created_at desc);
create index member_notifications_task_idx on public.member_notifications (task_id, project_id);
create index member_notifications_comment_idx on public.member_notifications (comment_id);
create index member_notifications_org_idx on public.member_notifications (organization_id, created_at);
create index member_notifications_actor_member_idx on public.member_notifications (actor_member_id);
create index member_notifications_actor_teammate_idx on public.member_notifications (actor_teammate_id, organization_id);

alter table public.member_notifications enable row level security;
create policy "recipients read their notifications" on public.member_notifications
  for select using (recipient_id = (select auth.uid()));
create policy "recipients mark their notifications" on public.member_notifications
  for update using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));
create policy "recipients clear their notifications" on public.member_notifications
  for delete using (recipient_id = (select auth.uid()));

create table public.notification_preferences (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email_assigned boolean not null default true,
  email_mentioned boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index notification_preferences_user_idx on public.notification_preferences (user_id);

alter table public.notification_preferences enable row level security;
create policy "members read their preferences" on public.notification_preferences
  for select using (user_id = (select auth.uid()));
create policy "members create their preferences" on public.notification_preferences
  for insert with check (
    user_id = (select auth.uid()) and private.is_org_member(organization_id)
  );
create policy "members change their preferences" on public.notification_preferences
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Teammates learn the `tasks` grant domain (#1051) ------------------------------

alter table public.teammate_grants
  drop constraint teammate_grants_domain_check;
alter table public.teammate_grants
  add constraint teammate_grants_domain_check
  check (domain in ('improvements', 'knowledge', 'inbox', 'flows', 'tasks'));
