-- Supabase advisor remediation (four findings from the security/performance
-- linter). One migration, ordered by finding:
--   1. Claim ledgers: document intentional deny-all RLS + revoke anon/auth.
--   2. public-assets bucket: drop the broad listing SELECT policy.
--   3. Unindexed foreign keys: add covering btree indexes.
--   4. reject_consumer_email_domains: revoke direct RPC EXECUTE from anon/auth.

-- ---------------------------------------------------------------------------
-- 1. Claim ledgers "RLS enabled, no policy" (answer_verifier_claims,
--    compost_claims).
--
-- Both are service-role-only lease ledgers written and read exclusively by the
-- scheduled verifier / compost passes (the /api/cron tick runs on the
-- service-role widget Db, which bypasses RLS). answer_verifier_claims is also
-- touched directly via PostgREST `.from("answer_verifier_claims").delete()`
-- (releaseAnswerVerifierClaim); PostgREST does not expose the `private` schema,
-- so moving these ledgers there would break that runtime path. They therefore
-- stay in `public`. RLS-enabled-with-no-policy already denies every anon /
-- authenticated request (RLS default-denies when no policy grants access), and
-- service_role bypasses RLS by design — so this is a correct, intentional
-- deny-all. We make that intent explicit with a table comment and defensively
-- revoke the table-level grants Supabase's default privileges hand to anon /
-- authenticated (service_role keeps its grants, so the cron path is unaffected).
comment on table public.answer_verifier_claims is
  'Service-role-only per-message verifier lease ledger. Intentional deny-all '
  'RLS (RLS on, no policy): only the scheduled answer verifier (service-role, '
  'bypasses RLS) reads/writes it. Accessed via PostgREST .from() so it must '
  'stay in public; anon/authenticated have no access.';

comment on table public.compost_claims is
  'Service-role-only per-assistant compost lease ledger. Intentional deny-all '
  'RLS (RLS on, no policy): only the scheduled compost pass (service-role, '
  'bypasses RLS) reads/writes it, via the claim_due_compost_assistants RPC. '
  'Kept in public alongside its twin answer_verifier_claims; anon/authenticated '
  'have no access.';

revoke all on table public.answer_verifier_claims from anon, authenticated;
revoke all on table public.compost_claims from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. public-assets bucket "public bucket allows listing".
--
-- 0040 added a broad `for select to public` policy on storage.objects for this
-- bucket, which lets any client enumerate every object with .list(). A public
-- bucket serves objects by URL (/object/public/...) WITHOUT any SELECT policy,
-- so dropping this policy keeps avatar/logo URLs resolving (#33/#37 fetch by
-- stored URL, never .list()) while blocking directory listing. Writes stay
-- gated by the org-scoped insert/update/delete policies from 0040.
drop policy if exists "public read public assets" on storage.objects;

-- ---------------------------------------------------------------------------
-- 3. Unindexed foreign keys (INFO): add covering btree indexes so FK lookups
--    and cascade/set-null maintenance don't sequential-scan.
create index if not exists ai_usage_assistant_idx
  on public.ai_usage (assistant_id);
create index if not exists runtime_events_assistant_idx
  on public.runtime_events (assistant_id);
create index if not exists alerts_resolved_by_idx
  on public.alerts (resolved_by);
create index if not exists assistant_goal_runs_org_idx
  on public.assistant_goal_runs (organization_id);
create index if not exists compost_runs_org_idx
  on public.compost_runs (organization_id);

-- ---------------------------------------------------------------------------
-- 4. reject_consumer_email_domains still anon/authenticated-executable.
--
-- 0033 did `revoke execute ... from public`, but Supabase's default privileges
-- also grant EXECUTE directly to anon/authenticated, and revoking from PUBLIC
-- does not remove a direct grant — so the advisor still sees it RPC-callable.
-- Revoke those direct grants. It is a trigger-only SECURITY DEFINER function:
-- Postgres invokes trigger functions through the trigger manager (with the
-- function owner's rights) regardless of EXECUTE grants, so removing RPC
-- EXECUTE does not affect the BEFORE INSERT trigger on auth.users -- it only
-- removes the /rest/v1/rpc surface (same reasoning as 0022/0033).
revoke execute on function public.reject_consumer_email_domains() from anon, authenticated;
