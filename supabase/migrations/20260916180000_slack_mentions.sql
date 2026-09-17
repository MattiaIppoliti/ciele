-- Additive: Slack remains opt-in; pre-migration deliveries get 503 and retry.
alter table public.background_jobs drop constraint if exists background_jobs_kind_check;
alter table public.background_jobs add constraint background_jobs_kind_check check (kind in (
  'ingest_source', 'graph_sync_concept', 'draft_improvement_proposal',
  'promote_memories', 'distill_agent_memory', 'sync_entity_records',
  'sync_application_import', 'deliver_review_request', 'resume_reviewed_conversation',
  'resume_webhook_conversation', 'answer_slack_mention'
));
create index if not exists application_connections_slack_workspace_idx
  on public.application_connections (provider_account_id) where provider = 'slack';

-- Only signed Slack events may create these jobs. Their payload can contain
-- private-channel text; ordinary organization membership grants no access.
-- Restrictive policies intersect with the existing org policies. Service role
-- bypasses RLS; other job kinds retain their existing behavior.
create policy slack_jobs_service_select on public.background_jobs
  as restrictive for select to authenticated using (kind <> 'answer_slack_mention');
create policy slack_jobs_service_insert on public.background_jobs
  as restrictive for insert to authenticated with check (kind <> 'answer_slack_mention');
create policy slack_jobs_service_update on public.background_jobs
  as restrictive for update to authenticated
  using (kind <> 'answer_slack_mention') with check (kind <> 'answer_slack_mention');
create policy slack_jobs_service_delete on public.background_jobs
  as restrictive for delete to authenticated using (kind <> 'answer_slack_mention');
