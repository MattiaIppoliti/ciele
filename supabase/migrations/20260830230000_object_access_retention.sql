-- Enforced retention for the object-access ledger (#801, CYB-19).
--
-- The ledger is append-only by policy (no update, no delete through
-- PostgREST), which is right for evidence and wrong forever: rows carry IP
-- and user agent, and "we keep security telemetry with personal data in it
-- indefinitely" is its own finding. Retention is therefore enforced by a
-- server-side function the nightly cron calls on the service role, the same
-- writer that appends, so the API surface stays delete-free.
--
-- The window is generous by design (the caller passes the cutoff; the shipped
-- constant is 400 days, past an annual audit cycle with margin): this exists
-- to bound the tail, not to shorten the evidence an investigation needs. The
-- detection rules read 30 days, so no detection is ever starved by it.

create or replace function public.purge_expired_object_access_events(
  p_cutoff timestamptz
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  purged integer;
begin
  delete from public.object_access_events where created_at < p_cutoff;
  get diagnostics purged = row_count;
  return purged;
end;
$$;
