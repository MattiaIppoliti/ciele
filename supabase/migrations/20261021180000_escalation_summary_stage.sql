-- The Chat summary an escalation carries (#1081) is metered in the AI Usage
-- Ledger under its own stage. A stage missing from this check is silently
-- dropped by `meterUsage`, which is what the contract suite's stage guard
-- exists to catch.

alter table public.ai_usage drop constraint if exists ai_usage_stage_check;
alter table public.ai_usage add constraint ai_usage_stage_check
  check (stage in (
    'classify', 'generate', 'embed', 'enrich', 'verify', 'goal_eval',
    'evaluation', 'compost', 'improvement_proposal', 'graph_search',
    'graph_cognify', 'rerank', 'memory_extract', 'agent_memory', 'decide',
    'escalation_summary'
  ));
