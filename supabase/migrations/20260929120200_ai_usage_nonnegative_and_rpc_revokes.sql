-- Two small closures found in the same review.
--
-- 1. ai_usage: a Member may insert rows for their own org (Preview turns run on
--    the session client), and nothing stopped a negative token count. The
--    budget check sums today's rows, so a -1e9 row buys unlimited turns. Any
--    negative row already there is an attack artifact and is removed first; the
--    constraint then goes in NOT VALID and is validated.
--
-- 2. Three SECURITY DEFINER functions from 20260827120000_application_knowledge
--    were revoked from PUBLIC only. Supabase grants EXECUTE on new functions to
--    anon and authenticated directly, so `revoke ... from public` left them
--    callable through /rest/v1/rpc with no caller check. Every caller uses the
--    service-role Db, so nothing legitimate loses access.

delete from public.ai_usage where input_tokens < 0 or output_tokens < 0;

alter table public.ai_usage
  add constraint ai_usage_tokens_nonnegative
  check (input_tokens >= 0 and output_tokens >= 0) not valid;
alter table public.ai_usage validate constraint ai_usage_tokens_nonnegative;

revoke all on function public.acquire_application_import_sync(text, uuid)
  from public, anon, authenticated;
revoke all on function public.reserve_application_knowledge_bytes(text, uuid, bigint, bigint)
  from public, anon, authenticated;
revoke all on function public.cancel_application_sync_jobs(text, text)
  from public, anon, authenticated;
grant execute on function public.acquire_application_import_sync(text, uuid) to service_role;
grant execute on function public.reserve_application_knowledge_bytes(text, uuid, bigint, bigint) to service_role;
grant execute on function public.cancel_application_sync_jobs(text, text) to service_role;
