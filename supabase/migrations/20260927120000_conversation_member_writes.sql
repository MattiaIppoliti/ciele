-- Console writes to a Visitor Conversation, and the legal hold that guards it.
--
-- Since 0004 the UPDATE and DELETE policies on `conversations` matched only a
-- row whose subject is the signed-in Member, the Assistant Preview's own
-- threads. Every Inbox write goes through the session's RLS client, so on a
-- Visitor's Conversation a pin, a legal hold, a feedback note or a delete
-- matched zero rows and returned no error. The Inbox showed a hold that the
-- database never recorded, and the nightly retention sweep deleted the
-- conversation it was meant to preserve.
--
-- Three rules, each where it can actually hold:
--
-- 1. UPDATE and DELETE widen to the Organization that owns the Assistant, the
--    same reach the SELECT policy already has. A Teammate Conversation keeps
--    its old rule, its own Member only: it is internal chat, and being able to
--    read a colleague's thread is not being able to rewrite it.
-- 2. Changing `legal_hold` is an admin act (the operation says
--    `manageMembers`). A policy sees a row, not a column, so that is a trigger.
--    A service-role or superuser caller has no `auth.uid()` and passes: the
--    operations layer already gated it.
-- 3. A held Conversation cannot be deleted by anyone, through any path: the
--    Inbox, an API key, the retention sweep, or the cascade from deleting its
--    Assistant or Teammate. A hold is released first, on purpose, by an admin.

drop policy if exists "members update own conversations" on public.conversations;
create policy "members update own conversations" on public.conversations
  for update using (
    (subject_type = 'member' and subject_id = (select auth.uid())::text)
    or exists (
      select 1 from public.assistants a
      where a.id = conversations.assistant_id
        and private.is_org_member(a.organization_id)
    )
  );

drop policy if exists "members delete own conversations" on public.conversations;
create policy "members delete own conversations" on public.conversations
  for delete using (
    (subject_type = 'member' and subject_id = (select auth.uid())::text)
    or exists (
      select 1 from public.assistants a
      where a.id = conversations.assistant_id
        and private.is_org_member(a.organization_id)
    )
  );

create or replace function private.guard_conversation_legal_hold_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid;
begin
  if new.legal_hold is not distinct from old.legal_hold then
    return new;
  end if;
  -- Service role, cron and migrations: no end-user identity to check.
  if (select auth.uid()) is null then
    return new;
  end if;
  select coalesce(a.organization_id, t.organization_id) into org
  from (select 1) one
  left join public.assistants a on a.id = new.assistant_id
  left join public.teammates t on t.id = new.teammate_id;
  if org is null or not private.has_org_role(org, 3) then
    raise exception 'Only an organization admin can change a legal hold'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

drop trigger if exists conversations_legal_hold_change on public.conversations;
create trigger conversations_legal_hold_change
before update of legal_hold on public.conversations
for each row execute function private.guard_conversation_legal_hold_change();

create or replace function private.refuse_held_conversation_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.legal_hold then
    raise exception 'Conversation % is under legal hold; release the hold before deleting it', old.id
      using errcode = 'restrict_violation';
  end if;
  return old;
end
$$;

drop trigger if exists conversations_refuse_held_delete on public.conversations;
create trigger conversations_refuse_held_delete
before delete on public.conversations
for each row execute function private.refuse_held_conversation_delete();
