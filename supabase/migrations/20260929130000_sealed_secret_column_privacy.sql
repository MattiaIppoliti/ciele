-- Members could read sso_connections.encrypted_secret through PostgREST: the
-- select policy is "any org member", and the table-level select grant covers
-- every column. Together with the sealing helper an admin can call, that was a
-- way to obtain ciphertext of a string the admin chose. Purpose-bound sealing
-- (GCM AAD) closes the forgery; this closes the read, so the ciphertext of a
-- stored credential is no longer visible to an RLS-scoped client at all.
--
-- The app never needed the column through that client except to learn whether
-- a secret exists, so that fact becomes its own non-secret column. The secret
-- itself is read only by `Db.getSsoClientSecret` on the service-role client
-- (the widget SSO callback and the admin "validate" port), which bypasses
-- these grants.
--
-- Only SELECT changes. INSERT and UPDATE keep their table-level grants, so an
-- admin's upsert still writes encrypted_secret; `returning` in the upsert
-- names explicit columns and never asks for the secret.

alter table public.sso_connections
  add column has_client_secret boolean
  generated always as (encrypted_secret is not null) stored;

revoke select on table public.sso_connections from anon, authenticated;

grant select (
  id,
  organization_id,
  provider,
  config,
  has_client_secret,
  validation_status,
  validated_at,
  connected_at,
  updated_at
) on public.sso_connections to authenticated;
