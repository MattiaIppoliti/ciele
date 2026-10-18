# Published Assistant availability

Insights → Observability shows one daily UTC strip per currently published Assistant. Each strip covers the 90 days ending on the dashboard’s selected end date, with 60 or 30 days shown in narrower containers. Green means all sampled configuration requests succeeded, amber means some were slow (>2 seconds), red means a check failed, and gray means no checks were recorded. Hover, tap, or focus a bar and use Left/Right/Home/End to inspect it.

The displayed **observed uptime** is `(successful checks / all checks)`, with slow valid responses counted as successful. It describes only the displayed date interval. A failed sample does not establish outage duration, so the UI reports failed check counts rather than invented downtime minutes. There is no historical backfill. Missing days do not count as successes. Current status expires after ten minutes without a fresh sample.

## Scheduling

Apply `20261008143458_assistant_availability_checks.sql` through the normal migration deployment pipeline. The protected GET `/api/cron/check-assistant-availability` requires `Authorization: Bearer <CRON_SECRET>`. It checks at most 200 currently published Assistants, oldest sample first, with ten parallel requests and a five-second timeout per request. Multiple runs within a five-minute slot keep the first sample. Checks older than 400 days are removed on writes.

The self-host cron runs every five minutes. The repository's Vercel Hobby-compatible schedule runs once daily, so it produces only one daily sample and cannot establish continuous availability. For useful monitoring, configure an external scheduler to call the same protected endpoint every five minutes, or use a Vercel plan that permits that schedule and update the cron entry. Large fleets may require more frequent ticks or a dedicated worker; unsampled intervals remain unknown.

The destination comes from `internalApiOrigin`, never request headers. Set `CIELE_INTERNAL_API_ORIGIN` to the intended deployment origin if necessary. On production Vercel the canonical public origin is preferred. Preview deployment protection can return an HTML sign-in page, correctly recorded as an invalid configuration. The probe follows no redirects, sends no credentials and never calls a model. It measures the configuration endpoint, not generative response quality or provider availability. Because this scheduler runs inside the deployment, a total deployment outage can prevent samples; gaps remain unknown rather than being inferred as operational or down.

Members can read only their own Organization's samples via RLS. Only the service role can write. During a rollout before the migration, the card displays a migration notice. Component preview fixtures at `/components/status-bars` are explicitly illustrative; dashboard samples are never seeded.
