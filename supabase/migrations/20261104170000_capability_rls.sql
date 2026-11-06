-- RLS checks Capabilities, not tiers (map #1164, ADR-0028).
--
-- 20261104140000 kept every rank policy (private.has_org_role(org, n)) and
-- made the Role's tier an upper bound: a Member whose custom Role sits at the
-- Editor tier could still write, with their own token through PostgREST, any
-- table an Editor can. This rewrites the write policies, and the helper
-- functions they call, so each one names the Capability of the area it
-- guards:
--
--   private.has_org_role(org, 2)        ->  org in (select private.orgs_with('flows:edit'))
--   private.has_org_role(a.organization_id, 2) on an Assistant's row
--                                       ->  private.has_assistant_capability(a.id, 'flows:edit')
--
-- The second form applies the Member's Role on that Assistant, up or down,
-- the same rule as effectiveAssistantCapabilities in packages/core.
--
-- Mechanical, from pg_policies and pg_get_functiondef, so nothing is retyped
-- by hand: a mapping row names a table (or function), the command, the
-- Capability, and for an Assistant's rows the expression that is the
-- Assistant's id. What is not in the mapping keeps its tier on purpose:
-- runtime and ledger tables the console never writes directly
-- (background_jobs, entities*, memory_document*, thread_preferences), and the
-- oversight reads (projects, action_approvals), which are tiers by design.

-- One Assistant ------------------------------------------------------------------

create or replace function private.has_assistant_capability(assistant text, p_capability text)
returns boolean language sql stable security definer set search_path = public as $$
  select private.is_platform_superuser() or exists (
    select 1
    from public.assistants a
    join public.organization_members m on m.organization_id = a.organization_id
    left join public.org_roles r on r.id = m.role_id
    left join public.assistant_access aa on aa.assistant_id = a.id and aa.user_id = m.user_id
    left join public.org_roles ar on ar.id = aa.role_id
    where a.id = assistant
      and m.user_id = (select auth.uid())
      and case
        when m.role = 'owner' or r.key = 'owner' then true
        when aa.assistant_id is not null then
          aa.role <> 'denied'
          and case
            when ar.id is null then p_capability = any(private.builtin_role_defaults(aa.role::text))
            else ar.key = 'owner' or p_capability = any(ar.capabilities)
          end
        when m.assistant_scope = 'selected' then false
        when r.id is null then p_capability = any(private.builtin_role_defaults(m.role::text))
        else p_capability = any(r.capabilities)
      end
  )
$$;

revoke all on function private.has_assistant_capability(text, text) from public, anon;
grant execute on function private.has_assistant_capability(text, text) to authenticated, service_role;

-- The mapping ---------------------------------------------------------------------

create temporary table capability_policy_map (
  tablename text not null,
  -- null: every command the table's rank policies cover.
  cmd text,
  capability text not null,
  -- For an Assistant's rows: the expression that is the Assistant's id, and
  -- the org expression it replaces inside has_org_role.
  assistant_expr text,
  org_expr text
) on commit drop;

insert into capability_policy_map (tablename, cmd, capability, assistant_expr, org_expr) values
  ('alerts', null, 'alerts:edit', null, null),
  ('application_connections', null, 'applications:connect', null, null),
  ('application_import_assistants', null, 'applications:edit', null, null),
  ('application_imports', null, 'applications:edit', null, null),
  ('application_oauth_nonces', null, 'applications:edit', null, null),
  ('application_sources', null, 'applications:edit', null, null),
  ('application_sync_runs', null, 'applications:edit', null, null),
  ('assistant_api_integrations', null, 'apiIntegrations:edit', 'assistant_id', 'organization_id'),
  ('assistant_goals', null, 'goals:edit', null, null),
  ('assistant_skills', null, 'assistants:edit', 'a.id', 'a.organization_id'),
  ('assistants', 'INSERT', 'assistants:edit', null, null),
  ('assistants', 'UPDATE', 'assistants:edit', 'id', 'organization_id'),
  ('assistants', 'DELETE', 'assistants:delete', 'id', 'organization_id'),
  ('assistant_sources', 'INSERT', 'knowledge:edit', null, null),
  ('assistant_sources', 'UPDATE', 'knowledge:edit', null, null),
  ('assistant_sources', 'DELETE', 'knowledge:delete', null, null),
  ('audit_log', null, 'audit:view', null, null),
  ('business_hours', null, 'businessHours:edit', null, null),
  ('crawler_connections', null, 'crawlers:manage', null, null),
  ('evaluation_datasets', null, 'evaluations:run', null, null),
  ('evaluation_runs', null, 'evaluations:run', 'assistant_id', 'organization_id'),
  ('export_jobs', null, 'audit:view', null, null),
  ('export_schedules', null, 'exports:schedule', null, null),
  ('flows', 'INSERT', 'flows:edit', 'a.id', 'a.organization_id'),
  ('flows', 'UPDATE', 'flows:edit', 'a.id', 'a.organization_id'),
  ('flows', 'DELETE', 'flows:delete', 'a.id', 'a.organization_id'),
  ('help_desk_operators', null, 'helpDesks:edit', null, null),
  ('help_desks', null, 'helpDesks:edit', null, null),
  ('improvement_messages', null, 'improvements:edit', null, null),
  ('improvement_proposals', null, 'improvements:edit', null, null),
  ('improvement_validations', 'INSERT', 'improvements:edit', null, null),
  ('improvements', null, 'improvements:edit', null, null),
  ('knowledge_memories', 'INSERT', 'knowledge:edit', null, null),
  ('knowledge_memories', 'UPDATE', 'knowledge:edit', null, null),
  ('knowledge_memories', 'DELETE', 'knowledge:delete', null, null),
  ('mcp_server_connections', null, 'mcpServers:manage', null, null),
  ('memories', null, 'memories:edit', null, null),
  ('object_access_events', null, 'audit:view', null, null),
  ('org_budgets', null, 'organization:edit', null, null),
  ('organizations', 'UPDATE', 'organization:edit', null, null),
  ('outbound_webhook_subscriptions', null, 'webhooks:manage', null, null),
  ('projects', 'INSERT', 'projects:edit', null, null),
  ('projects', 'UPDATE', 'projects:edit', null, null),
  ('provider_connections', null, 'providers:manage', null, null),
  ('publications', null, 'assistants:publish', 'a.id', 'a.organization_id'),
  ('quick_texts', null, 'quickTexts:edit', null, null),
  ('retention_sweep_events', null, 'audit:view', null, null),
  ('skills', null, 'skills:edit', null, null),
  ('source_ingest_payloads', null, 'knowledge:edit', null, null),
  ('sso_connections', null, 'sso:manage', null, null),
  ('support_channels', null, 'helpDesks:edit', null, null),
  ('task_labels', null, 'projects:edit', null, null),
  ('teammate_channel_messages', null, 'channels:oversee', null, null),
  ('teammate_channel_participants', null, 'channels:oversee', null, null),
  ('teammate_channels', null, 'channels:oversee', null, null),
  ('teammate_grants', null, 'teammates:grants', null, null),
  ('teammate_routines', null, 'teammates:edit', null, null),
  ('teammates', null, 'teammates:edit', null, null),
  ('webhook_deliveries', null, 'webhooks:manage', null, null);

create or replace function pg_temp.capability_expr(expr text, cap text, assistant_expr text, org_expr text)
returns text language plpgsql as $$
declare result text := expr;
begin
  if result is null then return null; end if;
  if assistant_expr is not null then
    result := replace(
      result,
      format('private.has_org_role(%s, 2)', org_expr),
      format('private.has_assistant_capability(%s, %L)', assistant_expr, cap)
    );
    result := replace(
      result,
      format('private.has_org_role(%s, 3)', org_expr),
      format('private.has_assistant_capability(%s, %L)', assistant_expr, cap)
    );
  end if;
  -- Any remaining Organization check of the Editor or Admin rank.
  result := regexp_replace(
    result,
    'private\.has_org_role\(([^,()]+), [23]\)',
    format('(\1 in ( SELECT private.orgs_with(%L)))', cap),
    'g'
  );
  -- An Assistant's knowledge rows.
  result := regexp_replace(
    result,
    'private\.has_assistant_role\(([^,()]+), 2\)',
    format('private.has_assistant_capability(\1, %L)', cap),
    'g'
  );
  return result;
end $$;

do $$
declare
  p record;
  using_expr text;
  check_expr text;
  statement text;
begin
  for p in
    select pol.tablename, pol.policyname, pol.cmd, pol.qual, pol.with_check,
           m.capability, m.assistant_expr, m.org_expr
    from pg_policies pol
    join capability_policy_map m
      on m.tablename = pol.tablename and (m.cmd is null or m.cmd = pol.cmd)
    where pol.schemaname = 'public'
      and (coalesce(pol.qual, '') || coalesce(pol.with_check, '')) ~ '(has_org_role\([^,()]+, [23]\)|has_assistant_role\([^,()]+, 2\))'
  loop
    using_expr := pg_temp.capability_expr(p.qual, p.capability, p.assistant_expr, p.org_expr);
    check_expr := pg_temp.capability_expr(p.with_check, p.capability, p.assistant_expr, p.org_expr);
    statement := format('alter policy %I on public.%I', p.policyname, p.tablename);
    if using_expr is not null then statement := statement || format(' using (%s)', using_expr); end if;
    if check_expr is not null then statement := statement || format(' with check (%s)', check_expr); end if;
    execute statement;
  end loop;
end $$;

-- The helper functions those policies and RPCs call ------------------------------

create temporary table capability_function_map (
  schema_name text not null,
  function_name text not null,
  capability text not null
) on commit drop;

insert into capability_function_map values
  ('private', 'can_create_org_knowledge', 'knowledge:edit'),
  ('private', 'can_write_source', 'knowledge:edit'),
  ('private', 'can_write_project', 'projects:edit'),
  ('private', 'enforce_channel_manage_rule', 'channels:oversee'),
  ('private', 'enforce_teammate_execution_config', 'teammates:grants'),
  ('private', 'guard_conversation_legal_hold_change', 'inbox:legalHold'),
  ('public', 'consume_application_oauth_nonce', 'applications:edit'),
  ('public', 'create_mcp_server_connection', 'mcpServers:manage'),
  ('public', 'create_outbound_webhook_subscription', 'webhooks:manage'),
  ('public', 'queue_outbound_webhook_event', 'webhooks:manage'),
  ('public', 'delete_business_hours', 'businessHours:edit'),
  ('public', 'save_business_hours', 'businessHours:edit'),
  ('public', 'set_default_timezone', 'businessHours:edit'),
  ('public', 'next_improvement_seq', 'improvements:edit'),
  ('public', 'stage_source_ingest_job', 'knowledge:edit');

do $$
declare
  f record;
  definition text;
begin
  for f in
    select p.oid, m.capability
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join capability_function_map m on m.schema_name = n.nspname and m.function_name = p.proname
  loop
    definition := pg_get_functiondef(f.oid);
    definition := regexp_replace(
      definition,
      -- The org argument may hold one level of parentheses:
      -- has_org_role(private.project_org(p_project_id), 2) and
      -- has_org_role((p_event->>'organizationId')::uuid, 3).
      '(private\.|public\.)?has_org_role\(\s*((?:[^,()]|\([^()]*\))+?)\s*,\s*[23]\s*\)',
      format('(\2 in (select private.orgs_with(%L)))', f.capability),
      'g'
    );
    definition := regexp_replace(
      definition,
      '(private\.)?has_assistant_role\(\s*([^,()]+?)\s*,\s*2\s*\)',
      format('private.has_assistant_capability(\2, %L)', f.capability),
      'g'
    );
    execute definition;
  end loop;
end $$;

-- Personal AI subscriptions are the Owner's alone (inventory #1165 §5.3):
-- organization:edit covers the row, so the one Owner column gets a guard.
create or replace function private.guard_personal_subscriptions()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user = 'authenticated'
     and new.allow_personal_ai_subscriptions is distinct from old.allow_personal_ai_subscriptions
     and not private.has_capability(new.id, 'personalSubscriptions:manage') then
    raise exception 'Only an Owner can allow personal AI subscriptions' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger organizations_guard_personal_subscriptions
  before update of allow_personal_ai_subscriptions on public.organizations
  for each row execute function private.guard_personal_subscriptions();

-- An Assistant stays in its Organization: the per-Assistant update policy
-- reads the row's Assistant by id, which a moved row would still pass
-- (review of #1164). Moving an Assistant is never a console write.
create or replace function private.fence_assistant_organization()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user = 'authenticated' and new.organization_id is distinct from old.organization_id then
    raise exception 'An Assistant cannot move to another organization' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger assistants_fence_organization
  before update of organization_id on public.assistants
  for each row execute function private.fence_assistant_organization();
