-- Outbound subscriptions are separate from the Flow's HTTP Webhook callback gate.
create table public.outbound_webhook_subscriptions (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  url text not null,
  event_types text[] not null,
  paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(event_types) > 0),
  check (event_types <@ array['conversation.escalated','improvement.created','feedback.negative','alert.raised','alert.resolved','publication.created']::text[])
);
create index outbound_webhook_subscriptions_org_idx on public.outbound_webhook_subscriptions(organization_id);

-- Secrets never appear in an ordinary subscription read, including SELECT *.
create table public.outbound_webhook_secrets (
  id text primary key references public.outbound_webhook_subscriptions(id) on delete cascade,
  encrypted_secret text not null
);
create table public.webhook_deliveries (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id text not null references public.outbound_webhook_subscriptions(id) on delete cascade,
  event jsonb not null,
  attempts integer not null default 0,
  status text not null default 'queued' check (status in ('queued','delivered','failed')),
  last_status_code integer,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  check ((event->>'organizationId')::uuid = organization_id)
);
create unique index webhook_deliveries_event_idx on public.webhook_deliveries(subscription_id, (event->>'id'));
create index webhook_deliveries_log_idx on public.webhook_deliveries(organization_id, subscription_id, created_at desc);

alter table public.outbound_webhook_subscriptions enable row level security;
alter table public.outbound_webhook_secrets enable row level security;
alter table public.webhook_deliveries enable row level security;
revoke all on public.outbound_webhook_subscriptions, public.webhook_deliveries from anon, authenticated;
grant select, delete on public.outbound_webhook_subscriptions to authenticated;
grant update(name, url, event_types, paused, updated_at) on public.outbound_webhook_subscriptions to authenticated;
grant select on public.webhook_deliveries to authenticated;
grant all on public.outbound_webhook_subscriptions, public.outbound_webhook_secrets, public.webhook_deliveries to service_role;
revoke all on public.outbound_webhook_secrets from anon, authenticated;
create policy "admins read outbound subscriptions" on public.outbound_webhook_subscriptions for select
  using (private.has_org_role(organization_id, 3));
create policy "admins update outbound subscriptions" on public.outbound_webhook_subscriptions for update
  using (private.has_org_role(organization_id, 3)) with check (private.has_org_role(organization_id, 3));
create policy "admins delete outbound subscriptions" on public.outbound_webhook_subscriptions for delete
  using (private.has_org_role(organization_id, 3));
create policy "admins read webhook deliveries" on public.webhook_deliveries for select
  using (private.has_org_role(organization_id, 3));

create function public.create_outbound_webhook_subscription(
  p_id text, p_organization_id uuid, p_name text, p_url text, p_event_types text[], p_encrypted_secret text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result public.outbound_webhook_subscriptions;
begin
  if auth.role() is distinct from 'service_role' and not coalesce(private.has_org_role(p_organization_id, 3), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  insert into public.outbound_webhook_subscriptions(id, organization_id, name, url, event_types)
    values(p_id, p_organization_id, p_name, p_url, p_event_types) returning * into result;
  insert into public.outbound_webhook_secrets(id, encrypted_secret) values(p_id, p_encrypted_secret);
  return to_jsonb(result);
end $$;
revoke all on function public.create_outbound_webhook_subscription(text,uuid,text,text,text[],text) from public;
grant execute on function public.create_outbound_webhook_subscription(text,uuid,text,text,text[],text) to authenticated, service_role;

alter table public.background_jobs drop constraint if exists background_jobs_kind_check;
alter table public.background_jobs add constraint background_jobs_kind_check check (kind in (
  'ingest_source','graph_sync_concept','draft_improvement_proposal','draft_goal_proposal',
  'promote_memories','distill_agent_memory','sync_entity_records','sync_application_import',
  'deliver_review_request','resume_reviewed_conversation','resume_webhook_conversation',
  'answer_slack_mention','extract_document_memories','deliver_outbound_webhook'
));

-- Triggers and the Send test event operation use one atomic enqueue path.
create function private.queue_outbound_webhook_event(p_event jsonb, p_subscription_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare subscription public.outbound_webhook_subscriptions; delivery_id text;
begin
  for subscription in select * from public.outbound_webhook_subscriptions
    where organization_id = (p_event->>'organizationId')::uuid and not paused
      and case when p_subscription_id is null then event_types @> array[p_event->>'type'] else id = p_subscription_id end
  loop
    delivery_id := null;
    insert into public.webhook_deliveries(id, organization_id, subscription_id, event)
      values(gen_random_uuid()::text, subscription.organization_id, subscription.id, p_event)
      on conflict do nothing returning id into delivery_id;
    if delivery_id is not null then
      insert into public.background_jobs(id, organization_id, kind, payload, max_attempts)
        values('outbound-webhook:' || delivery_id, subscription.organization_id, 'deliver_outbound_webhook', jsonb_build_object('deliveryId', delivery_id), 40);
    end if;
  end loop;
end $$;
revoke all on function private.queue_outbound_webhook_event(jsonb,text) from public, anon, authenticated;

create function public.queue_outbound_webhook_event(p_event jsonb, p_subscription_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' and not coalesce(private.has_org_role((p_event->>'organizationId')::uuid, 3), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  perform private.queue_outbound_webhook_event(p_event, p_subscription_id);
end $$;
revoke all on function public.queue_outbound_webhook_event(jsonb,text) from public;
grant execute on function public.queue_outbound_webhook_event(jsonb,text) to authenticated, service_role;

create function public.record_webhook_delivery_attempt(
  p_delivery_id text, p_job_id text, p_lease_token uuid, p_now timestamptz, p_status text, p_status_code integer
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden' using errcode = '42501'; end if;
  update public.webhook_deliveries d set attempts = j.attempts, status = p_status,
    last_status_code = p_status_code, last_attempt_at = p_now
    from public.background_jobs j where d.id = p_delivery_id and j.id = p_job_id
      and j.payload->>'deliveryId' = d.id and j.organization_id = d.organization_id
      and j.lease_token = p_lease_token and j.status = 'running';
  return found;
end $$;
revoke all on function public.record_webhook_delivery_attempt(text,text,uuid,timestamptz,text,integer) from public;
grant execute on function public.record_webhook_delivery_attempt(text,text,uuid,timestamptz,text,integer) to service_role;

-- Producer provenance is explicit; message-derived titles never leave the Inbox.
alter table public.improvements
  add column webhook_source text not null default 'manual' check (webhook_source in ('flow_action','escalation','manual','system')),
  add column webhook_assistant_id text references public.assistants(id) on delete set null,
  add column webhook_title text;
create index improvements_webhook_assistant_id_idx on public.improvements (webhook_assistant_id);

create function private.emit_outbound_webhook_event(p_org uuid, p_type text, p_data jsonb)
returns void language sql security definer set search_path = '' as $$
  select private.queue_outbound_webhook_event(jsonb_build_object(
    'id', gen_random_uuid()::text, 'type', p_type, 'createdAt', now(), 'organizationId', p_org, 'data', p_data
  ));
$$;
revoke all on function private.emit_outbound_webhook_event(uuid,text,jsonb) from public, anon, authenticated;

-- The outbox and the source write commit together, including writes outside ops.
create function private.emit_conversation_escalated() returns trigger
language plpgsql security definer set search_path = '' as $$
declare assistant public.assistants; desk public.help_desks; channel public.support_channels;
begin
  if coalesce(new.metadata->'escalated' = 'true'::jsonb, false) and not coalesce(old.metadata->'escalated' = 'true'::jsonb, false) then
    select * into assistant from public.assistants where id = new.assistant_id;
    select * into desk from public.help_desks where id = new.metadata->>'escalationHelpDeskId' and organization_id = assistant.organization_id;
    if assistant.id is null or desk.id is null then return new; end if;
    select * into channel from public.support_channels where id = new.metadata->>'escalationChannelId' and help_desk_id = desk.id;
    perform private.emit_outbound_webhook_event(assistant.organization_id, 'conversation.escalated', jsonb_build_object(
      'conversationId', new.id, 'conversationName', 'Conversation ' || new.id,
      'assistantId', assistant.id, 'assistantName', assistant.title,
      'helpDeskId', desk.id, 'helpDeskName', desk.name,
      'channelId', channel.id, 'channelName', channel.name,
      'inboxUrl', coalesce(new.metadata->>'escalationInboxUrl', '/inbox?conversation=' || new.id)
    ));
  end if;
  return new;
end $$;
create trigger outbound_conversation_escalated after update of metadata on public.conversations
  for each row execute function private.emit_conversation_escalated();

create function private.emit_improvement_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.emit_outbound_webhook_event(new.organization_id, 'improvement.created', jsonb_build_object(
    'id', new.id, 'title', coalesce(new.webhook_title, new.title), 'source', new.webhook_source,
    'assistantId', (select id from public.assistants where id = new.webhook_assistant_id and organization_id = new.organization_id)
  ));
  return new;
end $$;
create trigger outbound_improvement_created after insert on public.improvements
  for each row execute function private.emit_improvement_created();

create function private.emit_feedback_negative() returns trigger
language plpgsql security definer set search_path = '' as $$
declare assistant public.assistants;
begin
  if new.role = 'assistant' and new.feedback = -1 and (tg_op = 'INSERT' or old.feedback is distinct from -1) then
    select a.* into assistant from public.assistants a join public.conversations c on c.assistant_id = a.id where c.id = new.conversation_id;
    if assistant.id is not null then
      perform private.emit_outbound_webhook_event(assistant.organization_id, 'feedback.negative', jsonb_build_object(
        'conversationId', new.conversation_id, 'messageId', new.id, 'assistantId', assistant.id
      ));
    end if;
  end if;
  return new;
end $$;
create trigger outbound_feedback_negative after insert or update of feedback on public.messages
  for each row execute function private.emit_feedback_negative();

create function private.emit_alert_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    perform private.emit_outbound_webhook_event(new.organization_id, case when new.status = 'active' then 'alert.raised' else 'alert.resolved' end,
      jsonb_build_object('id', new.id, 'type', new.type, 'title', new.title));
  end if;
  return new;
end $$;
create trigger outbound_alert_changed after insert or update of status on public.alerts
  for each row execute function private.emit_alert_changed();

create function private.emit_publication_created() returns trigger
language plpgsql security definer set search_path = '' as $$
declare org uuid;
begin
  select organization_id into org from public.assistants where id = new.assistant_id;
  perform private.emit_outbound_webhook_event(org, 'publication.created', jsonb_build_object(
    'assistantId', new.assistant_id, 'version', new.version, 'publishedBy', new.created_by
  ));
  return new;
end $$;
create trigger outbound_publication_created after insert on public.publications
  for each row execute function private.emit_publication_created();
