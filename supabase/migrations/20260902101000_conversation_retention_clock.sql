-- The transcript-retention clock is last activity, not creation (#801,
-- CYB-12, from the round-1 review).
--
-- `delete_expired_conversations` aged a Conversation by `created_at`, so a
-- thread opened 31 days ago and still in use this morning was deleted by a
-- 30-day policy, with its newest messages. A retention window is a promise
-- about how long a record is kept *after it stops changing*; the column that
-- says when a Conversation last changed is `updated_at`, which every appended
-- message moves.
--
-- Same signature, same security posture, same idempotency as the version in
-- 20260830130000_transcript_retention.sql; only the predicate's column changes.
-- The sweep now scans by `updated_at`, so the index follows it.

create index if not exists conversations_updated_idx
  on public.conversations (updated_at);

drop index if exists public.conversations_created_idx;

create or replace function public.delete_expired_conversations(
  p_organization_id uuid,
  p_cutoff timestamptz
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
    select c.id
    from public.conversations c
    left join public.assistants a on a.id = c.assistant_id
    left join public.teammates t on t.id = c.teammate_id
    where coalesce(a.organization_id, t.organization_id) = p_organization_id
      and c.legal_hold = false
      and c.updated_at < p_cutoff
  )
  delete from public.conversations c
  using expired
  where c.id = expired.id;
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

comment on function public.delete_expired_conversations is
  'Deletes one Organization''s Conversations whose last activity (updated_at) predates the cutoff, skipping legal holds. Idempotent.';
