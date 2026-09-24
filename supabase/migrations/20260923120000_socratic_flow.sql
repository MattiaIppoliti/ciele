-- Socratic flow: offer a question-led response to academic content requests.
-- New Assistants receive this disabled built-in from DEFAULT_FLOWS; backfill
-- existing Assistants without changing their current flow order.

insert into public.flows (
  id, assistant_id, name, description,
  built_in, enabled, position, trigger_kind, trigger_settings,
  condition_logic, conditions, actions, action_settings,
  custom_message, is_default
)
select
  substr(md5(a.id || 'Socratic flow'), 1, 12),
  a.id,
  'Socratic flow',
  'A student asks the assistant to create an essay, assignment, discussion post, or other academic work on their behalf',
  true,
  false,
  coalesce(
    (select max(f.position) + 1
     from public.flows f
     where f.assistant_id = a.id and not f.is_default),
    0
  ),
  'message',
  '{}'::jsonb,
  'any',
  $conditions$[
    {
      "id": "socratic-content-request",
      "kind": "conversation_context",
      "description": "A student is asking the assistant to create content for them",
      "examples": [
        {"message": "can you help me write an essay?", "note": "A student is asking the assistant to create content for them", "shouldTrigger": true},
        {"message": "can you write a paper for me?", "note": "A student is asking the assistant to create content for them", "shouldTrigger": true},
        {"message": "Can you write a discussion thread for me?", "note": "A student is asking the assistant to create content for them", "shouldTrigger": true},
        {"message": "Can you complete an assignment on my behalf?", "note": "A student is asking the assistant to create content for them", "shouldTrigger": true},
        {"message": "Can you tell me when's my assignment due?", "note": "A student is asking about an assignment's deadline, not for help with creating content", "shouldTrigger": false},
        {"message": "When do I have to post in the discussion board?", "note": "A student is asking about the deadline to post a discussion thread, not for help with creating content", "shouldTrigger": false},
        {"message": "Can you summarise the lecture for me?", "note": "The user is asking for a summary of the lecture, not to produce content for them", "shouldTrigger": false},
        {"message": "Can you create a study plan for me?", "note": "The user is asking for help with a study plan, not help to produce an essay, assignment, discussion post, or similar work", "shouldTrigger": false}
      ]
    }
  ]$conditions$::jsonb,
  array['search_knowledge'],
  $settings${
    "search_knowledge": {
      "escalatePrompt": false,
      "improvementItems": false,
      "searchGuidelines": "",
      "answeringStyle": "Apologise and explain that you cannot produce academic work for the student. Help them understand the course material instead. Ask what they have tried so far. Guide them with questions such as \"What is your understanding of this concept?\", \"What have you learned in the course that relates to this?\", and \"What is your first step in approaching this assignment?\" Help them break the task into manageable steps through questions, without completing it for them.",
      "overrideAnsweringStyle": true
    }
  }$settings$::jsonb,
  '',
  false
from public.assistants a
where not exists (
  select 1
  from public.flows f
  where f.assistant_id = a.id
    and (
      f.id = substr(md5(a.id || 'Socratic flow'), 1, 12)
      or (f.built_in and f.name = 'Socratic flow')
    )
)
on conflict (id) do nothing;
