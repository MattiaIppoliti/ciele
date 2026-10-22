-- Write guards for the work domain (the #1076 review).
--
-- A policy sees a row, not which column changed, so a rule about columns is a
-- trigger (supabase/CLAUDE.md). Each guard lets a cascaded write through:
-- moving a Task rewrites `project_id` on its comments, notifications and
-- files through `on update cascade`, and that update arrives from the
-- referential-integrity trigger, one level deeper than a client's own write.

-- Project files: the object path is the server's. -----------------------------
-- The download route serves `storage_path` with the service role, and delete
-- removes it, so a path a client wrote straight to PostgREST could name
-- another Organization's object. It must sit under this file's Organization
-- and Project when the row is created (the folder below that is the upload
-- ticket's id, which is not the row's), and it never changes afterwards (a
-- rename changes `name`, not the object).
create or replace function private.guard_project_file_path()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.storage_path not like
      'org/' || new.organization_id || '/projects/' || new.project_id || '/%' then
      raise exception 'A file''s storage path is set by the server.' using errcode = '42501';
    end if;
  elsif new.storage_path is distinct from old.storage_path and pg_trigger_depth() <= 1 then
    raise exception 'A file''s storage path never changes.' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger guard_project_file_path
  before insert or update of storage_path on public.project_files
  for each row execute function private.guard_project_file_path();

-- Comments: mentions come from the body, and a comment stays where it is. --------
-- `mentions` is what notifications and chips read; the operation derives it
-- from the body's `@[Name](member:<id>)` tokens, and so does this, so a write
-- that sends its own list gets the body's instead. First-seen order, no
-- duplicates, and only ids shaped like a uuid (the column's type).
create or replace function private.derive_comment_mentions(body text)
returns uuid[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(member_id::uuid order by first_seen), '{}')
  from (
    select match[2] as member_id, min(position) as first_seen
    from regexp_matches(body, '@\[([^]' || chr(10) || ']{1,80})\]\(member:([0-9a-zA-Z-]{1,64})\)', 'g')
      with ordinality as found(match, position)
    where match[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    group by match[2]
  ) ids
$$;

create or replace function private.guard_task_comment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.mentions := private.derive_comment_mentions(new.body);
  if tg_op = 'UPDATE' and pg_trigger_depth() <= 1 and (
    new.task_id is distinct from old.task_id
    or new.organization_id is distinct from old.organization_id
    or new.author_member_id is distinct from old.author_member_id
    or new.author_teammate_id is distinct from old.author_teammate_id
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'A comment''s Task, author and time never change.' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger guard_task_comment
  before insert or update on public.task_comments
  for each row execute function private.guard_task_comment();

-- Member Notifications: the recipient files them, nothing more. ---------------
-- The update policy lets a recipient write their own rows, which is how they
-- mark, archive and snooze. Those three columns are all it may change.
create or replace function private.guard_member_notification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() <= 1 and (
    new.organization_id is distinct from old.organization_id
    or new.recipient_id is distinct from old.recipient_id
    or new.kind is distinct from old.kind
    or new.project_id is distinct from old.project_id
    or new.task_id is distinct from old.task_id
    or new.comment_id is distinct from old.comment_id
    or new.actor_member_id is distinct from old.actor_member_id
    or new.actor_teammate_id is distinct from old.actor_teammate_id
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'A notification only changes how its recipient filed it.' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger guard_member_notification
  before update on public.member_notifications
  for each row execute function private.guard_member_notification();

-- The composite foreign keys get the indexes they reference by. ---------------
-- `(project_id, organization_id)` is how each of these points at its Project;
-- without an index leading with both, a Project delete scans the table.
create index if not exists tasks_project_org_idx on public.tasks (project_id, organization_id);
create index if not exists project_members_project_org_idx on public.project_members (project_id, organization_id);
create index if not exists project_milestones_project_org_idx on public.project_milestones (project_id, organization_id);
create index if not exists saved_views_project_org_idx on public.saved_views (project_id, organization_id);
create index if not exists work_activity_project_org_idx on public.work_activity (project_id, organization_id);
create index if not exists project_files_project_org_idx on public.project_files (project_id, organization_id);
