-- Voice configuration is optional; existing Assistants keep voice disabled.
-- The publication snapshot already carries its own JSON configuration.
alter table public.assistants
  add column if not exists voice jsonb;

-- ElevenLabs is a voice-only connection, not a text-model provider.
alter table public.provider_connections
  drop constraint if exists provider_connections_provider_check;

alter table public.provider_connections
  add constraint provider_connections_provider_check
  check (provider in (
    'anthropic', 'openai', 'google', 'azure_openai', 'openai_compatible', 'elevenlabs'
  ));
