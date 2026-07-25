-- Security lint (0022's reject_consumer_email_domains is SECURITY DEFINER
-- with no explicit grant, so Postgres defaults it to PUBLIC-executable —
-- callable directly via /rest/v1/rpc/reject_consumer_email_domains).
-- It's trigger-only; Postgres invokes trigger functions via the trigger
-- manager regardless of EXECUTE grants, so revoking here doesn't affect the
-- BEFORE INSERT trigger on auth.users, only removes the RPC exposure —
-- same pattern as 0026_backfill_private_schema_hardening.
revoke execute on function public.reject_consumer_email_domains() from public;
