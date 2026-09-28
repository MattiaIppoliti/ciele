# Encryption key rotation

`APP_ENCRYPTION_KEY` seals every stored credential: provider keys, SSO and
help-desk secrets, API-integration credentials, entity-sync headers and
application OAuth tokens (`packages/core/src/crypto.ts`, AES-256-GCM). The
value is not in the database, so a database backup without it restores
credentials nobody can open. Keep it in a secret manager with its own backup.

The stored format is `iv.tag.data` with no key id, on purpose: code from before
rotation support reads anything written after it, so a rollback never strands a
credential. `decryptSecret` tries the current key, then
`APP_ENCRYPTION_KEY_PREVIOUS`, and GCM's tag rejects the wrong one.

## Rotate

1. Generate a new key: `openssl rand -base64 32`.
2. In the deployment, set `APP_ENCRYPTION_KEY_PREVIOUS` to the **old** value and
   `APP_ENCRYPTION_KEY` to the **new** one, then redeploy. New writes seal under
   the new key; existing rows still open under the old one.
3. Re-seal every row under the new key, with the service role:

   ```bash
   APP_ENCRYPTION_KEY=<new> APP_ENCRYPTION_KEY_PREVIOUS=<old> \
     NEXT_PUBLIC_SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
     node scripts/rotate-legacy-secrets.mjs --rekey
   ```

   It stops on a value neither key opens, rather than skipping it.
4. Run `--rekey` again. When it reports nothing left under the previous key,
   remove `APP_ENCRYPTION_KEY_PREVIOUS` and redeploy.

Losing the key outright has no recovery: every sealed credential has to be
re-entered by its Organization.
