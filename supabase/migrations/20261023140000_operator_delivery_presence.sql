-- A console heartbeat renews only a live lease. It never revives explicit Away.
create function public.renew_operator_presence(p_org uuid,p_member uuid,p_now timestamptz) returns boolean
language plpgsql security invoker set search_path = public,pg_temp as $$
declare affected integer;
begin
 update public.operator_presence set updated_at=p_now where organization_id=p_org and member_id=p_member
 and status='available' and updated_at>p_now-interval '2 minutes';
 get diagnostics affected=row_count;
 return affected>0;
end;
$$;
revoke all on function public.renew_operator_presence(uuid,uuid,timestamptz) from public,anon;
grant execute on function public.renew_operator_presence(uuid,uuid,timestamptz) to authenticated,service_role;

-- The existing Member notification inbox also accepts Conversation targets.
alter table public.member_notifications alter column project_id drop not null;
alter table public.member_notifications alter column task_id drop not null;
alter table public.member_notifications add column conversation_id text references public.conversations(id) on delete cascade;
create index member_notifications_conversation_idx on public.member_notifications(conversation_id);
alter table public.member_notifications drop constraint member_notifications_kind_check;
alter table public.member_notifications add constraint member_notifications_kind_check check(kind in ('assigned','mentioned','commented','status_changed','conversation_assigned'));
alter table public.member_notifications add constraint member_notifications_target_check check(
 (kind='conversation_assigned' and conversation_id is not null and project_id is null and task_id is null and comment_id is null)
 or (kind<>'conversation_assigned' and conversation_id is null and project_id is not null and task_id is not null)
);
create function private.notify_operator_assignment() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare org uuid;
begin
 if new.operator_state='waiting' and new.assigned_member_id is not null
 and (old.assigned_member_id is distinct from new.assigned_member_id or old.assigned_at is distinct from new.assigned_at) then
  select organization_id into org from public.assistants where id=new.assistant_id;
  if exists(select 1 from public.organization_members where organization_id=org and user_id=new.assigned_member_id) then
   insert into public.member_notifications(id,organization_id,recipient_id,kind,conversation_id,created_at)
   values(gen_random_uuid()::text,org,new.assigned_member_id,'conversation_assigned',new.id,new.assigned_at)
   on conflict(id) do nothing;
  end if;
 end if;
 return new;
end;
$$;
revoke all on function private.notify_operator_assignment() from public,anon,authenticated;
create trigger notify_operator_assignment after update of assigned_member_id,assigned_at on public.conversations for each row execute function private.notify_operator_assignment();

-- Serialize assignments to one Member across different Conversations. A per-row
-- compare-and-set alone cannot protect the Member's final capacity slot.
create index conversations_held_operator_idx on public.conversations(operator_member_id,assistant_id) where operator_state='held';
create function private.guard_operator_assignment() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare org uuid; capacity_limit integer; held_count integer; at timestamptz;
begin
 if new.operator_state<>'waiting' or new.assigned_member_id is null then return new; end if;
 if old.assigned_member_id is not distinct from new.assigned_member_id and old.assigned_at is not distinct from new.assigned_at and old.operator_state='waiting' then return new; end if;
 select organization_id into org from public.assistants where id=new.assistant_id;
 perform pg_advisory_xact_lock(hashtextextended(org::text||':'||new.assigned_member_id::text,0));
 at:=clock_timestamp();
 select o.capacity into capacity_limit from public.help_desk_operators o
 join public.organization_members m on m.organization_id=o.organization_id and m.user_id=o.member_id
 join public.operator_presence p on p.organization_id=o.organization_id and p.member_id=o.member_id
 where o.organization_id=org and o.help_desk_id=new.waiting_help_desk_id and o.member_id=new.assigned_member_id
 and m.role in ('owner','admin','editor','support_agent') and p.status='available' and p.updated_at>at-interval '2 minutes';
 if capacity_limit is null or new.waiting_since is null or new.waiting_since+coalesce(new.wait_timeout_minutes,5)*interval '1 minute'<=at then return null; end if;
 select count(*) into held_count from public.conversations c join public.assistants a on a.id=c.assistant_id
 where a.organization_id=org and ((c.operator_state='held' and c.operator_member_id=new.assigned_member_id)
 or (c.operator_state='waiting' and c.assigned_member_id=new.assigned_member_id and c.waiting_since+coalesce(c.wait_timeout_minutes,5)*interval '1 minute'>at));
 if held_count>=capacity_limit then return null; end if;
 return new;
end;
$$;
revoke all on function private.guard_operator_assignment() from public,anon,authenticated;
create trigger guard_operator_assignment before update of assigned_member_id,assigned_at,operator_state on public.conversations for each row execute function private.guard_operator_assignment();
