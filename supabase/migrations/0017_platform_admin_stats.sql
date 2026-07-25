-- Platform admin: cross-org aggregates for the internal admin.ciele.app
-- console (Ciele staff only). These views intentionally read across every
-- organization, so they are exposed to the service role alone — never to
-- anon/authenticated clients — to avoid punching a hole through per-org RLS.

create or replace view public.platform_org_stats as
select
  o.id,
  o.name,
  o.created_at,
  (select count(*) from public.organization_members m
     where m.organization_id = o.id) as member_count,
  (select count(*) from public.assistants a
     where a.organization_id = o.id) as assistant_count,
  (select count(*) from public.conversations c
     join public.assistants a on a.id = c.assistant_id
     where a.organization_id = o.id) as conversation_count,
  (select count(*) from public.messages msg
     join public.conversations c on c.id = msg.conversation_id
     join public.assistants a on a.id = c.assistant_id
     where a.organization_id = o.id) as message_count,
  (select max(msg.created_at) from public.messages msg
     join public.conversations c on c.id = msg.conversation_id
     join public.assistants a on a.id = c.assistant_id
     where a.organization_id = o.id) as last_message_at,
  (select count(*) from public.provider_connections pc
     where pc.organization_id = o.id) as provider_connection_count,
  (select count(*) from public.sources s
     join public.knowledge_collections kc on kc.id = s.collection_id
     join public.assistants a on a.id = kc.assistant_id
     where a.organization_id = o.id and s.status = 'error') as source_error_count,
  (select count(*) from public.help_desks hd
     where hd.organization_id = o.id) as help_desk_count,
  (select count(*) from public.improvements im
     where im.organization_id = o.id
       and im.status not in ('done', 'archived')) as open_improvement_count
from public.organizations o;

revoke all on public.platform_org_stats from public, anon, authenticated;
grant select on public.platform_org_stats to service_role;

-- Daily message volume per org, for usage trend charts.
create or replace view public.platform_daily_usage as
select
  a.organization_id,
  date_trunc('day', msg.created_at)::date as day,
  count(*) as message_count
from public.messages msg
join public.conversations c on c.id = msg.conversation_id
join public.assistants a on a.id = c.assistant_id
group by a.organization_id, date_trunc('day', msg.created_at)::date;

revoke all on public.platform_daily_usage from public, anon, authenticated;
grant select on public.platform_daily_usage to service_role;
