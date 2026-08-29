-- Incrementally maintained facet read model shared by Inbox and Insights.
-- Facet reads scale with distinct options, never with Conversation/Message
-- history, while reference counts make deletes and edits exact.
create table public.admin_read_facets (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facet text not null check (facet in (
    'location', 'city', 'role', 'language', 'workflow', 'insights_role'
  )),
  value text not null,
  refs bigint not null,
  primary key (organization_id, facet, value)
);

alter table public.admin_read_facets enable row level security;
create policy "members read admin facets" on public.admin_read_facets
  for select using (private.is_org_member(organization_id));
grant select on public.admin_read_facets to authenticated;

-- This marker is the membership set for the Insights role facet. It preserves
-- the product rule that internal and notification-only Conversations do not
-- create filter options, without recomputing that rule on every request.
create table public.insights_role_facet_members (
  conversation_id text primary key references public.conversations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role text not null
);
alter table public.insights_role_facet_members enable row level security;
create index insights_role_facet_members_organization_idx
  on public.insights_role_facet_members (organization_id);

create or replace function private.bump_admin_read_facet(
  p_organization_id uuid,
  p_facet text,
  p_value text,
  p_delta bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null or p_value is null or p_value = '' or p_delta = 0 then
    return;
  end if;

  insert into public.admin_read_facets (organization_id, facet, value, refs)
  values (p_organization_id, p_facet, p_value, p_delta)
  on conflict (organization_id, facet, value) do update
    set refs = public.admin_read_facets.refs + excluded.refs;

  delete from public.admin_read_facets
  where organization_id = p_organization_id
    and facet = p_facet
    and value = p_value
    and refs <= 0;
end;
$$;

create or replace function private.sync_insights_role_facet(p_conversation_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_organization_id uuid;
  old_role text;
  new_organization_id uuid;
  new_role text;
begin
  select organization_id, role
    into old_organization_id, old_role
  from public.insights_role_facet_members
  where conversation_id = p_conversation_id;

  select a.organization_id, c.metadata ->> 'userRole'
    into new_organization_id, new_role
  from public.conversations c
  join public.assistants a on a.id = c.assistant_id
  where c.id = p_conversation_id
    and c.subject_type <> 'member'
    and c.metadata ->> 'userRole' is not null
    and c.metadata ->> 'userRole' <> ''
    and (
      not exists (
        select 1 from public.messages m where m.conversation_id = c.id
      )
      or exists (
        select 1 from public.messages m
        where m.conversation_id = c.id and not m.proactive
      )
    );

  if old_organization_id is not distinct from new_organization_id
     and old_role is not distinct from new_role then
    return;
  end if;

  if old_organization_id is not null then
    perform private.bump_admin_read_facet(
      old_organization_id, 'insights_role', old_role, -1
    );
    delete from public.insights_role_facet_members
    where conversation_id = p_conversation_id;
  end if;

  if new_organization_id is not null then
    perform private.bump_admin_read_facet(
      new_organization_id, 'insights_role', new_role, 1
    );
    insert into public.insights_role_facet_members (
      conversation_id, organization_id, role
    ) values (p_conversation_id, new_organization_id, new_role)
    on conflict (conversation_id) do update
      set organization_id = excluded.organization_id,
          role = excluded.role;
  end if;
end;
$$;

create or replace function private.refresh_conversation_admin_facets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_organization_id uuid;
  new_organization_id uuid;
  workflow_contribution record;
begin
  if tg_op = 'UPDATE' then
    select organization_id into old_organization_id
    from public.assistants where id = old.assistant_id;
    perform private.bump_admin_read_facet(old_organization_id, 'location', old.metadata ->> 'location', -1);
    perform private.bump_admin_read_facet(old_organization_id, 'city', old.metadata ->> 'city', -1);
    perform private.bump_admin_read_facet(old_organization_id, 'role', old.metadata ->> 'userRole', -1);
    perform private.bump_admin_read_facet(old_organization_id, 'language', old.metadata ->> 'language', -1);
  end if;

  select organization_id into new_organization_id
  from public.assistants where id = new.assistant_id;
  perform private.bump_admin_read_facet(new_organization_id, 'location', new.metadata ->> 'location', 1);
  perform private.bump_admin_read_facet(new_organization_id, 'city', new.metadata ->> 'city', 1);
  perform private.bump_admin_read_facet(new_organization_id, 'role', new.metadata ->> 'userRole', 1);
  perform private.bump_admin_read_facet(new_organization_id, 'language', new.metadata ->> 'language', 1);

  if tg_op = 'UPDATE' and old.assistant_id is distinct from new.assistant_id then
    for workflow_contribution in
      select flow_name as value, count(*)::bigint as refs
      from public.messages
      where conversation_id = new.id and flow_name is not null and flow_name <> ''
      group by flow_name
    loop
      perform private.bump_admin_read_facet(
        old_organization_id,
        'workflow',
        workflow_contribution.value,
        -workflow_contribution.refs
      );
      perform private.bump_admin_read_facet(
        new_organization_id,
        'workflow',
        workflow_contribution.value,
        workflow_contribution.refs
      );
    end loop;
  end if;

  perform private.sync_insights_role_facet(new.id);
  return new;
end;
$$;

create or replace function private.remove_conversation_admin_facets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_organization_id uuid;
  insight_organization_id uuid;
  insight_role text;
  workflow_contribution record;
begin
  select organization_id into old_organization_id
  from public.assistants where id = old.assistant_id;
  perform private.bump_admin_read_facet(old_organization_id, 'location', old.metadata ->> 'location', -1);
  perform private.bump_admin_read_facet(old_organization_id, 'city', old.metadata ->> 'city', -1);
  perform private.bump_admin_read_facet(old_organization_id, 'role', old.metadata ->> 'userRole', -1);
  perform private.bump_admin_read_facet(old_organization_id, 'language', old.metadata ->> 'language', -1);

  -- Remove workflow memberships before the Conversation disappears. Its
  -- cascaded Message deletes cannot resolve tenant ownership afterwards.
  for workflow_contribution in
    select flow_name as value, count(*)::bigint as refs
    from public.messages
    where conversation_id = old.id and flow_name is not null and flow_name <> ''
    group by flow_name
  loop
    perform private.bump_admin_read_facet(
      old_organization_id,
      'workflow',
      workflow_contribution.value,
      -workflow_contribution.refs
    );
  end loop;

  select organization_id, role into insight_organization_id, insight_role
  from public.insights_role_facet_members
  where conversation_id = old.id;
  if insight_organization_id is not null then
    perform private.bump_admin_read_facet(
      insight_organization_id, 'insights_role', insight_role, -1
    );
    delete from public.insights_role_facet_members where conversation_id = old.id;
  end if;
  return old;
end;
$$;

create or replace function private.refresh_message_admin_facets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_organization_id uuid;
  new_organization_id uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select a.organization_id into old_organization_id
    from public.conversations c
    join public.assistants a on a.id = c.assistant_id
    where c.id = old.conversation_id;
    perform private.bump_admin_read_facet(
      old_organization_id, 'workflow', old.flow_name, -1
    );
    perform private.sync_insights_role_facet(old.conversation_id);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select a.organization_id into new_organization_id
    from public.conversations c
    join public.assistants a on a.id = c.assistant_id
    where c.id = new.conversation_id;
    perform private.bump_admin_read_facet(
      new_organization_id, 'workflow', new.flow_name, 1
    );
    if tg_op = 'INSERT' or new.conversation_id is distinct from old.conversation_id then
      perform private.sync_insights_role_facet(new.conversation_id);
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- An Assistant normally never changes tenant, but deleting one is ordinary.
-- The parent row is no longer visible by the time FK cascades reach child-row
-- triggers, so move/remove its aggregate contributions while it is still
-- available rather than leaving stale options behind.
create or replace function private.refresh_assistant_admin_facets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  contribution record;
begin
  for contribution in
    with facet_rows as (
      select 'location'::text as facet, c.metadata ->> 'location' as value
      from public.conversations c where c.assistant_id = old.id
      union all
      select 'city', c.metadata ->> 'city'
      from public.conversations c where c.assistant_id = old.id
      union all
      select 'role', c.metadata ->> 'userRole'
      from public.conversations c where c.assistant_id = old.id
      union all
      select 'language', c.metadata ->> 'language'
      from public.conversations c where c.assistant_id = old.id
      union all
      select 'workflow', m.flow_name
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where c.assistant_id = old.id
    )
    select facet, value, count(*)::bigint as refs
    from facet_rows
    where value is not null and value <> ''
    group by facet, value
  loop
    perform private.bump_admin_read_facet(
      old.organization_id,
      contribution.facet,
      contribution.value,
      -contribution.refs
    );
    if tg_op = 'UPDATE' then
      perform private.bump_admin_read_facet(
        new.organization_id,
        contribution.facet,
        contribution.value,
        contribution.refs
      );
    end if;
  end loop;

  for contribution in
    select f.role as value, count(*)::bigint as refs
    from public.insights_role_facet_members f
    join public.conversations c on c.id = f.conversation_id
    where c.assistant_id = old.id
    group by f.role
  loop
    perform private.bump_admin_read_facet(
      old.organization_id,
      'insights_role',
      contribution.value,
      -contribution.refs
    );
    if tg_op = 'UPDATE' then
      perform private.bump_admin_read_facet(
        new.organization_id,
        'insights_role',
        contribution.value,
        contribution.refs
      );
    end if;
  end loop;

  if tg_op = 'DELETE' then
    delete from public.insights_role_facet_members f
    using public.conversations c
    where f.conversation_id = c.id and c.assistant_id = old.id;
    return old;
  end if;

  update public.insights_role_facet_members f
  set organization_id = new.organization_id
  from public.conversations c
  where f.conversation_id = c.id and c.assistant_id = old.id;
  return new;
end;
$$;

drop trigger if exists conversations_admin_facets_write on public.conversations;
create trigger conversations_admin_facets_write
after insert or update of assistant_id, subject_type, metadata on public.conversations
for each row execute function private.refresh_conversation_admin_facets();

drop trigger if exists conversations_admin_facets_delete on public.conversations;
create trigger conversations_admin_facets_delete
before delete on public.conversations
for each row execute function private.remove_conversation_admin_facets();

drop trigger if exists messages_admin_facets_write on public.messages;
create trigger messages_admin_facets_write
after insert or delete or update of conversation_id, flow_name, proactive on public.messages
for each row execute function private.refresh_message_admin_facets();

drop trigger if exists assistants_admin_facets_delete on public.assistants;
create trigger assistants_admin_facets_delete
before delete on public.assistants
for each row execute function private.refresh_assistant_admin_facets();

drop trigger if exists assistants_admin_facets_move on public.assistants;
create trigger assistants_admin_facets_move
before update of organization_id on public.assistants
for each row
when (old.organization_id is distinct from new.organization_id)
execute function private.refresh_assistant_admin_facets();

-- Backfill once. New writes stay O(1) through the triggers above.
with facet_rows as (
  select a.organization_id, 'location'::text as facet, c.metadata ->> 'location' as value
  from public.conversations c join public.assistants a on a.id = c.assistant_id
  union all
  select a.organization_id, 'city', c.metadata ->> 'city'
  from public.conversations c join public.assistants a on a.id = c.assistant_id
  union all
  select a.organization_id, 'role', c.metadata ->> 'userRole'
  from public.conversations c join public.assistants a on a.id = c.assistant_id
  union all
  select a.organization_id, 'language', c.metadata ->> 'language'
  from public.conversations c join public.assistants a on a.id = c.assistant_id
  union all
  select a.organization_id, 'workflow', m.flow_name
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  join public.assistants a on a.id = c.assistant_id
)
insert into public.admin_read_facets (organization_id, facet, value, refs)
select organization_id, facet, value, count(*)
from facet_rows
where value is not null and value <> ''
group by organization_id, facet, value;

insert into public.insights_role_facet_members (
  conversation_id, organization_id, role
)
select c.id, a.organization_id, c.metadata ->> 'userRole'
from public.conversations c
join public.assistants a on a.id = c.assistant_id
where c.subject_type <> 'member'
  and c.metadata ->> 'userRole' is not null
  and c.metadata ->> 'userRole' <> ''
  and (
    not exists (select 1 from public.messages m where m.conversation_id = c.id)
    or exists (
      select 1 from public.messages m
      where m.conversation_id = c.id and not m.proactive
    )
  );

insert into public.admin_read_facets (organization_id, facet, value, refs)
select organization_id, 'insights_role', role, count(*)
from public.insights_role_facet_members
group by organization_id, role;

-- Replace the historical distinct scans with direct reads of the small facet
-- table. The UI accepts arbitrary typed values; these are bounded suggestions,
-- so a malicious high-cardinality metadata field cannot create a huge payload.
create or replace function public.get_inbox_facets(p_organization_id uuid)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'locations', coalesce((select jsonb_agg(value order by value) from (select value from public.admin_read_facets where organization_id = p_organization_id and facet = 'location' and refs > 0 order by value limit 200) values_page), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(value order by value) from (select value from public.admin_read_facets where organization_id = p_organization_id and facet = 'city' and refs > 0 order by value limit 200) values_page), '[]'::jsonb),
    'roles', coalesce((select jsonb_agg(value order by value) from (select value from public.admin_read_facets where organization_id = p_organization_id and facet = 'role' and refs > 0 order by value limit 200) values_page), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(value order by value) from (select value from public.admin_read_facets where organization_id = p_organization_id and facet = 'language' and refs > 0 order by value limit 200) values_page), '[]'::jsonb),
    'workflows', coalesce((select jsonb_agg(value order by value) from (select value from public.admin_read_facets where organization_id = p_organization_id and facet = 'workflow' and refs > 0 order by value limit 200) values_page), '[]'::jsonb)
  );
$$;

revoke execute on function public.get_inbox_facets(uuid) from public, anon;
grant execute on function public.get_inbox_facets(uuid) to authenticated;
