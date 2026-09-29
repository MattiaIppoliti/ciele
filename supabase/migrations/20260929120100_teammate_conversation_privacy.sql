-- A 1:1 Teammate chat is private to the Member who started it.
--
-- 20260821140000_teammates.sql gave conversations and messages a second branch
-- for Teammates, and that branch only asked "is the caller in the Teammate's
-- Organization". Any Member could therefore read, or write into, a colleague's
-- Teammate thread through PostgREST, although the app only ever lists the
-- caller's own (`listTeammateConversations` filters on subject_id).
--
-- The Teammate branch now also requires subject_type = 'member' and
-- subject_id = the caller. The Assistant branch is unchanged: org members read
-- Assistant Conversations, which is what the Inbox is.
--
-- Messages reach the same rule through one security-definer helper, so the read
-- policy and the user-insert policy cannot drift apart, and so the check does
-- not depend on what the caller may read of `conversations` under RLS.

create or replace function private.can_access_conversation(p_conversation_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversations c
    left join public.assistants a on a.id = c.assistant_id
    left join public.teammates t on t.id = c.teammate_id
    where c.id = p_conversation_id
      and (
        (c.assistant_id is not null and private.is_org_member(a.organization_id))
        or (
          c.teammate_id is not null
          and c.subject_type = 'member'
          and c.subject_id = (select auth.uid())::text
          and private.is_org_member(t.organization_id)
        )
      )
  )
$$;

revoke all on function private.can_access_conversation(text) from public;
grant execute on function private.can_access_conversation(text)
  to authenticated, service_role;

drop policy "members read own conversations" on public.conversations;
create policy "members read own conversations" on public.conversations
  for select using (
    exists (
      select 1 from public.assistants a
      where a.id = conversations.assistant_id
        and private.is_org_member(a.organization_id)
    )
    or (
      conversations.subject_type = 'member'
      and conversations.subject_id = (select auth.uid())::text
      and exists (
        select 1 from public.teammates t
        where t.id = conversations.teammate_id
          and private.is_org_member(t.organization_id)
      )
    )
  );

drop policy "members write own conversations" on public.conversations;
create policy "members write own conversations" on public.conversations
  for insert with check (
    exists (
      select 1 from public.assistants a
      where a.id = conversations.assistant_id
        and private.is_org_member(a.organization_id)
    )
    or (
      conversations.subject_type = 'member'
      and conversations.subject_id = (select auth.uid())::text
      and exists (
        select 1 from public.teammates t
        where t.id = conversations.teammate_id
          and private.is_org_member(t.organization_id)
      )
    )
  );

drop policy "members read messages" on public.messages;
create policy "members read messages" on public.messages
  for select using (private.can_access_conversation(conversation_id));

-- Same conditions as 20260828070500_turn_effect_outbox.sql (role and deferred
-- effects), with the org test swapped for the conversation-level rule.
drop policy "members write user messages" on public.messages;
create policy "members write user messages" on public.messages
  for insert with check (
    role = 'user'
    and jsonb_array_length(deferred_effects) = 0
    and private.can_access_conversation(conversation_id)
  );
