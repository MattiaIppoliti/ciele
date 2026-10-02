-- Social reactions do not change answer-quality feedback or its analytics.
create table public.message_reactions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  target_id text not null,
  message_id text references public.messages(id) on delete cascade,
  channel_message_id text references public.teammate_channel_messages(id) on delete cascade,
  actor_id text not null,
  actor_name text not null,
  emoji text not null check (char_length(emoji) between 1 and 32),
  primary key (organization_id, target_id, actor_id),
  check (num_nonnulls(message_id, channel_message_id) = 1),
  check (target_id = coalesce(message_id, channel_message_id))
);
alter table public.message_reactions enable row level security;
-- Access only through the server endpoint, which checks conversation ownership
-- or channel membership before reading or writing with the service role.
revoke all on public.message_reactions from anon, authenticated;
grant select, insert, update, delete on public.message_reactions to service_role;
