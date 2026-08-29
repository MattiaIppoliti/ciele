-- Provider connections: add keyless/federated connection config.
-- Federated rows store only non-secret provider configuration; credentials are
-- minted at runtime through provider-specific workload identity.

alter table public.provider_connections
  add column if not exists config jsonb not null default '{}'::jsonb;

alter table public.provider_connections
  drop constraint if exists provider_connections_type_check;

alter table public.provider_connections
  add constraint provider_connections_type_check
  check (type in ('platform', 'subscription', 'api_key', 'federated'));

alter table public.provider_connections
  add constraint provider_connections_config_object_check
  check (jsonb_typeof(config) = 'object');

alter table public.provider_connections
  add constraint provider_connections_federated_no_secret_check
  check (type <> 'federated' or encrypted_key is null);
