-- The Support Agent Role (#1086): a Member who works the Inbox, takes
-- Conversations over, replies, releases, uses Quick Texts and staffs Help
-- Desks as an operator, and changes nothing else.
--
-- It is not a rung on the ladder. `public.role_rank` ends in `else 1`, so the
-- new value ranks as a Viewer in every existing `has_org_role(org, n)`
-- comparison and no existing policy allows it anything new. The one thing it
-- may do beyond a Viewer goes through the named check
-- `private.can_operate_conversations`, widened here.
--
-- `add value` cannot be used in the transaction that adds it, so the function
-- below compares the role as text rather than casting a literal to the enum.

alter type public.org_role add value if not exists 'support_agent';

create or replace function private.can_operate_conversations(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.has_org_role(org, 2)
    or exists (
      select 1 from public.organization_members m
      where m.organization_id = org
        and m.user_id = (select auth.uid())
        and m.role::text = 'support_agent'
    )
$$;

comment on column public.organization_api_keys.role is
  'owner | admin | editor | viewer | support_agent: the Role the key acts with, capped at its creator''s';
