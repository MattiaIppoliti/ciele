-- Member Notifications are kept for 90 days (#1048, #1067).
--
-- A notification is a pointer into a Task that already keeps its own history
-- (work_activity, its comments), so an old one carries nothing the Task does
-- not. The nightly retention sweep calls this on the service role with the
-- cutoff, the same shape as purge_expired_object_access_events; the window
-- itself lives in the caller (MEMBER_NOTIFICATION_RETENTION_DAYS).

create index if not exists member_notifications_created_idx
  on public.member_notifications (created_at, id);

create or replace function public.purge_expired_member_notifications(
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
  -- Bounded per tick, oldest first, so a backlog drains over a few nights
  -- instead of holding one long delete.
  delete from public.member_notifications
  where id in (
    select id from public.member_notifications
    where created_at < p_cutoff
    order by created_at, id
    limit greatest(p_limit, 1)
  );
  get diagnostics purged = row_count;
  return purged;
end;
$$;

revoke all on function public.purge_expired_member_notifications(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.purge_expired_member_notifications(timestamptz, integer) to service_role;
