-- The summarize_conversation job kind: folds the messages that left a long
-- Conversation's recent window into its rolling summary, stored in the
-- Conversation's session_state (packages/agent/src/conversation-history.ts).
-- Same list as 20261023120000_assistant_portability_reports_moderation (its
-- second redefinition, with notify_export_ready) plus the new kind.

alter table public.background_jobs
  drop constraint if exists background_jobs_kind_check;
alter table public.background_jobs
  add constraint background_jobs_kind_check
  check (kind in (
    'ingest_source',
    'graph_sync_concept',
    'draft_improvement_proposal',
    'draft_goal_proposal',
    'promote_memories',
    'distill_agent_memory',
    'sync_entity_records',
    'sync_application_import',
    'deliver_review_request',
    'resume_reviewed_conversation',
    'resume_webhook_conversation',
    'answer_slack_mention',
    'extract_document_memories',
    'deliver_outbound_webhook',
    'score_assistant_answer',
    'notify_export_ready',
    'summarize_conversation'
  ));
