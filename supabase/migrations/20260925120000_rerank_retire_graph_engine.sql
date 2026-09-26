-- Retrieval reranks; the graph engine is gone (ADR-0025).
--
-- Two changes, one file, because they land in the same release and both are
-- about how `search_knowledge` finds its six passages.
--
-- 1. The `rerank` usage stage. The knowledge search now asks for 20 hybrid
--    candidates and reranks them to 6 (voyage/rerank-2.5 through the AI
--    Gateway, platform key only). The call is metered through `ai_usage` like
--    every other model call. Same shape as 20260921160000_ai_usage_decide_stage:
--    the check is dropped and re-added with the full list. `enrich`,
--    `graph_search` and `graph_cognify` stay in it: nothing writes them any
--    more, but recorded rows carry them.
--
-- 2. The Graph Knowledge Engine (ADR-0017) is removed. The nightly learning
--    rotation and any queued graph-sync jobs go with it. The per-Assistant
--    `knowledge_engine` column stays for now: the previous deployment still
--    writes it on every General save until this release is serving, so
--    dropping it here would break those saves. A later migration contracts it. The OKF Concepts and their pgvector chunks
--    were always the record, so no Knowledge is lost: every Assistant that was
--    on `graph` was already falling back to exactly this index whenever the
--    worker was unreachable.
--
-- The `background_jobs.kind` check still admits `graph_sync_concept`, and the
-- tenancy trigger still has its purge/remove exemptions. Both are harmless with
-- no producer, and rewriting those functions to drop a dead branch is a larger
-- change than the branch.

alter table public.ai_usage
  drop constraint if exists ai_usage_stage_check;

alter table public.ai_usage
  add constraint ai_usage_stage_check
  check (stage in (
    'classify',
    'generate',
    'embed',
    'enrich',
    'verify',
    'goal_eval',
    'compost',
    'improvement_proposal',
    'graph_search',
    'graph_cognify',
    'rerank',
    'memory_extract',
    'agent_memory',
    'decide'
  ));

delete from public.background_jobs where kind = 'graph_sync_concept';

-- A graph-worker Alert would otherwise stay open forever: its producer is
-- gone, so nothing will ever send the healthy signal that clears it.
update public.alerts
  set status = 'resolved', resolved_at = now()
  where status = 'active' and source_key like 'graph-worker:%';

drop function if exists public.claim_active_graph_datasets(integer);
drop table if exists private.graph_learning_cursor;
