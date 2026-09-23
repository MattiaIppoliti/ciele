-- Decisions in the usage ledger (#950, spec #948).
--
-- The decision model (TypeSafe's Jev through `experimental_evaluate`, or the
-- AI SDK adapter over the Organization's classifier model when no platform key
-- exists) is metered through `ai_usage` like every other model call. It needs
-- one new stage, `decide`, and nothing else: the provider column is free text
-- (`typesafe` is a UsageProvider, deliberately not a Provider), the model id is
-- the id that was requested, and pricing stays in code (`packages/core`'s rate
-- table gains the Jev row). The confidence a decision carried lives on the
-- turn's trace, not here; the ledger answers "what did this cost", the trace
-- answers "what was decided and how sure was it".
--
-- Same shape as 20260823100000_memory_documents: the constraint is dropped and
-- re-added with the full list, because `check (stage in (...))` cannot be
-- extended in place. The data-layer contract suite's exhaustiveness guard
-- inserts one row per AiUsageStage, so a stage added to the type without this
-- file fails there rather than being dropped silently in production.

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
    'memory_extract',
    'agent_memory',
    'decide'
  ));
