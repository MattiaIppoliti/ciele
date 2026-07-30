-- Migrate legacy per-endpoint custom HTTP tools to API Integrations (#575).
--
-- The contract step of spec #559 deleted the custom-tool form after verifying
-- zero configurations on the live project — but an OSS self-hoster upgrading
-- across that release would have an Assistant whose working tool silently
-- stopped. This is the skipped expand-contract *migrate* step, shipped late:
--
--  * A convertible configuration (every entry on one origin, no custom
--    headers, no query string in the URL, and no API Integration already on
--    the Assistant) becomes one integration whose catalogue has one endpoint
--    per legacy tool. Legacy tools had no sealed credential to carry — auth
--    lived in plaintext headers, which make a config non-convertible below.
--  * Anything else is preserved visibly instead of dropped silently: an
--    active Alert (type 'integration') carries the original configuration
--    verbatim so an admin can recreate it under Assistant > API integration.
--  * The dead `assistants.tools.custom` key is removed in both cases.
--
-- Idempotent: once the key is gone the loop finds no rows; the deterministic
-- alert id and the active-alert dedup index make a re-run insert nothing.

do $$
declare
  rec record;
  entry jsonb;
  entry_origin text;
  origin text;
  convertible boolean;
  endpoints jsonb;
begin
  for rec in
    select a.id, a.organization_id, a.tools
    from public.assistants a
    where jsonb_typeof(a.tools -> 'custom') = 'array'
      and jsonb_array_length(a.tools -> 'custom') > 0
  loop
    -- An Assistant that already registered a real integration is never
    -- clobbered; its legacy key goes to the Alert path instead.
    convertible := not exists (
      select 1 from public.assistant_api_integrations i
      where i.assistant_id = rec.id
    );
    origin := null;

    if convertible then
      for entry in select * from jsonb_array_elements(rec.tools -> 'custom') loop
        entry_origin := substring(entry ->> 'url' from '^(https?://[^/?#]+)');
        if entry_origin is null
          or (entry ->> 'url') ~ '[?#]'
          or (jsonb_typeof(entry -> 'headers') = 'array'
              and jsonb_array_length(entry -> 'headers') > 0)
        then
          convertible := false;
          exit;
        end if;
        if origin is null then
          origin := entry_origin;
        elsif origin <> entry_origin then
          -- One integration per Assistant: mixed origins cannot convert.
          convertible := false;
          exit;
        end if;
      end loop;
      if origin is null then
        convertible := false;
      end if;
    end if;

    if convertible then
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', coalesce(nullif(e ->> 'id', ''), substr(md5(e::text), 1, 12)),
        'name', coalesce(nullif(e ->> 'name', ''), 'endpoint'),
        'path', coalesce(
          nullif(substring(e ->> 'url' from '^https?://[^/?#]+(/[^?#]*)'), ''),
          '/'
        ),
        'method', case
          when upper(coalesce(e ->> 'method', 'POST')) = 'GET' then 'GET'
          else 'POST'
        end,
        'purpose', coalesce(e ->> 'description', ''),
        'params', (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'name', p ->> 'name',
            'description', nullif(p ->> 'description', ''),
            'required', case when lower(p ->> 'required') = 'true' then true end,
            'in', 'query',
            'type', 'string'
          )))
          from jsonb_array_elements(coalesce(e -> 'params', '[]'::jsonb)) p
          where nullif(p ->> 'name', '') is not null
        )
      )))
      into endpoints
      from jsonb_array_elements(rec.tools -> 'custom') e;

      insert into public.assistant_api_integrations
        (assistant_id, organization_id, name, base_url, auth_type, endpoints)
      values
        (rec.id, rec.organization_id, 'Migrated custom tools', origin, 'none',
         coalesce(endpoints, '[]'::jsonb));
    else
      insert into public.alerts
        (id, organization_id, type, title, detail, status, source_key)
      values (
        'al-ctm-' || substr(md5(rec.id), 1, 12),
        rec.organization_id,
        'integration',
        'Custom HTTP tools need manual migration',
        'The per-endpoint custom HTTP tools were replaced by the API catalogue '
          || 'integration, and this assistant''s configuration could not be '
          || 'converted automatically (custom headers, mixed origins, a URL '
          || 'with a query string, or an API integration already present). '
          || 'Recreate it under the assistant''s API integration settings. '
          || 'Original configuration: ' || (rec.tools -> 'custom')::text,
        'active',
        'custom-tools-migration:' || rec.id
      )
      on conflict do nothing;
    end if;

    update public.assistants set tools = tools - 'custom' where id = rec.id;
  end loop;
end $$;
