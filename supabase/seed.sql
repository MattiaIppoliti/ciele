-- Demo data for Ciele admin screenshots.
insert into public.assistants
  (id, title, nickname, description, welcome_message, suggested_questions, chat_launcher_enabled)
values
  ('68625fb8dec5', 'Ciele Support Assistant (TEST)', 'Ciele Support',
   'Cross-sector support virtual assistant',
   'I can help you with product information, account guidance, support resources, and operational procedures. What would you like to know?',
   array['Product setup', 'How do I contact support?'], true),
  ('Vrp47KxooVPk', 'Ciele AI - Administrative Support Assistant', 'Ciele AI',
   '', 'I can help you with administrative and support information. What would you like to know?',
   array[]::text[], true),
  ('mNazItEGmptY', 'Operations Support Assistant', 'Operations AI',
   'Operations support virtual assistant',
   'I can help you with operations information. What would you like to know?',
   array[]::text[], true),
  ('GLKtpRVNA53U', 'Knowledge Base Support Assistant', 'Knowledge AI',
   'Support for documentation, access, resources, and knowledge-base navigation',
   'I can help you with documentation, resources, access, and knowledge-base navigation. What would you like to know?',
   array[]::text[], true),
  ('S0kKrwjfbDAo', 'Customer Onboarding Assistant', 'Onboarding AI',
   'Customer onboarding support assistant',
   'I can help you with onboarding steps, setup tasks, and launch guidance. What would you like to know?',
   array[]::text[], true),
  ('GlQMYjuZ6xcO', 'Company Intranet Assistant', 'Intranet AI',
   'Intranet SharePoint assistant',
   'I can help you with intranet information. What would you like to know?',
   array[]::text[], true),
  ('e3DD-yC2bT-Y', 'Employee Support Assistant', 'People AI',
   'Employee support virtual assistant',
   'I can help you with people operations and workplace information. What would you like to know?',
   array[]::text[], true),
  ('hAOzUt5m-cHI', 'Ciele Support Assistant (PROD)', 'Ciele AI',
   'Cross-sector support virtual assistant',
   'I can help you with product information, account guidance, support resources, and operational procedures. What would you like to know?',
   array['Product setup', 'How do I contact support?'], true)
on conflict (id) do nothing;

-- Default flows for every assistant.
insert into public.flows (id, assistant_id, name, description, built_in, enabled, position, actions, custom_message, is_default)
select
  substr(md5(a.id || f.name), 1, 12),
  a.id,
  f.name,
  f.description,
  f.built_in,
  f.enabled,
  f.position,
  f.actions,
  f.custom_message,
  f.is_default
from public.assistants a
cross join (
  values
    -- Position -1 mirrors the backfill migration's `min(position) - 1`: first in
    -- priority without renumbering the flows below it.
    ('Basic Interaction',
     'User is greeting the assistant, thanking it, saying goodbye, or acknowledging a previous answer, conversational courtesy that asks no question and carries no information need',
     true, true, -1, array['basic_reply'],
     '',
     false),
    ('Assistant Information',
     'User is asking about the assistant''s capabilities, features, identity, purpose, or what services it provides',
     true, true, 0, array['custom_message'],
     'I''m a virtual assistant! I can answer your questions, point you to the right resources and help you find what you need. Just ask me anything.',
     false),
    ('Human Help Needed',
     'User explicitly asks for human help, wants to contact support, escalate to a person, or otherwise reach a human',
     true, false, 1, array['search_knowledge', 'custom_message', 'suggest_help_desk'],
     'Of course, sometimes it''s best to talk to a person. You can reach the support team through the help desk below.',
     false),
    ('Default behavior',
     'No other flow matches the user query',
     true, true, 99, array['search_knowledge', 'follow_up_questions'],
     '',
     true)
) as f(name, description, built_in, enabled, position, actions, custom_message, is_default)
on conflict (id) do nothing;

-- Extra custom flows for the PROD assistant (as in the Flows screenshot).
insert into public.flows (id, assistant_id, name, description, built_in, enabled, position, actions, custom_message, is_default)
values
  (substr(md5('hAOzUt5m-cHI' || 'Setup preparation'), 1, 12),
   'hAOzUt5m-cHI', 'Setup preparation',
   'Asks how they can prepare for an upcoming setup or launch',
   false, true, 2, array['custom_message'],
   'Great question! Start from the setup checklist, review the relevant documentation, and confirm owners for each launch task. You can find the full guide in the knowledge base.',
   false),
  (substr(md5('hAOzUt5m-cHI' || 'Content creation guardrail'), 1, 12),
   'hAOzUt5m-cHI', 'Content creation guardrail',
   'A user is asking the assistant to create content for them',
   false, true, 3, array['search_knowledge'], '', false)
on conflict (id) do nothing;

-- Demo organization that owns the seeded assistants (multi-tenant schema).
insert into public.organizations (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Acme Corp (demo)')
on conflict (id) do nothing;

update public.assistants
set organization_id = '00000000-0000-0000-0000-000000000001'
where organization_id is null;

-- `join_demo_org()` used to live here: a SECURITY DEFINER function that made any
-- authenticated caller an **owner** of the demo org. It was reachable straight
-- from PostgREST, so it is gone (see
-- migrations/20260820120000_drop_join_demo_org.sql). Add a member to the demo org
-- with an explicit insert below if you want one locally; do not reintroduce a
-- self-service owner grant.

-- One demo Document with the memories extracted from it (#926), so the
-- Memories tab (#932) has something to render before anything extracts for
-- real (#930). Every quote below is a verbatim span of the body above it:
-- the evidence a Member checks a memory against is the whole point of keeping
-- it, and a seeded quote that paraphrases would teach the wrong shape.
insert into public.knowledge_collections (id, organization_id, name, description)
values ('demo-collection', '00000000-0000-0000-0000-000000000001',
        'Knowledge Library', 'The demo organization''s Sources')
on conflict (id) do nothing;

insert into public.sources (id, collection_id, name, kind, status)
values ('demo-handbook', 'demo-collection', 'Employee handbook', 'text', 'ready')
on conflict (id) do nothing;

insert into public.concepts (id, collection_id, source_id, path, frontmatter, body)
values (
  'demo-leave-policy',
  'demo-collection',
  'demo-handbook',
  'handbook/leave.md',
  '{"type": "Document", "title": "Leave policy", "generated": {"by": "process:okf-ingest-passthrough"}}'::jsonb,
  'Employees accrue 25 days of paid leave a year. Unused leave expires on 31 March. '
  'Leave requests need a manager''s approval at least two weeks ahead. '
  'Public holidays do not count against the allowance.'
)
on conflict (id) do nothing;

insert into public.knowledge_memories
  (id, organization_id, collection_id, source_id, document_path, concept_id,
   text, quote, generated_by, forgotten_at, forget_reason)
values
  ('demo-memory-accrual', '00000000-0000-0000-0000-000000000001',
   'demo-collection', 'demo-handbook', 'handbook/leave.md', 'demo-leave-policy',
   'Employees get 25 days of paid leave a year.',
   'Employees accrue 25 days of paid leave a year.',
   'knowledge-memory-extractor/1', null, null),
  ('demo-memory-expiry', '00000000-0000-0000-0000-000000000001',
   'demo-collection', 'demo-handbook', 'handbook/leave.md', 'demo-leave-policy',
   'Unused leave expires at the end of March.',
   'Unused leave expires on 31 March.',
   'knowledge-memory-extractor/1', null, null),
  ('demo-memory-notice', '00000000-0000-0000-0000-000000000001',
   'demo-collection', 'demo-handbook', 'handbook/leave.md', 'demo-leave-policy',
   'Leave needs a manager''s approval two weeks in advance.',
   'Leave requests need a manager''s approval at least two weeks ahead.',
   'knowledge-memory-extractor/1', null, null),
  -- One forgotten row, so the tab's second state is visible without a click:
  -- the text and its evidence are still here, which is what makes a restore
  -- possible and a forget different from a delete.
  ('demo-memory-holidays', '00000000-0000-0000-0000-000000000001',
   'demo-collection', 'demo-handbook', 'handbook/leave.md', 'demo-leave-policy',
   'Public holidays come out of the leave allowance.',
   'Public holidays do not count against the allowance.',
   'knowledge-memory-extractor/1', now(), 'Says the opposite of the page')
on conflict (id) do nothing;
