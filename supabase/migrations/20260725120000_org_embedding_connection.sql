-- Org-level embedding-connection picker (#437).
--
-- Which Provider Connection embeds an Organization's knowledge stops being an
-- implicit priority order in the runtime and becomes an explicit choice. NULL
-- (the default, and the state of every existing row) keeps today's automatic
-- order, so nothing changes until an admin picks one.
--
-- Retrieval quality depends on every chunk in a Knowledge Collection sharing
-- one embedding model; the FK's `on delete set null` means removing the chosen
-- connection reverts the org to the automatic order rather than leaving a
-- dangling reference.

-- Prerequisite: the provider check constraint never learned
-- `openai_compatible` when that provider shipped (#436), so the connection the
-- form in Settings > AI writes is rejected by the database — and it is exactly
-- the connection a self-hoster would pick to embed with a local model. Widen
-- the constraint before anything can reference such a row.
alter table public.provider_connections
  drop constraint if exists provider_connections_provider_check;

alter table public.provider_connections
  add constraint provider_connections_provider_check
  check (provider in ('anthropic', 'openai', 'google', 'azure_openai', 'openai_compatible'));

alter table public.organizations
  add column if not exists embedding_connection_id uuid
    references public.provider_connections(id) on delete set null;

comment on column public.organizations.embedding_connection_id is
  'Provider Connection that embeds this organization''s knowledge (#437). NULL = the runtime''s automatic provider order.';

-- The runtime reads this per embedding batch, joined against the org's
-- connections; index the FK so the lookup and the cascade stay cheap.
create index if not exists organizations_embedding_connection_id_idx
  on public.organizations (embedding_connection_id)
  where embedding_connection_id is not null;
