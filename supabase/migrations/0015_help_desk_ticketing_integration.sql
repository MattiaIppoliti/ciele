-- Help desks: connected ticketing platform (ServiceNow to start).
-- clientSecret/password inside the JSON are sealed (encrypted) before storage
-- by the app layer (see apps/web/src/lib/runtime/crypto.ts).

alter table public.help_desks
  add column if not exists ticketing_integration jsonb;
