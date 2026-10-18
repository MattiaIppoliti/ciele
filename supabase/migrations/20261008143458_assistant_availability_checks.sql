-- Independent endpoint samples. Missing intervals are deliberately not backfilled.
create unique index assistants_id_organization_availability_idx on public.assistants (id, organization_id);
create table public.assistant_availability_checks (
 assistant_id text not null,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 checked_at timestamptz not null,
 slot timestamptz generated always as (date_bin(interval '5 minutes', checked_at, timestamptz '2000-01-01 00:00:00+00')) stored,
 status text not null check (status in ('up','degraded','down')),
 latency_ms integer not null check (latency_ms >= 0),
 issue text check (issue in ('http_error','timeout','invalid_config','slow_response','network_error')),
 primary key (assistant_id, slot),
 foreign key (assistant_id, organization_id) references public.assistants(id, organization_id) on delete cascade
);
create index assistant_availability_org_time_idx on public.assistant_availability_checks(organization_id, checked_at);
create index assistant_availability_time_idx on public.assistant_availability_checks(checked_at);
alter table public.assistant_availability_checks enable row level security;
create policy availability_member_read on public.assistant_availability_checks for select to authenticated
 using (private.is_org_member(organization_id));
revoke all on public.assistant_availability_checks from public, anon, authenticated;
grant select on public.assistant_availability_checks to authenticated;
grant all on public.assistant_availability_checks to service_role;

create function public.org_assistant_availability(p_organization_id uuid, p_from timestamptz, p_to timestamptz)
returns table(assistant_id text, day text, status text, issue text, checks bigint, last_checked_at timestamptz)
language sql stable security invoker set search_path = public as $$
 select assistant_id, to_char(checked_at at time zone 'UTC','YYYY-MM-DD'), status, issue, count(*), max(checked_at)
 from public.assistant_availability_checks
 where organization_id = p_organization_id and checked_at >= p_from and checked_at < p_to
 group by 1,2,3,4
$$;
revoke all on function public.org_assistant_availability(uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.org_assistant_availability(uuid,timestamptz,timestamptz) to authenticated, service_role;

-- Organization reads use RLS; the cron's unscoped read is service-role only.
create function public.published_availability_targets(p_organization_id uuid default null, p_limit integer default 200)
returns table(id text, organization_id uuid, title text)
language sql stable security invoker set search_path = public as $$
 select a.id, a.organization_id, a.title from public.assistants a
 left join lateral (select max(c.checked_at) as last_check from public.assistant_availability_checks c where c.assistant_id=a.id) c on true
 where (p_organization_id is not null or current_user = 'service_role')
 and (p_organization_id is null or a.organization_id=p_organization_id)
 and exists (select 1 from public.publications p where p.assistant_id=a.id)
 order by c.last_check nulls first, a.id
 limit case when p_organization_id is null then least(greatest(p_limit,1),200) else null end
$$;
revoke all on function public.published_availability_targets(uuid,integer) from public, anon, authenticated;
grant execute on function public.published_availability_targets(uuid,integer) to authenticated, service_role;
