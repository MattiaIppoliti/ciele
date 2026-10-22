-- Project files and Task attachments (#1049 decision 12, #1068).
--
-- One record: an attachment is a Project file whose `task_id` is set, so the
-- Project's Files view and a Task's drawer read the same table and a file can
-- never be listed twice. The bytes live in the private `work-files` bucket at
--   org/{organizationId}/projects/{projectId}/{fileId}/{name}
-- and are only ever read and written by the service role, behind operations
-- that check the Project's read and write rules first (private Projects
-- cannot be expressed as a storage policy without a second copy of those
-- rules, so the bucket has none for `authenticated` and denies by default).
-- Deleting the Task or the Project deletes the rows by cascade; the operations
-- collect the object paths first and remove the objects after.

create table public.project_files (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id text not null,
  task_id text,
  name text not null check (char_length(name) between 1 and 255),
  storage_path text not null unique,
  content_type text not null default 'application/octet-stream',
  -- The Knowledge upload cap: 50 MB.
  size_bytes bigint not null check (size_bytes between 0 and 52428800),
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade,
  foreign key (task_id, project_id)
    references public.tasks (id, project_id) on update cascade on delete cascade
);

create index project_files_project_idx on public.project_files (project_id, created_at);
create index project_files_task_idx on public.project_files (task_id, project_id);
create index project_files_org_idx on public.project_files (organization_id);
create index project_files_uploaded_by_idx on public.project_files (uploaded_by);

alter table public.project_files enable row level security;
create policy "readers see files" on public.project_files
  for select using (private.can_read_project(project_id));
create policy "editors add files" on public.project_files
  for insert with check (
    private.can_write_project(project_id)
    and organization_id = private.project_org(project_id)
    and uploaded_by = (select auth.uid())
  );
create policy "editors rename files" on public.project_files
  for update using (private.can_write_project(project_id))
  with check (
    private.can_write_project(project_id)
    and organization_id = private.project_org(project_id)
  );
create policy "editors delete files" on public.project_files
  for delete using (private.can_write_project(project_id));

-- The bucket ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('work-files', 'work-files', false, 52428800)
on conflict (id) do update
set public = excluded.public, file_size_limit = excluded.file_size_limit;

-- Downloads go through the object-access ledger like every other private
-- object (#801, CYB-05), so the ledger learns the new kind. The constraint is
-- found by what it checks rather than by its generated name, because a wrong
-- name would make `drop constraint if exists` a silent no-op.
do $$
declare
  existing text;
begin
  for existing in
    select conname from pg_constraint
    where conrelid = 'public.object_access_events'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%object_kind%'
  loop
    execute format('alter table public.object_access_events drop constraint %I', existing);
  end loop;
end
$$;

alter table public.object_access_events
  add constraint object_access_events_object_kind_check
  check (object_kind in ('knowledge_original', 'analytics_export', 'work_file'));
