-- AI Gateway as a model source, and the source a model choice is pinned to.
--
-- Additive only: the columns are nullable (null = automatic, the order the
-- runtime always used), and the widened checks accept every value they did.

-- Which credential the configured model runs on. The allow-lists carry the same
-- choice inside their jsonb refs, so they need no column.
alter table public.assistants
  add column model_source text
    check (model_source in ('platform', 'api_key', 'federated', 'ai_gateway', 'platform_gateway'));
alter table public.teammates
  add column model_source text
    check (model_source in ('platform', 'api_key', 'federated', 'ai_gateway', 'platform_gateway'));

-- An Organization's own AI Gateway key: one `api_key` connection that serves
-- the catalog providers' models, so it is a connection provider of its own.
alter table public.provider_connections
  drop constraint if exists provider_connections_provider_check;
alter table public.provider_connections
  add constraint provider_connections_provider_check
  check (provider in (
    'anthropic', 'openai', 'google', 'azure_openai', 'openai_compatible',
    'elevenlabs', 'ai_gateway'
  ));

-- A call on that key is customer-funded and recorded as its own kind. A call
-- through the platform's Gateway key records `platform`, like any platform key.
alter table public.ai_usage
  drop constraint if exists ai_usage_credential_kind_check;
alter table public.ai_usage
  add constraint ai_usage_credential_kind_check
  check (credential_kind in (
    'platform', 'api_key', 'google_vertex_federated', 'local_subscription',
    'ai_gateway'
  ));
alter table public.usage_daily
  drop constraint if exists usage_daily_credential_kind_check;
alter table public.usage_daily
  add constraint usage_daily_credential_kind_check
  check (credential_kind in (
    'platform', 'api_key', 'google_vertex_federated', 'local_subscription',
    'ai_gateway', 'unknown'
  ));
