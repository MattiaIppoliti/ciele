-- Widen the ai_usage stage vocabulary for the graph knowledge engine's metered
-- LLM calls (ADR-0017): the graph worker now reports the token usage of its
-- internal cognee LLM calls, and the runtime meters them as
--   graph_search   — search-time completion / session-guidance calls
--   graph_cognify  — graph-building cognify + distillation calls
--
-- Runs after 20260720100000_usage_recording (which rebuilt this constraint
-- with 'enrich' + 'improvement_proposal'); this re-creates it as that full
-- set plus the two graph stages.

alter table public.ai_usage
  drop constraint ai_usage_stage_check;

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
    'graph_cognify'
  ));
