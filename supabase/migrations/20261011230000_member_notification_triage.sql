-- Archive and snooze on a Member's own notifications.
--
-- Both are a timestamp rather than a flag. An archived row is kept, so the
-- retention sweep stays the only thing that removes rows on its own. A snoozed
-- row comes back by itself once `snoozed_until` passes, with no job to wake it:
-- the read compares against now(). Deleting needs nothing new, the
-- "recipients clear their notifications" policy already allows it, and the
-- "recipients mark their notifications" update policy covers both columns.

alter table public.member_notifications
  add column if not exists archived_at timestamptz,
  add column if not exists snoozed_until timestamptz;
