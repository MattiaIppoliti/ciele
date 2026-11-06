# Reading where a chat turn's time goes

Every `chat_turn` row in `public.runtime_events` carries a `timings` jsonb (#1112), written by the
turn clock in `packages/agent/src/turn-clock.ts`, and every `ingest_job` row carries the ingestion
equivalent. Rows written before the clock shipped have it null. Rows from the clock's first version, if any
reached production, have the first shape only: no `modelMsByStage`, `retrievalMs`, `toolMs`,
`tools`, `trigger` or `jobsInFlight`, and an `overlap` that counted turns only. The queries below
`coalesce` the missing fields, and `timings ? 'jobsInFlight'` selects the current shape.

While the deploy runs one migration ahead of `20261021120000_runtime_event_timings`, the adapter
writes the row without `timings` rather than dropping it, so those rows have it null too.

## `chat_turn` timings

| Field | What it measures |
|---|---|
| `firstTokenMs` | Turn start to the first newly generated text or part on the wire. Null if none was sent. Gate outcomes replayed from an earlier turn do not count. |
| `queueMs` | Waiting for a concurrency slot (`turn-concurrency.ts`). |
| `modelMs` | Language-model calls, one per agent-loop step, streams timed until they end or are cancelled. |
| `modelMsByStage` | `modelMs` split by the `ai_usage` stage each call ran for: `classify` (Intent Classification, the help desk recommendation), `decide` (decision adapters) and `generate` (answer generation). Each is a union, so the stages can add up to more than `modelMs` only if two stages ran at once. |
| `modelCallTimings` | Individual model-call `{ stage, ms }` records; overlapping calls keep their own duration. |
| `toolCallTimings` | Individual tool-call `{ tool, ms }` records. |
| `modelCalls` | How many language-model calls the turn made. |
| `embedMs`, `rerankMs`, `decideMs` | Query embeddings, the reranker, Jev `decide()`. |
| `retrievalMs` | Vector search on the turn's `Db` handles (`searchChunks`, `searchCollectionChunks`, `searchSourceChunks`, `searchMemories`, the `match_chunks*` and `match_memories` RPCs). |
| `dbMs` | Every other call on the turn's own `Db` handles (Postgres through supabase-js). |
| `toolMs` | Tool executions, start to end. A tool's time includes the embed, retrieval and HTTP it waited on, so `toolMs` overlaps those figures. |
| `tools` | Per tool name: `{ calls, ms }`, `ms` the union of that tool's calls. |
| `waitMs` | The union of every wait above. |
| `cpuMs` | User + system CPU of the **process** across the turn. |
| `overlap` | The most units of clocked work the process ran at once during this turn: turns plus job-layer jobs. 1 means no other clocked work. |
| `jobsInFlight` | How many of `overlap` were job-layer jobs, at most. |
| `trigger` | What started the turn: `live` (a person watching the stream: widget, Preview, Teammate chat), `api` (a machine caller holding the socket), `channel` (a Teammate Channel answer), or the unattended `proactive`, `routine`, `resume` (a Human review or callback gate resumed) and `slack`. |

Three rules for reading it:

- **Each wait is a union, not a sum.** Two model calls that run side by side for 2 s count as 2 s.
  So `duration_ms - waitMs` is the time no clocked call was in flight: our own code, plus anything
  the clock does not see (a `Db` handle a tool built for itself, work between the stream ending and
  the event being written).
- **Live-chat latency means `trigger = 'live'`.** A Routine or a resumed gate has nobody waiting,
  and a Slack answer waits in the job queue first; mixing them in moves the percentiles for reasons
  that have nothing to do with the turn.
- **`cpuMs` is an upper bound even when `overlap = 1`.** Unclocked work can still share the
  process. The `overlap = 1` sample has less known contention; it is biased toward quiet periods.
  Use the Vercel usage export for the instance-level total. See the limits below for what `overlap` still misses.

Failed turns are included in every latency query: a turn that times out after 30 s is the slowest
turn the Visitor saw, and filtering on `status = 'succeeded'` hides it. Each query splits by status
so both are visible.

## p50 and p95 per phase, live chat, last 7 days

```sql
with t as (
  select surface, status, duration_ms,
         (timings->>'firstTokenMs')::numeric                        as first_token,
         coalesce((timings->>'queueMs')::numeric, 0)                as queue,
         coalesce((timings->>'modelMs')::numeric, 0)                as model,
         coalesce((timings->'modelMsByStage'->>'classify')::numeric, 0) as model_classify,
         coalesce((timings->'modelMsByStage'->>'generate')::numeric, 0) as model_generate,
         coalesce((timings->>'embedMs')::numeric, 0)                as embed,
         coalesce((timings->>'rerankMs')::numeric, 0)               as rerank,
         coalesce((timings->>'decideMs')::numeric, 0)               as decide,
         coalesce((timings->>'retrievalMs')::numeric, 0)            as retrieval,
         coalesce((timings->>'dbMs')::numeric, 0)                   as db,
         coalesce((timings->>'toolMs')::numeric, 0)                 as tool,
         duration_ms - coalesce((timings->>'waitMs')::numeric, 0)   as unclocked
  from public.runtime_events
  where kind = 'chat_turn' and timings is not null
    and coalesce(timings->>'trigger', 'live') = 'live'
    and created_at > now() - interval '7 days'
)
select surface, status, count(*) as turns,
       percentile_cont(0.5)  within group (order by duration_ms)    as p50_total,
       percentile_cont(0.95) within group (order by duration_ms)    as p95_total,
       percentile_cont(0.5)  within group (order by first_token)    as p50_first_token,
       percentile_cont(0.95) within group (order by first_token)    as p95_first_token,
       percentile_cont(0.5)  within group (order by queue)          as p50_queue,
       percentile_cont(0.95) within group (order by queue)          as p95_queue,
       percentile_cont(0.5)  within group (order by model)          as p50_model,
       percentile_cont(0.95) within group (order by model)          as p95_model,
       percentile_cont(0.5)  within group (order by model_classify) as p50_model_classify,
       percentile_cont(0.95) within group (order by model_classify) as p95_model_classify,
       percentile_cont(0.5)  within group (order by model_generate) as p50_model_generate,
       percentile_cont(0.95) within group (order by model_generate) as p95_model_generate,
       percentile_cont(0.5)  within group (order by embed)          as p50_embed,
       percentile_cont(0.95) within group (order by embed)          as p95_embed,
       percentile_cont(0.5)  within group (order by rerank)         as p50_rerank,
       percentile_cont(0.95) within group (order by rerank)         as p95_rerank,
       percentile_cont(0.5)  within group (order by decide)         as p50_decide,
       percentile_cont(0.95) within group (order by decide)         as p95_decide,
       percentile_cont(0.5)  within group (order by retrieval)      as p50_retrieval,
       percentile_cont(0.95) within group (order by retrieval)      as p95_retrieval,
       percentile_cont(0.5)  within group (order by db)             as p50_db,
       percentile_cont(0.95) within group (order by db)             as p95_db,
       percentile_cont(0.5)  within group (order by tool)           as p50_tool,
       percentile_cont(0.95) within group (order by tool)           as p95_tool,
       percentile_cont(0.5)  within group (order by unclocked)      as p50_unclocked,
       percentile_cont(0.95) within group (order by unclocked)      as p95_unclocked,
       round(avg(unclocked / nullif(duration_ms, 0)) * 100, 1)      as pct_unclocked
from t
group by surface, status
order by surface, status;
```

`first_token` is null for a turn that sent nothing, and `percentile_cont` skips nulls, so a failed
turn with no output moves `p95_total` and not `p95_first_token`.

For the unattended turns, swap the trigger filter for `timings->>'trigger' <> 'live'` and add
`timings->>'trigger'` to the `group by`.

## Model time by `ai_usage` stage

Every stage the clock saw, without naming them in advance:

```sql
select s.key as stage, count(*) as turns,
       percentile_cont(0.5)  within group (order by s.value::numeric) as p50_ms,
       percentile_cont(0.95) within group (order by s.value::numeric) as p95_ms
from public.runtime_events e,
     jsonb_each_text(e.timings->'modelMsByStage') s
where e.kind = 'chat_turn'
  and coalesce(e.timings->>'trigger', 'live') = 'live'
  and e.created_at > now() - interval '7 days'
group by s.key
order by p95_ms desc;
```

## Individual model and tool calls

Unlike union totals, these samples preserve each call's latency when calls overlap. Older rows
without the call arrays produce no samples.

```sql
with calls as (
  select e.surface, e.status, 'model' as kind, c->>'stage' as name,
         (c->>'ms')::numeric as ms
  from public.runtime_events e,
       jsonb_array_elements(e.timings->'modelCallTimings') c
  where e.kind = 'chat_turn' and e.timings->>'trigger' = 'live'
    and e.created_at > now() - interval '7 days'
  union all
  select e.surface, e.status, 'tool', c->>'tool', (c->>'ms')::numeric
  from public.runtime_events e,
       jsonb_array_elements(e.timings->'toolCallTimings') c
  where e.kind = 'chat_turn' and e.timings->>'trigger' = 'live'
    and e.created_at > now() - interval '7 days'
)
select surface, status, kind, name, count(*) as calls,
       percentile_cont(0.5) within group (order by ms) as p50_ms,
       percentile_cont(0.95) within group (order by ms) as p95_ms
from calls
group by surface, status, kind, name;
```

## Tools

Per tool, over the turns that called it:

```sql
select t.key as tool,
       sum((t.value->>'calls')::int) as calls,
       count(*) as turns,
       percentile_cont(0.5)  within group (order by (t.value->>'ms')::numeric) as p50_ms_per_turn,
       percentile_cont(0.95) within group (order by (t.value->>'ms')::numeric) as p95_ms_per_turn
from public.runtime_events e,
     jsonb_each(e.timings->'tools') t
where e.kind = 'chat_turn'
  and coalesce(e.timings->>'trigger', 'live') = 'live'
  and e.created_at > now() - interval '7 days'
group by t.key
order by p95_ms_per_turn desc;
```

## Retrieval against the rest of the database

```sql
select surface,
       percentile_cont(0.5)  within group (order by (timings->>'retrievalMs')::numeric) as p50_retrieval,
       percentile_cont(0.95) within group (order by (timings->>'retrievalMs')::numeric) as p95_retrieval,
       percentile_cont(0.5)  within group (order by (timings->>'dbMs')::numeric)        as p50_db,
       percentile_cont(0.95) within group (order by (timings->>'dbMs')::numeric)        as p95_db
from public.runtime_events
where kind = 'chat_turn' and timings ? 'retrievalMs'
  and timings->>'trigger' = 'live'
  and created_at > now() - interval '7 days'
group by surface;
```

## Process CPU during turns with no other clocked work

```sql
select surface, status, count(*) as turns,
       percentile_cont(0.5)  within group (order by (timings->>'cpuMs')::numeric) as p50_cpu_ms,
       percentile_cont(0.95) within group (order by (timings->>'cpuMs')::numeric) as p95_cpu_ms
from public.runtime_events
where kind = 'chat_turn'
  and timings ? 'jobsInFlight'
  and (timings->>'overlap')::int = 1
  and created_at > now() - interval '7 days'
group by surface, status;
```

`timings ? 'jobsInFlight'` keeps only rows whose `overlap` counted jobs too.

## Ingestion jobs

One `ingest_job` row per `ingest_source` job attempt, `assistant_id` from the job payload:

| Field | What it measures |
|---|---|
| `parseMs` | Raw text into Concept drafts. Zero on retries that reuse drafts frozen by the first attempt. |
| `chunkMs` | Concept bodies into embedding chunks. |
| `embedMs` | Embedding requests. |
| `dbMs` | The job's own `Db` calls. |
| `waitMs` | Union of the four above. |
| `concepts` | Concept drafts the attempt wrote. |
| `cpuMs`, `overlap`, `jobsInFlight` | As on a turn. |

```sql
with j as (
  select status, duration_ms,
         (timings->>'parseMs')::numeric  as parse,
         (timings->>'chunkMs')::numeric  as chunk,
         (timings->>'embedMs')::numeric  as embed,
         (timings->>'dbMs')::numeric     as db,
         duration_ms - (timings->>'waitMs')::numeric as unclocked,
         (timings->>'concepts')::int     as concepts
  from public.runtime_events
  where kind = 'ingest_job' and timings is not null
    and created_at > now() - interval '7 days'
)
select status, count(*) as jobs, sum(concepts) as concepts,
       percentile_cont(0.5)  within group (order by duration_ms) as p50_total,
       percentile_cont(0.95) within group (order by duration_ms) as p95_total,
       percentile_cont(0.5)  within group (order by parse)       as p50_parse,
       percentile_cont(0.95) within group (order by parse)       as p95_parse,
       percentile_cont(0.5)  within group (order by chunk)       as p50_chunk,
       percentile_cont(0.95) within group (order by chunk)       as p95_chunk,
       percentile_cont(0.5)  within group (order by embed)       as p50_embed,
       percentile_cont(0.95) within group (order by embed)       as p95_embed,
       percentile_cont(0.5)  within group (order by db)          as p50_db,
       percentile_cont(0.95) within group (order by db)          as p95_db,
       percentile_cont(0.5)  within group (order by unclocked)   as p50_unclocked,
       percentile_cont(0.95) within group (order by unclocked)   as p95_unclocked
from j
group by status;
```

## What the clock does not cover

- **`overlap` sees turns and job-layer jobs, nothing else.** Every job `runDueJobs` claims runs
  under a `job` clock, so a drain beside a turn shows up. Cron work that does not go through the
  job layer (the crawl finalizer's own polling, the retention and trace sweeps, the turn-effects
  outbox drain) and every page render or API route that is not a turn burn the same CPU without
  being counted. On a busy instance `overlap = 1` is therefore necessary, not sufficient, for
  `cpuMs` to be one turn's; compare against the Vercel usage export before trusting it.
- **A turn a job runs counts twice in `overlap`**: a Slack answer or a resumed gate is a job, and
  the turn inside it is a turn. Both carry an unattended `trigger`, so live-chat queries already
  leave them out.
- **Website crawls** record no `ingest_job` timings; a `crawl` event still has its whole-crawl
  `duration_ms`. File extraction (PDF, Office) happens before the job and is not in `parseMs`.
- **A clock settles at the latest 15 minutes after it opened** (`MAX_LIVE_MS`), in case a stream is
  never read and never aborted. Work still running after that stops counting toward other turns'
  `overlap`.
