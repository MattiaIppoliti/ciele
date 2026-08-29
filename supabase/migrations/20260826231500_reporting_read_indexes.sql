-- Read-path indexes for the two admin surfaces whose latency grows with
-- history. They are partial where the product excludes internal Preview /
-- Teammate traffic or asks a narrow Message fact, keeping write amplification
-- below a generic metadata index.

create index if not exists conversations_org_window_idx
  on public.conversations (assistant_id, created_at desc, id)
  where subject_type <> 'member';

create index if not exists messages_conversation_feedback_idx
  on public.messages (conversation_id, feedback)
  where feedback <> 0;

create index if not exists messages_conversation_non_proactive_idx
  on public.messages (conversation_id)
  where not proactive;

create index if not exists improvement_messages_page_idx
  on public.improvement_messages (improvement_id, created_at, id);
