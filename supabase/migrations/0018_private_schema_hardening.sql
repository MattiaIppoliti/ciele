-- Security hardening from the Supabase security checklist ("do not put
-- security definer functions in an exposed schema"): is_org_member/
-- has_org_role/handle_new_user were security-definer functions sitting in
-- `public`, which PostgREST exposes for RPC — anyone with the anon key could
-- call them at /rest/v1/rpc/is_org_member etc. Move the RLS-only helpers to
-- a private, unexposed schema; PostgREST never lists `private` for RPC, so
-- this fully removes them from the API surface with no behavior change.
--
-- This is safe without touching any RLS policy: Postgres resolves a
-- policy's function call to a fixed OID at CREATE POLICY time, not by name
-- at every execution, so `alter function ... set schema` doesn't require
-- recreating the ~50 policies that call these helpers.

create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role;

alter function public.is_org_member(uuid) set schema private;
alter function public.has_org_role(uuid, integer) set schema private;

-- Trigger-only function (fires on auth.users insert): triggers reference
-- functions by OID too, so moving it out of the exposed schema doesn't
-- affect the on_auth_user_created trigger.
alter function public.handle_new_user() set schema private;

-- accept_invite/create_organization/join_demo_org/next_improvement_seq must
-- stay in `public` (called directly via supabase.rpc(...) from the app), but
-- none of them need to be callable by unauthenticated (`anon`) requests —
-- each already requires auth.uid() to be set except next_improvement_seq,
-- which is only ever reached from an authenticated org member's "create
-- improvement" flow. They each currently have an explicit grant to `anon` in
-- addition to the PUBLIC grant, so both must be revoked.

revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated, service_role;

revoke execute on function public.create_organization(text) from public, anon;
grant execute on function public.create_organization(text) to authenticated, service_role;

revoke execute on function public.join_demo_org() from public, anon;
grant execute on function public.join_demo_org() to authenticated, service_role;

revoke execute on function public.next_improvement_seq(uuid) from public, anon;
grant execute on function public.next_improvement_seq(uuid) to authenticated, service_role;
