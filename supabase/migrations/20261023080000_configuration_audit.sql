-- Configuration operation records contain identifiers and actor snapshots, never inputs.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  operation text not null,
  domain text generated always as (split_part(operation,'.',1)) stored,
  effect text not null check(effect in ('write','consequential')),
  entities jsonb not null default '[]',
  member_id uuid,
  member_name text,
  member_email text,
  api_key_id text,
  teammate_id text,
  agent_author text,
  surface text not null check(surface in ('console','api','mcp','teammate')),
  outcome text not null
);
-- Actor identifiers are historical snapshots: deleting a Member must not erase attribution.
create index audit_log_org_time_idx on public.audit_log(organization_id,created_at desc,id);
create index audit_log_org_member_idx on public.audit_log(organization_id,member_id,created_at desc);
create index audit_log_org_domain_idx on public.audit_log(organization_id,domain,created_at desc);
create index audit_log_retention_idx on public.audit_log(created_at);
alter table public.audit_log enable row level security;
create policy audit_log_admin_read on public.audit_log for select to authenticated using(private.has_org_role(organization_id,3));
revoke all on public.audit_log from public,anon,authenticated;
grant select on public.audit_log to authenticated;
grant all on public.audit_log to service_role;

create function public.record_audit_entry(p_entry jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare org uuid := (p_entry->>'organizationId')::uuid; actor uuid := nullif(p_entry->>'memberId','')::uuid; snapshot public.profiles;
begin
  if coalesce(auth.jwt()->>'role',auth.role()) <> 'service_role' then
    actor := auth.uid();
    if not private.is_org_member(org) then raise exception 'Forbidden' using errcode='42501'; end if;
  elsif actor is not null and not exists(select 1 from public.organization_members where organization_id=org and user_id=actor) then
    raise exception 'Actor is not an Organization Member' using errcode='42501';
  end if;
  select * into snapshot from public.profiles where id=actor;
  insert into public.audit_log(organization_id,operation,effect,entities,member_id,member_name,member_email,api_key_id,teammate_id,agent_author,surface,outcome)
  values(org,p_entry->>'operation',p_entry->>'effect',coalesce(p_entry->'entities','[]'),actor,
    coalesce(nullif(trim(concat_ws(' ',snapshot.first_name,snapshot.last_name)),''),snapshot.username),snapshot.email,
    p_entry->>'apiKeyId',p_entry->>'teammateId',p_entry->>'agentAuthor',p_entry->>'surface',p_entry->>'outcome');
end $$;
revoke all on function public.record_audit_entry(jsonb) from public,anon;
grant execute on function public.record_audit_entry(jsonb) to authenticated,service_role;

-- Link existence must bypass link-row RLS. Otherwise Denied hides every link
-- from this subquery and a shared Source is incorrectly treated as unlinked.
create function private.source_has_assistant_links(p_source_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.assistant_sources where source_id=p_source_id)
$$;
revoke all on function private.source_has_assistant_links(text) from public,anon;
grant execute on function private.source_has_assistant_links(text) to authenticated,service_role;
drop policy "members read org sources" on public.sources;
create policy "members read org sources" on public.sources for select using (
  case when private.source_has_assistant_links(id) then private.can_read_source(id)
  else exists(select 1 from public.knowledge_collections kc where kc.id=sources.collection_id and private.is_org_member(kc.organization_id)) end
);

alter table public.export_jobs drop constraint export_jobs_kind_check;
alter table public.export_jobs add constraint export_jobs_kind_check check(kind in ('insights_overview','insights_datapoints','insights_languages','audit_log'));

-- Audit files carry the same administrative boundary as their source entries.
create policy audit_export_admin on public.export_jobs as restrictive for all to authenticated
using(kind <> 'audit_log' or private.has_org_role(organization_id,3))
with check(kind <> 'audit_log' or private.has_org_role(organization_id,3));

alter function public.sweep_runtime_ledgers(timestamptz,integer) rename to sweep_runtime_ledgers_before_audit;
create function public.sweep_runtime_ledgers(p_now timestamptz default now(),p_limit integer default 1000)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  result := public.sweep_runtime_ledgers_before_audit(p_now,p_limit);
  delete from public.audit_log where id in (select id from public.audit_log where created_at < p_now - interval '180 days' order by created_at,id limit greatest(0,least(p_limit,5000)));
  return result;
end $$;
revoke all on function public.sweep_runtime_ledgers(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.sweep_runtime_ledgers(timestamptz,integer) to service_role;

-- Review attestations use the same restored Knowledge write resolver.
create or replace function public.set_document_review(p_organization_id uuid,p_document_id text,p_member_id uuid,p_reviewed boolean) returns jsonb language plpgsql security definer set search_path = '' as $$
declare document public.concepts; events jsonb; actor text := 'human:' || p_member_id::text;
begin
  if coalesce((select auth.jwt())->>'role',current_setting('request.jwt.claim.role',true),'') <> 'service_role' and p_member_id is distinct from auth.uid() then raise exception 'Forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_member_id and role in ('owner','admin','editor')) then raise exception 'Forbidden' using errcode='42501'; end if;
  -- Serialize with source cutover so a review made during a crawl follows its text.
  perform 1 from public.sources s join public.concepts c on c.source_id=s.id where c.id=p_document_id for key share of s;
  select c.* into document from public.concepts c join public.knowledge_collections k on k.id=c.collection_id
    where c.id=p_document_id and k.organization_id=p_organization_id and c.is_active for update of c;
  if not found then raise exception 'Document not found' using errcode='P0002'; end if;
  if coalesce((select auth.jwt())->>'role',current_setting('request.jwt.claim.role',true),'') <> 'service_role' and not private.can_write_source(document.source_id) then raise exception 'Forbidden' using errcode='42501'; end if;
  select coalesce(jsonb_agg(event),'[]'::jsonb) into events from jsonb_array_elements(
    case jsonb_typeof(document.frontmatter->'verified') when 'array' then document.frontmatter->'verified' when 'object' then jsonb_build_array(document.frontmatter->'verified') else '[]'::jsonb end
  ) event where event->>'by' is distinct from actor;
  if p_reviewed then events=events || jsonb_build_array(jsonb_build_object('by',actor,'at',clock_timestamp())); end if;
  update public.concepts set frontmatter=(frontmatter-'verified') || case when jsonb_array_length(events)>0 then jsonb_build_object('verified',events) else '{}'::jsonb end
    where id=p_document_id returning * into document;
  return to_jsonb(document);
end $$;
revoke all on function public.set_document_review(uuid,text,uuid,boolean) from public;
grant execute on function public.set_document_review(uuid,text,uuid,boolean) to authenticated,service_role;

-- Self-offboarding must record before its own membership disappears. The delete
-- and successful audit commit together; logging failure still permits leaving.
create function public.leave_organization_with_audit(p_organization_id uuid,p_user_id uuid,p_entry jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare recorded boolean := true; affected integer;
begin
  if (select auth.uid()) is distinct from p_user_id then raise exception 'Forbidden' using errcode='42501'; end if;
  perform 1 from public.organizations where id=p_organization_id for update;
  perform 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id for update;
  if not found then raise exception 'Member not found' using errcode='42501'; end if;
  if exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id and role='owner')
     and (select count(*) from public.organization_members where organization_id=p_organization_id and role='owner') <= 1 then raise exception 'The Organization must keep an Owner' using errcode='42501'; end if;
  begin
    perform public.record_audit_entry(p_entry || jsonb_build_object('organizationId',p_organization_id,'memberId',p_user_id,'outcome','ok'));
  exception when others then recorded := false;
  end;
  delete from public.organization_members where organization_id=p_organization_id and user_id=p_user_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Forbidden' using errcode='42501'; end if;
  return recorded;
end $$;
revoke all on function public.leave_organization_with_audit(uuid,uuid,jsonb) from public,anon;
grant execute on function public.leave_organization_with_audit(uuid,uuid,jsonb) to authenticated;
