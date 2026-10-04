-- Admitted Flow execution is protected separately from member-readable gate cards.
alter table public.assistants add column gate_admission_closed boolean not null default false;
alter table public.conversations add column gate_admission_closed boolean not null default false;
alter table public.assistants add column continuation_epoch bigint not null default 0;
alter table public.flows add column continuation_epoch bigint not null default 0;

-- A deletion fence stays closed, including writes through member RLS clients.
create function private.keep_flow_gate_admission_closed() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.gate_admission_closed := old.gate_admission_closed or new.gate_admission_closed;
  if new.gate_admission_closed is distinct from old.gate_admission_closed
    and current_user in ('anon', 'authenticated') then
    raise exception 'Only the runtime can close Flow gate admission' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
revoke all on function private.keep_flow_gate_admission_closed() from public, anon, authenticated;
create trigger keep_flow_gate_admission_closed before update of gate_admission_closed on public.assistants
for each row execute function private.keep_flow_gate_admission_closed();
create trigger keep_flow_gate_admission_closed before update of gate_admission_closed on public.conversations
for each row execute function private.keep_flow_gate_admission_closed();

create table public.flow_continuations (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assistant_id text not null references public.assistants(id) on delete cascade,
  conversation_id text not null references public.conversations(id) on delete cascade,
  flow_id text not null,
  gate_kind text not null check (gate_kind in ('review', 'webhook')),
  gate_id text not null,
  origin_request_id text not null,
  origin_status text check (origin_status in ('completed', 'failed')),
  snapshot jsonb not null,
  stopped_at timestamptz,
  stop_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(gate_kind, gate_id)
);
create index flow_continuations_org_idx on public.flow_continuations(organization_id);
create index flow_continuations_assistant_idx on public.flow_continuations(assistant_id);
create index flow_continuations_conversation_idx on public.flow_continuations(conversation_id);
create index flow_continuations_flow_idx on public.flow_continuations(flow_id);
alter table public.flow_continuations enable row level security;
revoke all on public.flow_continuations from public, anon, authenticated;
grant all on public.flow_continuations to service_role;

-- Trigger-only code: permitted Flow writes atomically stamp a permanent stop.
-- No direct member invocation and no user-controlled target argument.
create function private.stop_flow_continuations() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'DELETE' then new.continuation_epoch = old.continuation_epoch; end if;
  if tg_op = 'DELETE' or new.enabled = false then
    update public.flow_continuations set stopped_at = coalesce(stopped_at, now()),
      stop_reason = coalesce(stop_reason, case when tg_op = 'DELETE' then 'Flow deleted' else 'Flow disabled' end),
      updated_at = now() where flow_id = old.id;
    if tg_op <> 'DELETE' then new.continuation_epoch = old.continuation_epoch + 1; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.stop_flow_continuations() from public, anon, authenticated;
create trigger stop_flow_continuations before update or delete on public.flows
for each row execute function private.stop_flow_continuations();

create function private.stop_unpublished_continuations() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.assistants set continuation_epoch = continuation_epoch + 1 where id = old.assistant_id;
  update public.flow_continuations set stopped_at = coalesce(stopped_at, now()),
    stop_reason = coalesce(stop_reason, 'Assistant unpublished'), updated_at = now()
    where assistant_id = old.assistant_id;
  return old;
end $$;
revoke all on function private.stop_unpublished_continuations() from public, anon, authenticated;
create trigger stop_unpublished_continuations after delete on public.publications
for each row execute function private.stop_unpublished_continuations();

-- Gate and checkpoint become visible in one transaction. Locks serialize opening
-- against disable/delete/unpublish. A stop between admission and this pause is
-- detected even after re-enable or republish by the monotonically increasing epoch.
create function public.open_flow_gate(p_kind text, p_gate jsonb, p_continuation jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  a public.assistants; f public.flows; r public.review_requests; w public.webhook_subscriptions;
  c public.flow_continuations; stopped text; convo public.conversations;
begin
  select * into a from public.assistants where id = p_gate->>'assistant_id' for update;
  select * into f from public.flows where id = p_gate->>'flow_id' for update;
  if a.id is null or f.id is null or f.assistant_id <> a.id or a.organization_id::text <> p_gate->>'organization_id' then
    raise exception 'Flow continuation target is unavailable';
  end if;
  select * into convo from public.conversations where id = p_gate->>'conversation_id' for update;
  if a.gate_admission_closed or convo.id is null or convo.gate_admission_closed then
    raise exception 'Flow gate admission is closed for deletion';
  end if;
  if convo.assistant_id is distinct from a.id then raise exception 'Flow continuation Conversation does not belong to Assistant'; end if;
  if not f.enabled or a.continuation_epoch <> (p_continuation->'snapshot'->>'assistantEpoch')::bigint
    or f.continuation_epoch <> (p_continuation->'snapshot'->>'flowEpoch')::bigint then stopped = 'Execution stopped before pause'; end if;
  if p_continuation->'snapshot'->>'publicationId' is not null and not exists (
    select 1 from public.publications where id = p_continuation->'snapshot'->>'publicationId' and assistant_id = a.id
  ) then stopped = 'Assistant unpublished'; end if;
  if p_kind = 'review' then
    r := jsonb_populate_record(null::public.review_requests, p_gate);
    insert into public.review_requests(id, organization_id, assistant_id, conversation_id, flow_id, action_index,
      title, message, summary, channel, assignees, inputs, expires_at, halt_message, simulated)
    values(r.id, r.organization_id, r.assistant_id, r.conversation_id, r.flow_id, r.action_index,
      r.title, coalesce(r.message, ''), coalesce(r.summary, ''), r.channel, r.assignees, r.inputs, r.expires_at, r.halt_message, coalesce(r.simulated, false))
    returning * into r;
  elsif p_kind = 'webhook' then
    w := jsonb_populate_record(null::public.webhook_subscriptions, p_gate);
    insert into public.webhook_subscriptions(id, organization_id, assistant_id, conversation_id, flow_id, action_index,
      subscribe_method, subscribe_url, expires_at, halt_message, simulated)
    values(w.id, w.organization_id, w.assistant_id, w.conversation_id, w.flow_id, w.action_index,
      w.subscribe_method, w.subscribe_url, w.expires_at, w.halt_message, w.simulated) returning * into w;
  else raise exception 'Invalid gate kind'; end if;
  c := jsonb_populate_record(null::public.flow_continuations, p_continuation);
  insert into public.flow_continuations(id, organization_id, assistant_id, conversation_id, flow_id,
    gate_kind, gate_id, origin_request_id, snapshot, stopped_at, stop_reason)
  values(c.id, a.organization_id, a.id, p_gate->>'conversation_id', f.id, p_kind, p_gate->>'id',
    c.origin_request_id, c.snapshot, case when stopped is not null then now() end, stopped);
  if p_kind = 'review' then return to_jsonb(r); end if;
  return to_jsonb(w);
end $$;
revoke all on function public.open_flow_gate(text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.open_flow_gate(text,jsonb,jsonb) to service_role;

create function public.read_flow_continuation(p_id text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('continuation', to_jsonb(c), 'originStatus', coalesce(c.origin_status, t.status))
  from public.flow_continuations c left join public.conversation_turns t
    on t.conversation_id = c.conversation_id and t.request_id = c.origin_request_id
  where c.id = p_id
$$;
revoke all on function public.read_flow_continuation(text) from public, anon, authenticated;
grant execute on function public.read_flow_continuation(text) to service_role;

-- Channel approvals keep their actual owner instead of inventing a Conversation.
alter table public.action_approvals alter column conversation_id drop not null;
alter table public.action_approvals add column channel_id text references public.teammate_channels(id) on delete cascade;
create index action_approvals_channel_idx on public.action_approvals(channel_id);
alter table public.action_approvals add constraint action_approvals_one_target check (num_nonnulls(conversation_id, channel_id) = 1);
drop policy "members read action approvals" on public.action_approvals;
create policy "members read action approvals" on public.action_approvals for select to authenticated using (
  private.is_org_member(organization_id) and (
    channel_id is null or exists (
      select 1 from public.teammate_channels c where c.id = channel_id and c.organization_id = action_approvals.organization_id
      and (private.is_channel_member(c.id) or private.has_org_role(c.organization_id, 3))
    )
  )
);

-- Preserve the origin's terminal receipt beyond the seven-day claim retention.
-- Queue the existing resumptions in the SAME transaction as settlement or stop.
create function private.queue_flow_continuation(c public.flow_continuations) returns void
language plpgsql security definer set search_path = '' as $$
declare settled boolean; kind text; payload jsonb;
begin
  if c.origin_status is null then return; end if;
  if c.gate_kind = 'review' then
    select status <> 'pending' and resumed_at is null into settled from public.review_requests where id = c.gate_id;
    kind := 'resume_reviewed_conversation';
    payload := jsonb_build_object('reviewId', c.gate_id, 'organizationId', c.organization_id);
  else
    select status <> 'pending' and resumed_at is null into settled from public.webhook_subscriptions where id = c.gate_id;
    kind := 'resume_webhook_conversation';
    payload := jsonb_build_object('subscriptionId', c.gate_id, 'organizationId', c.organization_id);
  end if;
  if settled or c.stopped_at is not null then
    insert into public.background_jobs(id, organization_id, kind, payload, max_attempts)
    values(kind || ':' || c.gate_id, c.organization_id, kind, payload, 3) on conflict(id) do nothing;
  end if;
end $$;
revoke all on function private.queue_flow_continuation(public.flow_continuations) from public, anon, authenticated;

create function private.flow_continuation_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.queue_flow_continuation(new); return new;
end $$;
revoke all on function private.flow_continuation_changed() from public, anon, authenticated;
create trigger flow_continuation_changed after insert or update on public.flow_continuations
for each row execute function private.flow_continuation_changed();

create function private.flow_origin_finished() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('completed', 'failed') then
    update public.flow_continuations set origin_status = new.status,
      stopped_at = case when new.status = 'failed' then coalesce(stopped_at, now()) else stopped_at end,
      stop_reason = case when new.status = 'failed' then coalesce(stop_reason, 'Original turn failed') else stop_reason end,
      updated_at = now() where conversation_id = new.conversation_id and origin_request_id = new.request_id;
  end if; return new;
end $$;
revoke all on function private.flow_origin_finished() from public, anon, authenticated;
create trigger flow_origin_finished after update of status on public.conversation_turns
for each row execute function private.flow_origin_finished();

create function private.flow_gate_settled() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c public.flow_continuations;
begin
  select * into c from public.flow_continuations where gate_id = new.id
    and gate_kind = case when tg_table_name = 'review_requests' then 'review' else 'webhook' end for update;
  if c.id is not null then perform private.queue_flow_continuation(c); end if;
  return new;
end $$;
revoke all on function private.flow_gate_settled() from public, anon, authenticated;
create trigger review_continuation_settled after update of status on public.review_requests
for each row execute function private.flow_gate_settled();
create trigger webhook_continuation_settled after update of status on public.webhook_subscriptions
for each row execute function private.flow_gate_settled();

alter table public.platform_eval_models add column context_window integer check (context_window >= 8192);

-- Only a nested unpublish trigger can advance the Assistant generation.
create function private.guard_assistant_continuation_epoch() returns trigger
language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() = 1 then new.continuation_epoch := old.continuation_epoch; end if;
  return new;
end $$;
revoke all on function private.guard_assistant_continuation_epoch() from public, anon, authenticated;
create trigger guard_assistant_continuation_epoch before update of continuation_epoch on public.assistants
for each row execute function private.guard_assistant_continuation_epoch();

-- Recover settlement/enqueue gaps, including checkpointless legacy gates.
-- Exclude existing job IDs so old failed jobs cannot starve newer work.
create function public.recover_flow_continuations(p_limit integer default 500) returns void
language sql security invoker set search_path = '' as $$
  insert into public.background_jobs(id, organization_id, kind, payload, max_attempts)
  select kind || ':' || gate_id, organization_id, kind, payload, 3 from (
    select r.id as gate_id, r.organization_id, r.created_at, 'resume_reviewed_conversation'::text as kind,
      jsonb_build_object('reviewId', r.id, 'organizationId', r.organization_id) as payload
    from public.review_requests r left join public.flow_continuations c on c.gate_kind = 'review' and c.gate_id = r.id
    where r.resumed_at is null and (r.status <> 'pending' or c.stopped_at is not null)
      and (c.id is null or c.origin_status is not null)
    union all
    select w.id, w.organization_id, w.created_at, 'resume_webhook_conversation'::text,
      jsonb_build_object('subscriptionId', w.id, 'organizationId', w.organization_id)
    from public.webhook_subscriptions w left join public.flow_continuations c on c.gate_kind = 'webhook' and c.gate_id = w.id
    where w.resumed_at is null and (w.status <> 'pending' or c.stopped_at is not null)
      and (c.id is null or c.origin_status is not null)
  ) candidates where not exists (
    select 1 from public.background_jobs j where j.id = candidates.kind || ':' || candidates.gate_id
  ) order by created_at, gate_id limit greatest(1, least(p_limit, 500)) on conflict(id) do nothing
$$;
revoke all on function public.recover_flow_continuations(integer) from public, anon, authenticated;
grant execute on function public.recover_flow_continuations(integer) to service_role;

-- Deletion fences opening BEFORE it scans external subscriptions. A gate opened
-- before this transaction remains visible to cleanup; one opened after refuses
-- before any external subscribe. Lock order matches open_flow_gate.
create function public.close_flow_gate_admission(p_assistant_id text default null, p_conversation_id text default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare a_id text;
begin
  if num_nonnulls(p_assistant_id, p_conversation_id) <> 1 then raise exception 'Exactly one deletion target is required'; end if;
  if p_assistant_id is not null then
    update public.assistants set gate_admission_closed = true where id = p_assistant_id;
  else
    select assistant_id into a_id from public.conversations where id = p_conversation_id;
    perform 1 from public.assistants where id = a_id for update;
    update public.conversations set gate_admission_closed = true where id = p_conversation_id;
  end if;
  update public.flow_continuations set stopped_at = coalesce(stopped_at, now()), stop_reason = coalesce(stop_reason, 'Deletion requested'), updated_at = now()
    where (p_assistant_id is not null and assistant_id = p_assistant_id) or (p_conversation_id is not null and conversation_id = p_conversation_id);
end $$;
revoke all on function public.close_flow_gate_admission(text,text) from public, anon, authenticated;
grant execute on function public.close_flow_gate_admission(text,text) to service_role;
