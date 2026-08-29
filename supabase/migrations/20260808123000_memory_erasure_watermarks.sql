-- Make a subject-level Memory erasure durable. A queued extraction job may
-- still finish after the admin wipe; its source Conversation predates this
-- watermark, so the insert trigger suppresses it atomically.

create table public.memory_erasure_watermarks (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  subject_id text not null,
  erased_at timestamptz not null default now(),
  primary key (organization_id, subject_id)
);

alter table public.memory_erasure_watermarks enable row level security;

create policy "members read memory erasure watermarks"
  on public.memory_erasure_watermarks
  for select using (private.is_org_member(organization_id));
create policy "editors create memory erasure watermarks"
  on public.memory_erasure_watermarks
  for insert with check (private.has_org_role(organization_id, 2));
create policy "editors update memory erasure watermarks"
  on public.memory_erasure_watermarks
  for update using (private.has_org_role(organization_id, 2));

create or replace function public.erase_subject_memories(
  p_organization_id uuid,
  p_subject_id text
)
returns void
language plpgsql
as $$
begin
  -- Serialize this subject's wipe with every Memory INSERT. If an INSERT
  -- owns the lock first, the DELETE sees and removes it; if the wipe owns it
  -- first, the trigger below observes the watermark after it resumes.
  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':' || p_subject_id, 0)
  );

  insert into public.memory_erasure_watermarks (
    organization_id,
    subject_id,
    erased_at
  ) values (
    p_organization_id,
    p_subject_id,
    now()
  )
  on conflict (organization_id, subject_id)
  do update set erased_at = excluded.erased_at;

  delete from public.memories
  where organization_id = p_organization_id
    and subject_id = p_subject_id;
end;
$$;

alter function public.erase_subject_memories(uuid, text)
  set search_path = public, private;

create or replace function public.reject_pre_erasure_memory()
returns trigger
language plpgsql
as $$
declare
  source_created_at timestamptz;
  watermark timestamptz;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(new.organization_id::text || ':' || new.subject_id, 0)
  );

  if new.conversation_id is null then
    return new;
  end if;

  select c.created_at
  into source_created_at
  from public.conversations c
  join public.assistants a on a.id = c.assistant_id
  where c.id = new.conversation_id
    and c.subject_type = 'sso'
    and c.subject_id = new.subject_id
    and a.organization_id = new.organization_id;

  select erased_at
  into watermark
  from public.memory_erasure_watermarks
  where organization_id = new.organization_id
    and subject_id = new.subject_id;

  if source_created_at is not null
    and watermark is not null
    and source_created_at <= watermark then
    return null;
  end if;

  return new;
end;
$$;

alter function public.reject_pre_erasure_memory()
  set search_path = public;

create trigger reject_pre_erasure_memory
  before insert on public.memories
  for each row execute function public.reject_pre_erasure_memory();
