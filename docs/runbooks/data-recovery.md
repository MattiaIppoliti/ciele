# Data recovery

This runbook covers the Postgres database and uploaded objects. A database dump
does not contain Storage objects. Back up and restore both.

## Service targets

Set these targets in the production service agreement. The default operating
targets for a medium deployment are:

- Recovery point objective: 15 minutes with point-in-time recovery, 24 hours
  when only daily logical dumps are available.
- Recovery time objective: 4 hours for a full regional restore.
- Retention: 35 daily restore points and 12 monthly logical archives.
- Restore drill: monthly in an isolated project or network.

Record any stricter target in the incident plan. Do not claim a target that the
latest restore drill did not meet.

## Hosted Supabase

1. Enable point-in-time recovery for production.
2. Confirm the dashboard lists a recent restore point each day.
3. Export roles, schema and data to encrypted object storage on a separate
   account. Use `supabase db dump` and a direct database connection.
4. Copy every Ciele Storage bucket to versioned object storage. Database
   backups contain object metadata only.
5. Restrict backup credentials to the backup job and recovery operators.

Never test a restore over production. Restore into a new Supabase project,
apply the production secrets through the normal secret manager, and keep
external email and webhook delivery disabled.

## Self-hosted Compose

Create a consistent database archive:

```sh
mkdir -p backups
docker compose -f deploy/docker-compose.yml exec -T postgres \
  pg_dump -U postgres --format=custom --no-owner postgres \
  > "backups/ciele-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Archive the `storage-data` volume separately. Stop Storage writes or use a
snapshot-capable volume so the object copy has one point in time. Encrypt both
archives and copy them off the host.

Do not treat a copy of the live `postgres-data` directory as a portable backup.
Use `pg_dump`, a tested filesystem snapshot, or physical backup tooling built
for the running Postgres version.

## Monthly restore drill

1. Create an isolated environment with the same Postgres major version as
   production.
2. Restore the database archive into an empty database.
3. Restore every Storage bucket and preserve object keys.
4. Start the exact application release recorded with the backup.
5. Run migrations only when testing a forward recovery to a newer release.
6. Run `pnpm verify` and the smoke checks below.
7. Record start time, completion time, backup timestamp, data loss window,
   failures and operator name.
8. Delete the isolated environment after the report is stored.

Smoke checks:

- Sign in with a recovery-only test account.
- Open one Conversation transcript and its linked Improvement.
- Retrieve a known website page and a known PDF tail marker from Knowledge.
- Confirm Source generation IDs point to active Concepts.
- Confirm queued jobs and outbox effects have valid lease state.
- Keep email, API actions, crawlers and scheduled jobs disabled until checks
  finish. This prevents restored work from running twice.

## Incident restore order

1. Stop application writes, cron and worker processes.
2. Select the newest restore point before the damaging event.
3. Restore Postgres and Storage into a new environment.
4. Run the smoke checks with outbound effects disabled.
5. Point application traffic at the recovered environment.
6. Enable workers, then cron, then outbound effects.
7. Watch queue backlog, oldest due time, failed jobs and API idempotency errors.
8. Keep the damaged environment read-only until the incident review closes.

If Postgres recovers to an earlier time than Storage, remove objects whose
metadata no longer exists. If Storage recovers to an earlier time, mark affected
Sources as failed and re-ingest them from retained originals.
