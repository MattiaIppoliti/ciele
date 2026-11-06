-- What an audit entry names and what it changed (Settings > Audit log).
--
-- 20261023080000_configuration_audit records every write operation with its
-- identifiers and actor snapshot, and deliberately no inputs. An entry could
-- say "members.updateRole on member X" but not whose role it was or what it
-- became. An operation may now describe its own change: a readable target
-- (the member's email, the key's name) and the fields it changed, before and
-- after. The operation chooses what to describe, so a credential, a prompt or
-- Visitor text never reaches the log through this column either.

alter table public.audit_log
  add column if not exists target_label text,
  add column if not exists target_detail text,
  -- { "<field label>": { "before": <json>, "after": <json> } }
  add column if not exists changes jsonb not null default '{}'::jsonb;

-- The action filter selects by operation name.
create index if not exists audit_log_org_operation_idx
  on public.audit_log (organization_id, operation, created_at desc);

-- Same rules as 20261023080000; the three new fields are copied from the
-- entry. A description over 16 KB is dropped rather than refused: the entry
-- itself must still land.
create or replace function public.record_audit_entry(p_entry jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare org uuid := (p_entry->>'organizationId')::uuid; actor uuid := nullif(p_entry->>'memberId','')::uuid; snapshot public.profiles;
  described jsonb := coalesce(p_entry->'changes','{}'::jsonb);
begin
  if coalesce(auth.jwt()->>'role',auth.role()) <> 'service_role' then
    actor := auth.uid();
    if not private.is_org_member(org) then raise exception 'Forbidden' using errcode='42501'; end if;
  elsif actor is not null and not exists(select 1 from public.organization_members where organization_id=org and user_id=actor) then
    raise exception 'Actor is not an Organization Member' using errcode='42501';
  end if;
  if jsonb_typeof(described) <> 'object' or octet_length(described::text) > 16384 then described := '{}'::jsonb; end if;
  select * into snapshot from public.profiles where id=actor;
  insert into public.audit_log(organization_id,operation,effect,entities,member_id,member_name,member_email,api_key_id,teammate_id,agent_author,surface,outcome,target_label,target_detail,changes)
  values(org,p_entry->>'operation',p_entry->>'effect',coalesce(p_entry->'entities','[]'),actor,
    coalesce(nullif(trim(concat_ws(' ',snapshot.first_name,snapshot.last_name)),''),snapshot.username),snapshot.email,
    p_entry->>'apiKeyId',p_entry->>'teammateId',p_entry->>'agentAuthor',p_entry->>'surface',p_entry->>'outcome',
    left(nullif(p_entry->>'targetLabel',''),300),left(nullif(p_entry->>'targetDetail',''),300),described);
end $$;
revoke all on function public.record_audit_entry(jsonb) from public,anon;
grant execute on function public.record_audit_entry(jsonb) to authenticated,service_role;
