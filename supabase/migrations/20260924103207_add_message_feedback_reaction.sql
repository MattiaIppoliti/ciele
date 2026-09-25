-- Keep the existing signed feedback score for Insights and legacy API clients.
-- The reaction key records which distinct answer reaction the Visitor chose.
alter table public.messages
  add column feedback_reaction text
  check (
    feedback_reaction is null
    or feedback_reaction in (
      'positive',
      'neutral',
      'negative'
    )
  );
