-- Human operators in a Conversation (#1082, #1083).
--
-- A Member can take a live Visitor Conversation over from the Inbox and answer
-- it; while they hold it the AI does not answer. A Visitor can also ask for a
-- person through a Live operator Support Channel, which puts the Conversation
-- in a waiting state until somebody takes it over or the wait runs out.
--
-- Four things, each where it can hold:
--
-- 1. Who answers is columns on `conversations`, not keys in `metadata`: taking
--    over is a compare-and-set on `operator_member_id is null`, and a filter
--    needs a column. The wait's expiry is not stored, it is
--    `waiting_since + wait_timeout_minutes`, derived at read time, so no job
--    has to end a wait.
-- 2. Messages gain two roles. `operator` is a Member's reply to the Visitor;
--    `system` is a line about the Conversation ("Dana joined"). Every
--    analytics read, the Answer Verdict and Trust Tier inputs already filter on
--    `role = 'assistant'`, so neither is ever counted as an AI answer.
-- 3. Changing who answers is gated by `private.may_answer_conversation`, a
--    named check rather than a rank comparison (the Support Agent Role, #1086,
--    may do this and nothing else an Editor may). A policy sees a row and not a
--    column, so the rule on the operator columns is a trigger.
-- 4. A Member inserts an operator or system message only as themselves, only
--    into a Conversation they may operate.

alter table public.conversations
  add column if not exists operator_state text not null default 'ai',
  add column if not exists operator_member_id uuid,
  add column if not exists operator_name text,
  add column if not exists operator_held_at timestamptz,
  add column if not exists waiting_since timestamptz,
  add column if not exists waiting_help_desk_id text,
  add column if not exists waiting_channel_id text,
  add column if not exists wait_timeout_minutes integer,
  add column if not exists assigned_member_id uuid,
  add column if not exists assigned_at timestamptz;

alter table public.conversations
  drop constraint if exists conversations_operator_state_check;
alter table public.conversations
  add constraint conversations_operator_state_check
  check (operator_state in ('ai', 'waiting', 'held'));

alter table public.conversations
  drop constraint if exists conversations_wait_timeout_check;
alter table public.conversations
  add constraint conversations_wait_timeout_check
  check (wait_timeout_minutes is null or wait_timeout_minutes between 1 and 60);

-- The Waiting view and the held lookups read only the few rows that are not
-- the AI's, so the index covers exactly those.
create index if not exists conversations_operator_state_idx
  on public.conversations (operator_state, waiting_since)
  where operator_state <> 'ai';

alter table public.messages drop constraint if exists messages_role_check;
alter table public.messages
  add constraint messages_role_check
  check (role in ('user', 'assistant', 'operator', 'system'));

alter table public.messages
  add column if not exists author_member_id uuid,
  add column if not exists author_name text;

-- Who may take over, answer and release a Conversation in this Organization.
-- Editors and above today; #1086 widens it to the Support Agent Role.
create or replace function private.can_operate_conversations(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.has_org_role(org, 2)
$$;

revoke all on function private.can_operate_conversations(uuid) from public;
grant execute on function private.can_operate_conversations(uuid)
  to authenticated, service_role;

-- The same rule asked of one Assistant Conversation. A Teammate Conversation
-- is internal chat and has no Visitor to answer, so it never qualifies.
create or replace function private.may_answer_conversation(p_conversation_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversations c
    join public.assistants a on a.id = c.assistant_id
    where c.id = p_conversation_id
      and private.can_operate_conversations(a.organization_id)
  )
$$;

revoke all on function private.may_answer_conversation(text) from public;
grant execute on function private.may_answer_conversation(text)
  to authenticated, service_role;

-- Every operator column is guarded, not only the state: the name the Widget
-- shows and the wait's desk, channel and timeout are as much "who answers"
-- as the holder is. A Member may hold a Conversation only in their own name;
-- clearing the holder (a release) and assigning a wait to a colleague are
-- the two writes that name someone else or nobody.
create or replace function private.guard_conversation_operator_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.operator_state is not distinct from old.operator_state
    and new.operator_member_id is not distinct from old.operator_member_id
    and new.operator_name is not distinct from old.operator_name
    and new.operator_held_at is not distinct from old.operator_held_at
    and new.waiting_since is not distinct from old.waiting_since
    and new.waiting_help_desk_id is not distinct from old.waiting_help_desk_id
    and new.waiting_channel_id is not distinct from old.waiting_channel_id
    and new.wait_timeout_minutes is not distinct from old.wait_timeout_minutes
    and new.assigned_member_id is not distinct from old.assigned_member_id
    and new.assigned_at is not distinct from old.assigned_at then
    return new;
  end if;
  -- Service role (the widget starting a wait), cron and migrations: no
  -- end-user identity to check, the operations layer already gated it.
  if (select auth.uid()) is null then
    return new;
  end if;
  if not private.may_answer_conversation(new.id) then
    raise exception 'Only a Member who may answer Visitors can take over or release a conversation'
      using errcode = 'insufficient_privilege';
  end if;
  if new.operator_member_id is distinct from old.operator_member_id
    and new.operator_member_id is not null
    and new.operator_member_id <> (select auth.uid()) then
    raise exception 'A Member can take a conversation over only as themselves'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

drop trigger if exists conversations_operator_change on public.conversations;
create trigger conversations_operator_change
before update of operator_state, operator_member_id, operator_name, operator_held_at,
  waiting_since, waiting_help_desk_id, waiting_channel_id, wait_timeout_minutes,
  assigned_member_id, assigned_at
on public.conversations
for each row execute function private.guard_conversation_operator_change();

-- A reply goes out under the holder's name only: the author is the caller,
-- the caller holds the Conversation, and the name is the one stored when
-- they took it over. A system line ("Dana joined") needs only the caller.
drop policy if exists "operators write operator messages" on public.messages;
create policy "operators write operator messages" on public.messages
  for insert with check (
    role in ('operator', 'system')
    and author_member_id = (select auth.uid())
    and jsonb_array_length(deferred_effects) = 0
    and private.may_answer_conversation(conversation_id)
    and (
      role = 'system'
      or exists (
        select 1 from public.conversations c
        where c.id = conversation_id
          and c.operator_state = 'held'
          and c.operator_member_id = (select auth.uid())
          and c.operator_name is not distinct from author_name
      )
    )
  );
