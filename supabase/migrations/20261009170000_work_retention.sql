-- How long the work domain keeps what was deleted or merely logged (#1055,
-- #1051). Both are called by the nightly retention sweep on the service role,
-- the same shapes as purge_expired_member_notifications and
-- delete_expired_memories; the windows live in the caller.
--
-- 1. A deleted Task comment is a soft delete with a ten-minute Undo. The sweep
--    hard-deletes it once it has been deleted for a day, which is what makes
--    deleting your words final.
-- 2. Work Activity follows the Organization's transcript retention window: the
--    log is history of the same kind, and a tenant that keeps conversations
--    for 30 days should not find a year of who-did-what kept by default.

create index if not exists task_comments_deleted_idx
  on public.task_comments (deleted_at, id)
  where deleted_at is not null;

create or replace function public.purge_deleted_task_comments(
  p_cutoff timestamptz,
  p_limit integer default 5000
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  purged integer;
begin
  -- Reactions and the notifications that point at a comment go with it (FK
  -- cascade). Bounded per tick, oldest first.
  delete from public.task_comments
  where id in (
    select id from public.task_comments
    where deleted_at is not null and deleted_at < p_cutoff
    order by deleted_at, id
    limit greatest(p_limit, 1)
  );
  get diagnostics purged = row_count;
  return purged;
end;
$$;

revoke all on function public.purge_deleted_task_comments(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.purge_deleted_task_comments(timestamptz, integer) to service_role;

create or replace function public.delete_expired_work_activity(
  p_organization_id uuid,
  p_cutoff timestamptz,
  p_limit integer default 5000
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  deleted integer;
begin
  with expired as (
    select a.id
    from public.work_activity a
    where a.organization_id = p_organization_id
      and a.created_at < p_cutoff
    order by a.created_at, a.id
    limit greatest(p_limit, 1)
  )
  delete from public.work_activity a
  using expired
  where a.id = expired.id;
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke all on function public.delete_expired_work_activity(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.delete_expired_work_activity(uuid, timestamptz, integer) to service_role;
