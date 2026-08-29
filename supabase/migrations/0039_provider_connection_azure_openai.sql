-- Azure OpenAI is a distinct Provider Connection identity: it is not direct
-- OpenAI because endpoint, deployment and Entra identity are tenant-specific.

alter table public.provider_connections
  drop constraint if exists provider_connections_provider_check;

alter table public.provider_connections
  add constraint provider_connections_provider_check
  check (provider in ('anthropic', 'openai', 'google', 'azure_openai'));
