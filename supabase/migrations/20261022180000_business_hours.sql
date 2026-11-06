-- Shared live Business hours and local-day Holidays (#1097, #1098).
alter table public.organizations add column if not exists default_timezone text not null default 'UTC';
create table public.business_hours (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  timezone text not null,
  hours jsonb not null check (jsonb_typeof(hours) = 'object'),
  holidays jsonb not null default '[]' check (jsonb_typeof(holidays) = 'array'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index business_hours_org_idx on public.business_hours(organization_id);
create unique index business_hours_one_default_idx on public.business_hours(organization_id) where is_default;
alter table public.business_hours enable row level security;
create policy business_hours_member_read on public.business_hours for select to authenticated using (private.is_org_member(organization_id));
create policy business_hours_editor_insert on public.business_hours for insert to authenticated with check (private.has_org_role(organization_id, 2));
create policy business_hours_editor_update on public.business_hours for update to authenticated using (private.has_org_role(organization_id, 2)) with check (private.has_org_role(organization_id, 2));
create policy business_hours_editor_delete on public.business_hours for delete to authenticated using (private.has_org_role(organization_id, 2));
revoke all on public.business_hours from public, anon, authenticated;
-- Writes use the atomic RPCs so direct Data API writes cannot remove the default.
grant select on public.business_hours to authenticated;
grant all on public.business_hours to service_role;

-- The organization lock serializes default switches with creates/deletes.
create function public.save_business_hours(p_organization_id uuid, p_id text, p_name text, p_timezone text, p_hours jsonb, p_holidays jsonb, p_is_default boolean, p_create boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.business_hours;
begin
  if coalesce((select auth.jwt())->>'role',current_setting('request.jwt.claim.role',true),'') <> 'service_role'
     and not coalesce(private.has_org_role(p_organization_id,2),false) then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 1097));
  if not p_create and not exists(select 1 from public.business_hours where id = p_id and organization_id = p_organization_id) then
    raise exception 'Business hours not found' using errcode = 'P0002';
  end if;
  if p_is_default then
    update public.business_hours set is_default = false, updated_at = now() where organization_id = p_organization_id and id <> p_id and is_default;
  end if;
  if p_create then
    insert into public.business_hours(id,organization_id,name,timezone,hours,holidays,is_default)
    values(p_id,p_organization_id,p_name,p_timezone,p_hours,p_holidays,p_is_default);
  else
    update public.business_hours set name=p_name, timezone=p_timezone, hours=p_hours, holidays=p_holidays, is_default=p_is_default, updated_at=now()
    where id=p_id and organization_id=p_organization_id;
  end if;
  if not exists(select 1 from public.business_hours where organization_id=p_organization_id and is_default) then
    update public.business_hours set is_default=true, updated_at=now() where id=(select id from public.business_hours where organization_id=p_organization_id order by created_at,id limit 1);
  end if;
  select * into saved from public.business_hours where id=p_id and organization_id=p_organization_id;
  return to_jsonb(saved);
end $$;
revoke all on function public.save_business_hours(uuid,text,text,text,jsonb,jsonb,boolean,boolean) from public;
grant execute on function public.save_business_hours(uuid,text,text,text,jsonb,jsonb,boolean,boolean) to authenticated,service_role;

-- A reference survives editor changes until a newer Publication replaces it.
create function private.refuse_used_business_hours_delete() returns trigger language plpgsql security definer set search_path = '' as $$
declare used_by text;
begin
  if not exists(select 1 from public.organizations where id=old.organization_id) then return old; end if;
  select string_agg(distinct label, ', ' order by label) into used_by from (
    select 'Channel ' || c.name as label from public.support_channels c
    join public.help_desks d on d.id=c.help_desk_id
    where d.organization_id=old.organization_id and c.availability->>'mode'='business_hours' and c.availability->>'businessHoursId'=old.id
    union all
    select 'Flow ' || f.name from public.flows f join public.assistants a on a.id=f.assistant_id
    where a.organization_id=old.organization_id and f.conditions @> jsonb_build_array(jsonb_build_object('kind','schedule','mode','business_hours','businessHoursId',old.id))
    union all
    select 'Published Flow ' || coalesce(flow->>'name','unnamed') from (
      select distinct on (p.assistant_id) p.config from public.publications p join public.assistants a on a.id=p.assistant_id
      where a.organization_id=old.organization_id order by p.assistant_id,p.version desc
    ) latest cross join lateral jsonb_array_elements(coalesce(latest.config->'flows','[]'::jsonb)) flow
    where flow->'conditions' @> jsonb_build_array(jsonb_build_object('kind','schedule','mode','business_hours','businessHoursId',old.id))
  ) references_in_use;
  if used_by is not null then raise exception 'Business hours is used by: %', used_by using errcode='23503'; end if;
  return old;
end $$;
revoke all on function private.refuse_used_business_hours_delete() from public;
create trigger business_hours_refuse_used_delete before delete on public.business_hours for each row execute function private.refuse_used_business_hours_delete();

create function public.delete_business_hours(p_organization_id uuid,p_id text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt())->>'role',current_setting('request.jwt.claim.role',true),'') <> 'service_role'
     and not coalesce(private.has_org_role(p_organization_id,2),false) then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text,1097));
  delete from public.business_hours where id=p_id and organization_id=p_organization_id;
  if not found then raise exception 'Business hours not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.business_hours where organization_id=p_organization_id and is_default) then
    update public.business_hours set is_default=true,updated_at=now() where id=(select id from public.business_hours where organization_id=p_organization_id order by created_at,id limit 1);
  end if;
end $$;
revoke all on function public.delete_business_hours(uuid,text) from public;
grant execute on function public.delete_business_hours(uuid,text) to authenticated,service_role;

-- Editors may set this one Organization setting without gaining profile/admin writes.
create function public.set_default_timezone(p_organization_id uuid,p_timezone text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt())->>'role',current_setting('request.jwt.claim.role',true),'') <> 'service_role'
     and not coalesce(private.has_org_role(p_organization_id,2),false) then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'Invalid IANA timezone' using errcode='22023'; end if;
  update public.organizations set default_timezone=p_timezone where id=p_organization_id;
  if not found then raise exception 'Organization not found' using errcode='P0002'; end if;
end $$;
revoke all on function public.set_default_timezone(uuid,text) from public;
grant execute on function public.set_default_timezone(uuid,text) to authenticated,service_role;

-- JSON references retain a key-share lock until commit, as a foreign key would.
-- This closes a create-reference/delete race and applies to direct writes too.
create function private.validate_business_hours_references() returns trigger language plpgsql security definer set search_path = '' as $$
declare org_id uuid; references_json jsonb; reference_id text;
begin
  if tg_table_name = 'support_channels' then
    select organization_id into org_id from public.help_desks where id=new.help_desk_id;
    references_json = case when new.availability->>'mode'='business_hours' then jsonb_build_array(new.availability->>'businessHoursId') else '[]'::jsonb end;
  elsif tg_table_name = 'flows' then
    select organization_id into org_id from public.assistants where id=new.assistant_id;
    select coalesce(jsonb_agg(c->>'businessHoursId'),'[]'::jsonb) into references_json
    from jsonb_array_elements(coalesce(new.conditions,'[]'::jsonb)) c where c->>'kind'='schedule' and c->>'mode'='business_hours';
  else
    select organization_id into org_id from public.assistants where id=new.assistant_id;
    select coalesce(jsonb_agg(c->>'businessHoursId'),'[]'::jsonb) into references_json
    from jsonb_array_elements(coalesce(new.config->'flows','[]'::jsonb)) f
    cross join lateral jsonb_array_elements(coalesce(f->'conditions','[]'::jsonb)) c where c->>'kind'='schedule' and c->>'mode'='business_hours';
  end if;
  for reference_id in select jsonb_array_elements_text(references_json) loop
    perform 1 from public.business_hours where id=reference_id and organization_id=org_id for key share;
    if not found then raise exception 'Business hours not found' using errcode='23503'; end if;
  end loop;
  return new;
end $$;
revoke all on function private.validate_business_hours_references() from public;
create trigger support_channel_business_hours_ref before insert or update of availability on public.support_channels for each row execute function private.validate_business_hours_references();
create trigger flow_business_hours_ref before insert or update of conditions on public.flows for each row execute function private.validate_business_hours_references();
create trigger publication_business_hours_ref before insert or update of config on public.publications for each row execute function private.validate_business_hours_references();
