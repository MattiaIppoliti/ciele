-- Where a Conversation Turn's wall time goes (#1112). `duration_ms` is the
-- whole turn; this splits it into what the turn waited on (queue, model,
-- embed, rerank, decide, db, each the union of its intervals), the time to the
-- first answer token, and the process CPU across the turn with how many turns
-- shared the process (`overlap`; unclocked work can still share its CPU).
--
-- One jsonb column rather than a column per figure: the shape is the
-- `TurnTimings` type in packages/core (`IngestTimings` on an `ingest_job`
-- row), it is read by ad-hoc percentile queries
-- (docs/runbooks/turn-timings.md), and it is null on every other row,
-- including every row written before this migration. Additive: an older writer
-- omits it, and a newer writer one migration ahead retries without it.

alter table public.runtime_events
  add column if not exists timings jsonb;

comment on column public.runtime_events.timings is
  'TurnTimings on a chat_turn, IngestTimings on an ingest_job (#1112): per-phase wait unions, first-token ms, CPU ms and process overlap; null otherwise.';
