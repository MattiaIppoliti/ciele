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

-- Convenience for trying the app: lets any authenticated user join the
-- demo org as owner. Remove in a real deployment.
create or replace function public.join_demo_org()
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into organization_members (organization_id, user_id, role)
  values ('00000000-0000-0000-0000-000000000001', auth.uid(), 'owner')
  on conflict (organization_id, user_id) do nothing;
  return '00000000-0000-0000-0000-000000000001'::uuid;
end $$;
