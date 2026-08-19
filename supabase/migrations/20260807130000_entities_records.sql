-- Entities + Records (spec ciele-org#660, ticket ciele-org#663).
--
-- An Entity is an org-level schema over structured business data: a name,
-- typed attributes (text/number/date/boolean), a key attribute for idempotent
-- upserts, and a scope, 'shared' (readable by anyone the assistant serves)
-- or 'user' (rows belong to one end-user, matched later via the verified SSO
-- identity claim; the retrieval tickets consume this). Records are the rows,
-- imported via CSV in v1, stored as attribute-keyed JSON.

create table public.entities (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  description text not null default '',
  -- Array of { key, label, type }, see packages/db/src/types.ts EntityAttribute.
  attributes jsonb not null default '[]'::jsonb,
  -- Which attribute keys imports upsert by (unique per entity).
  key_attribute text not null,
  scope text not null default 'shared' check (scope in ('shared', 'user')),
  -- For 'user' scope: the attribute matched against the verified identity claim.
  identity_attribute text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entities_user_scope_identity check (
    scope = 'shared' or identity_attribute is not null
  )
);

create index if not exists entities_organization_id_idx
  on public.entities (organization_id);

alter table public.entities enable row level security;

create policy "members read entities" on public.entities
  for select using (private.is_org_member(organization_id));
create policy "editors create entities" on public.entities
  for insert with check (private.has_org_role(organization_id, 2));
create policy "editors update entities" on public.entities
  for update using (private.has_org_role(organization_id, 2));
create policy "editors delete entities" on public.entities
  for delete using (private.has_org_role(organization_id, 2));

create table public.entity_records (
  id text primary key,
  entity_id text not null references public.entities (id) on delete cascade,
  -- The key attribute's value: the upsert identity within the entity.
  record_key text not null,
  -- Attribute-keyed values, validated app-side against the entity schema.
  "values" jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, record_key)
);

create index if not exists entity_records_entity_id_idx
  on public.entity_records (entity_id);

alter table public.entity_records enable row level security;

create policy "members read entity records" on public.entity_records
  for select using (exists (
    select 1 from public.entities e
    where e.id = entity_records.entity_id
      and private.is_org_member(e.organization_id)
  ));
create policy "editors write entity records" on public.entity_records
  for insert with check (exists (
    select 1 from public.entities e
    where e.id = entity_records.entity_id
      and private.has_org_role(e.organization_id, 2)
  ));
create policy "editors update entity records" on public.entity_records
  for update using (exists (
    select 1 from public.entities e
    where e.id = entity_records.entity_id
      and private.has_org_role(e.organization_id, 2)
  ));
create policy "editors delete entity records" on public.entity_records
  for delete using (exists (
    select 1 from public.entities e
    where e.id = entity_records.entity_id
      and private.has_org_role(e.organization_id, 2)
  ));
