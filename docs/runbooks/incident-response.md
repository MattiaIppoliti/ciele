# Incident response

> Versioned with the code on purpose (#801, CYB-19): a response plan that lives
> in a wiki drifts from the system it describes. Update this file in the same
> PR as any change to the signals, ledgers, or containment levers it names.
> **Version: 2** (2026-09-02). Changes since 1: the ledger gained the `aborted`
> result, `bulk-download` counts it, and the detection tick pages the whole
> 30-day horizon instead of one 5000-row read.

What this covers: a suspected security incident in a Ciele deployment,
credential exposure, data exfiltration, tenant-isolation doubt, prompt-injection
side effects, or a compromised release artifact. Operational (non-security)
breakage stays with the Alerts surface and the service runbooks
([database-restore](database-restore.md), [data-recovery](data-recovery.md)).

## Severity

| Sev | Meaning | Examples | Target first response |
| --- | --- | --- | --- |
| 1 | Confirmed cross-tenant access, active exfiltration, or a compromised published artifact | ledger shows another org's object served; a poisoned Desktop build | immediately, all else stops |
| 2 | Confirmed single-tenant compromise or credential exposure | a leaked org API key used; `plain:` rows found on a keyless install | same day |
| 3 | Suspicious signal, not yet confirmed | a `security-detection:*` Alert fired; anomalous refusal volume | next business day |

One person owns the incident end to end (rotate per incident, not mid-incident).
Everything they do goes into a timestamped incident log **outside** the affected
system, decisions included, because the log is also the postmortem's evidence.

## Signals: where a suspicion starts

- **Alerts** with `sourceKey` prefix `security-detection:` are the
  detection-as-code findings (`packages/agent/src/security-detections.ts`):
  `bulk-download` (one actor moved an unusual volume of knowledge originals,
  completed and aborted transfers together),
  `refusal-probe` (one address collecting refusals), and `new-address` (a
  known credential served from an address absent from its 30-day baseline).
  They are raise-only:
  a firing rule updates its Alert in place and **never auto-resolves**, so an
  unresolved one always represents un-triaged evidence.
- **`object_access_events`**: who was served (or refused) which private object,
  from where, and how many bytes. `result` is one of `served`, `aborted` (the
  caller cancelled; `bytes` says how much had already moved, and it counts as
  a transfer), `refused`, or `failed` (our side; not a security event).
  Append-only, service-role write.
- **`retention_sweep_events`**: what the retention lifecycle deleted and when,
  the audit that outlives the transcripts.
- **`runtime_events`**: operational telemetry (no personal data) for
  correlating timing and volume.
- Supabase auth/API logs and Vercel function logs, via each dashboard.

## Evidence acquisition, before containment changes anything

1. Record the current time, the reporting signal, and the suspected window in
   the incident log.
2. Export the relevant ledger windows **before** acting (containment below is
   deliberately non-destructive to them, but export anyway):
   `object_access_events`, `retention_sweep_events`, and the `alerts` rows,
   filtered to the window, via a service-role query; store the export with the
   incident log.
3. Set `legal_hold = true` on any Conversation in scope, so the nightly
   retention sweep cannot delete evidence mid-incident (the sweep skips held
   rows by construction).
4. Note current deploy identity: git SHA, Vercel deployment id, image digests
   for the workers.

## Containment levers, least destructive first

- **Org API key**: revoke it (Settings → API keys, or `revokeApiKey`). Keys are
  also capped at the creator's *current* role and die with their membership, so
  demote or remove the member when the human credential is the doubt.
- **Member**: remove the membership; `removeMemberOp` revokes the keys they
  minted in the same operation.
- **Direct access**: turn off the source link's `directAccess` flag to stop
  widget original downloads for that source; unpublish the assistant to stop
  the widget entirely.
- **Provider / SSO / help-desk / application credentials**: rotate at the
  provider, then re-save (writes are sealed; a keyless deployment refuses to
  start, so there is no plaintext write path). If the incident *is* legacy
  plaintext rows: `node scripts/rotate-legacy-secrets.mjs` to inventory,
  `--rotate` to re-seal, then rotate the underlying secrets at their providers,
  a re-sealed secret that was readable in the clear is still a leaked secret.
- **Hosted MCP / API surface**: unset the affected keys; the internal origin is
  environment-pinned, so host-header manipulation is not a lever an attacker
  holds.
- **Workers**: stop the container (both bind loopback-only by default; the
  graph worker verifies its model manifest at start, so a restart is also an
  integrity re-check).

## Eradication and recovery

- Database restore: [database-restore.md](database-restore.md). Restores are
  drilled there, follow the drill, not memory.
- Redeploy from a known-good SHA; workers by image digest, not tag (all
  third-party CI actions are SHA-pinned, `scripts/workflow-pins.test.mjs`
  enforces it).
- Re-run `node scripts/rotate-legacy-secrets.mjs` after any restore that may
  have resurrected pre-#801 rows.
- Before closing: the triggering Alert(s) resolved by a person (they never
  auto-resolve), the incident log complete, and a postmortem with at least one
  code or runbook change merged, an incident that changes nothing will repeat.

## Drills

Twice a year, minimum: one restore drill (per the restore runbook) and one
tabletop of a Sev-2 credential exposure using the levers above. Record both in
the incident log location. A lever nobody has pulled in a drill should be
assumed not to work.

## Known gaps (tracked in the external review, CYB-19)

- No SIEM export contract: the ledgers are queryable in Postgres but not yet
  shipped anywhere.

(Ledger retention is enforced since v1: the nightly sweep purges
`object_access_events` older than 400 days, generous by design, and far above
the 30-day horizon any detection rule reads.)
