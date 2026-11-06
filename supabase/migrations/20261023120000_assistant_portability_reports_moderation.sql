-- Post-commit answer scoring uses the existing durable worker ledger.
alter table public.background_jobs drop constraint if exists background_jobs_kind_check;
alter table public.background_jobs add constraint background_jobs_kind_check check(kind in (
 'ingest_source','graph_sync_concept','draft_improvement_proposal','draft_goal_proposal',
 'promote_memories','distill_agent_memory','sync_entity_records','sync_application_import',
 'deliver_review_request','resume_reviewed_conversation','resume_webhook_conversation',
 'answer_slack_mention','extract_document_memories','deliver_outbound_webhook','score_assistant_answer'
));
-- A resolved daily flag stays resolved even if another answer flags that day.
create unique index alerts_answer_moderation_day_idx on public.alerts(organization_id,source_key)
where source_key like 'answer-moderation:%';
create function public.record_message_moderation(p_organization_id uuid,p_message_id text,p_check jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare msg public.messages; conv public.conversations; assistant_org uuid; checks jsonb; source_key text;
begin
  select * into msg from public.messages where id=p_message_id and role='assistant' for update;
  select * into conv from public.conversations where id=msg.conversation_id and teammate_id is null;
  select organization_id into assistant_org from public.assistants where id=conv.assistant_id;
  if msg.id is null or assistant_org is distinct from p_organization_id then raise exception 'Assistant message not found' using errcode='42501'; end if;
  if p_check->>'type' is distinct from 'moderation' or p_check->>'target' is distinct from 'answer' or nullif(p_check->>'id','') is null then raise exception 'Invalid answer moderation result' using errcode='22023'; end if;
  select coalesce(jsonb_agg(item),'[]'::jsonb) into checks from jsonb_array_elements(coalesce(msg.trace->'guardrails','[]'::jsonb)) item
    where not (item->>'id'=p_check->>'id' and coalesce(item->>'target','visitor')='answer');
  update public.messages set trace=jsonb_set(coalesce(msg.trace,'{"steps":[],"searchCount":0}'::jsonb),'{guardrails}',checks || jsonb_build_array(p_check)) where id=msg.id;
  if coalesce((p_check->>'flagged')::boolean,false) then
    update public.conversations set metadata=coalesce(metadata,'{}'::jsonb) || '{"flaggedAnswer":true}'::jsonb where id=conv.id;
    source_key := 'answer-moderation:' || conv.assistant_id || ':' || (msg.created_at at time zone 'UTC')::date::text;
    insert into public.alerts(id,organization_id,type,title,detail,source_key)
    values(gen_random_uuid()::text,p_organization_id,'system','Assistant answer flagged','Review the answer in /inbox?conversationId=' || conv.id,source_key) on conflict do nothing;
  end if;
end $$;
revoke all on function public.record_message_moderation(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_message_moderation(uuid,text,jsonb) to service_role;

create function public.get_flagged_inbox_page(p_organization_id uuid,p_query jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(page)),'[]'::jsonb) from public.get_inbox_page(
  p_organization_id=>p_organization_id, p_limit=>(p_query->>'p_limit')::integer,
  p_cursor_updated_at=>(p_query->>'p_cursor_updated_at')::timestamptz,p_cursor_id=>p_query->>'p_cursor_id',
  p_search=>p_query->>'p_search',p_user_info=>p_query->>'p_user_info',p_location=>p_query->>'p_location',
  p_city=>p_query->>'p_city',p_role=>p_query->>'p_role',p_from=>(p_query->>'p_from')::date,p_to=>(p_query->>'p_to')::date,
  p_assistant_id=>p_query->>'p_assistant_id',p_language=>p_query->>'p_language',p_workflow=>p_query->>'p_workflow',
  p_conversation_ids=>array(select c.id from public.conversations c join public.assistants a on a.id=c.assistant_id
    where a.organization_id=p_organization_id and c.metadata @> '{"flaggedAnswer":true}'::jsonb
      and (jsonb_typeof(p_query->'p_conversation_ids') is distinct from 'array' or c.id in (select jsonb_array_elements_text(case when jsonb_typeof(p_query->'p_conversation_ids')='array' then p_query->'p_conversation_ids' else '[]'::jsonb end)))),
  p_feedback=>p_query->>'p_feedback',p_escalation=>p_query->>'p_escalation',p_staff=>p_query->>'p_staff'
 ) page;
$$;
revoke all on function public.get_flagged_inbox_page(uuid,jsonb) from public,anon;
grant execute on function public.get_flagged_inbox_page(uuid,jsonb) to authenticated,service_role;

create index messages_moderation_window_idx on public.messages(created_at,conversation_id)
where role='assistant' and trace ? 'guardrails';
create function public.get_moderation_counts(p_organization_id uuid,p_from timestamptz,p_to timestamptz,p_assistant_id text default null) returns jsonb
language sql stable security invoker set search_path='' as $$
with checks as (
 select m.id,
  exists(select 1 from jsonb_array_elements(m.trace->'guardrails') g where g->>'type'='moderation' and g->>'flagged'='true' and coalesce(g->>'target','visitor')='visitor') as visitor_flag,
  exists(select 1 from jsonb_array_elements(m.trace->'guardrails') g where g->>'type'='moderation' and g->>'flagged'='true' and g->>'target'='answer') as answer_flag
 from public.messages m join public.conversations c on c.id=m.conversation_id join public.assistants a on a.id=c.assistant_id
 where a.organization_id=p_organization_id and (p_assistant_id is null or a.id=p_assistant_id)
  and m.created_at>=p_from and m.created_at<p_to and m.role='assistant' and m.trace ? 'guardrails'
  and c.teammate_id is null and c.subject_type<>'member'
)
select jsonb_build_object('visitors',count(*) filter(where visitor_flag),'answers',count(*) filter(where answer_flag)) from checks;
$$;
revoke all on function public.get_moderation_counts(uuid,timestamptz,timestamptz,text) from public,anon;
grant execute on function public.get_moderation_counts(uuid,timestamptz,timestamptz,text) to authenticated,service_role;

create table public.export_schedules (
 id text primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null, kind text not null check(kind in ('insights_overview','insights_datapoints','insights_languages')),
 format text not null check(format in ('csv','json','xlsx')), filters jsonb not null default '{}', cadence jsonb not null,
 hour integer not null check(hour between 0 and 23), enabled boolean not null default true,
 recipient_member_ids uuid[] not null default '{}', created_by uuid references auth.users(id) on delete set null,
 last_slot_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(cardinality(recipient_member_ids)<=100), check(not enabled or cardinality(recipient_member_ids)>0),
 check(coalesce((cadence->>'kind'='weekly' and (cadence->>'weekday')::integer between 0 and 6) or (cadence->>'kind'='monthly' and (cadence->>'day')::integer between 1 and 31),false))
);
create index export_schedules_org_idx on public.export_schedules(organization_id);
create index export_schedules_creator_idx on public.export_schedules(created_by);
alter table public.export_schedules enable row level security;
create policy export_schedules_read on public.export_schedules for select to authenticated using(private.is_org_member(organization_id));
create policy export_schedules_insert on public.export_schedules for insert to authenticated with check(private.has_org_role(organization_id,2));
create policy export_schedules_update on public.export_schedules for update to authenticated using(private.has_org_role(organization_id,2)) with check(private.has_org_role(organization_id,2));
create policy export_schedules_delete on public.export_schedules for delete to authenticated using(private.has_org_role(organization_id,2));
grant select,insert,update,delete on public.export_schedules to authenticated;
grant all on public.export_schedules to service_role;
create function private.validate_export_recipients() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if cardinality(new.recipient_member_ids) <> (select count(*) from public.organization_members where organization_id=new.organization_id and user_id=any(new.recipient_member_ids)) then raise exception 'Export recipients must be Organization Members' using errcode='23514'; end if;
 return new;
end $$;
create trigger export_recipients_members before insert or update of recipient_member_ids,organization_id on public.export_schedules for each row execute function private.validate_export_recipients();
create function private.prune_export_recipients() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.export_schedules set recipient_member_ids=array_remove(recipient_member_ids,old.user_id),
 enabled=enabled and cardinality(array_remove(recipient_member_ids,old.user_id))>0,updated_at=now()
 where organization_id=old.organization_id and old.user_id=any(recipient_member_ids);
 return old;
end $$;
create trigger export_recipients_offboarding after delete on public.organization_members for each row execute function private.prune_export_recipients();

create function private.export_schedule_slot(p_cadence jsonb,p_hour integer,p_now timestamptz) returns timestamptz
language plpgsql immutable set search_path='' as $$
declare clock timestamp := p_now at time zone 'UTC'; slot timestamp; month_start timestamp; desired_day integer;
begin
 if p_cadence->>'kind'='weekly' then
  slot := date_trunc('day',clock)-((extract(dow from clock)::integer-(p_cadence->>'weekday')::integer+7)%7)*interval '1 day'+p_hour*interval '1 hour';
  if slot>clock then slot:=slot-interval '7 days'; end if;
 else
  month_start:=date_trunc('month',clock); desired_day:=(p_cadence->>'day')::integer;
  slot:=month_start+(least(desired_day,extract(day from month_start+interval '1 month'-interval '1 day')::integer)-1)*interval '1 day'+p_hour*interval '1 hour';
  if slot>clock then
   month_start:=month_start-interval '1 month';
   slot:=month_start+(least(desired_day,extract(day from month_start+interval '1 month'-interval '1 day')::integer)-1)*interval '1 day'+p_hour*interval '1 hour';
  end if;
 end if;
 return slot at time zone 'UTC';
end $$;
create function public.queue_due_export_schedules(p_now timestamptz,p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare schedule record; first_day date; final_day date; queued integer:=0; inserted integer;
begin
 for schedule in select s.*,private.export_schedule_slot(s.cadence,s.hour,p_now) as slot from public.export_schedules s
  where s.enabled and private.export_schedule_slot(s.cadence,s.hour,p_now)>=s.created_at
   and (s.last_slot_at is null or s.last_slot_at<private.export_schedule_slot(s.cadence,s.hour,p_now))
  order by s.last_slot_at nulls first,s.id limit greatest(1,least(p_limit,100)) for update of s skip locked
 loop
  if schedule.cadence->>'kind'='weekly' then first_day:=(schedule.slot at time zone 'UTC')::date-7; final_day:=(schedule.slot at time zone 'UTC')::date-1;
  else first_day:=(date_trunc('month',schedule.slot at time zone 'UTC')-interval '1 month')::date; final_day:=(date_trunc('month',schedule.slot at time zone 'UTC')-interval '1 day')::date; end if;
  insert into public.export_jobs(id,organization_id,kind,format,params)
  values('export-schedule:'||schedule.id||':'||schedule.slot::text,schedule.organization_id,schedule.kind,schedule.format,
   schedule.filters || jsonb_build_object('from',first_day::text,'to',final_day::text,'name',schedule.name,'scheduleId',schedule.id,'scheduleSlot',schedule.slot)) on conflict(id) do nothing;
  get diagnostics inserted=row_count; queued:=queued+inserted;
  update public.export_schedules set last_slot_at=schedule.slot where id=schedule.id and last_slot_at is not distinct from schedule.last_slot_at;
 end loop;
 return queued;
end $$;
revoke all on function public.queue_due_export_schedules(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.queue_due_export_schedules(timestamptz,integer) to service_role;

-- Ready mail is an outbox entry committed with the artifact's completed state.
alter table public.background_jobs drop constraint background_jobs_kind_check;
alter table public.background_jobs add constraint background_jobs_kind_check check(kind in (
 'ingest_source','graph_sync_concept','draft_improvement_proposal','draft_goal_proposal',
 'promote_memories','distill_agent_memory','sync_entity_records','sync_application_import',
 'deliver_review_request','resume_reviewed_conversation','resume_webhook_conversation',
 'answer_slack_mention','extract_document_memories','deliver_outbound_webhook','score_assistant_answer','notify_export_ready'
));
create function private.queue_export_ready_mail() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='done' and old.status is distinct from 'done' and new.storage_path is not null and nullif(new.params->>'scheduleId','') is not null then
  insert into public.background_jobs(id,organization_id,kind,payload,max_attempts)
  values('export-ready:'||new.id,new.organization_id,'notify_export_ready',jsonb_build_object('jobId',new.id),5) on conflict(id) do nothing;
 end if;
 return new;
end $$;
create trigger export_ready_mail after update of status on public.export_jobs for each row execute function private.queue_export_ready_mail();
